/**
 * Owns the worker thread that hosts one compiled plug-in module.
 *
 * The invoker is the main process's handle on a sandbox: it serialises calls,
 * enforces a hard timeout (a plug-in stuck in a loop can only stall its own
 * worker), and reports logs back with the call that produced them. When a call
 * times out or the worker dies the invoker is marked broken; the engine simply
 * builds a fresh one on the next event.
 */
import { Worker } from 'node:worker_threads';

export interface InvokeResult {
  output: string;
  logs: string[];
}

export interface ScriptInvoker {
  /** Feed one JSON envelope; rejects on timeout, crash or plug-in error. */
  invoke(input: string): Promise<InvokeResult>;
  /** Ask the worker to shut down and release its module. */
  close(): void;
}

export type InvokerFactory = (wasmPath: string) => ScriptInvoker;

type WorkerMessage =
  | { type: 'ready'; abi: number }
  | { type: 'init-error'; message: string }
  | { type: 'result'; id: number; output: string; logs: string[] }
  | { type: 'error'; id: number; message: string }
  | { type: 'log'; level: number; message: string };

interface Pending {
  id: number;
  resolve: (value: InvokeResult) => void;
  reject: (error: Error) => void;
  logs: string[];
  timer: NodeJS.Timeout;
}

export interface WorkerInvokerOptions {
  /** Milliseconds a single invocation may run before the worker is killed. */
  timeoutMs?: number;
  /** Called with every log line the plug-in emits during a call. */
  onLog?: (message: string) => void;
  /** Heap cap for the worker; a runaway plug-in hits it long before the host. */
  maxOldGenerationSizeMb?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Build a lazily-booting invoker. The worker boots on construction; callers
 * await the first `invoke` (or `close`) result rather than a separate promise,
 * so a failing module surfaces as a rejected invocation.
 */
export function createWorkerInvoker(
  workerScript: string,
  wasmPath: string,
  options: WorkerInvokerOptions = {},
): ScriptInvoker {
  const timeoutMs = Math.max(500, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let worker: Worker | null = new Worker(workerScript, {
    workerData: { wasmPath },
    resourceLimits: { maxOldGenerationSizeMb: options.maxOldGenerationSizeMb ?? 64 },
    stdout: false,
    stderr: false,
  });
  let ready: Promise<void> | null = null;
  let resolveReady: (() => void) | null = null;
  let rejectReady: ((error: Error) => void) | null = null;
  let pending: Pending | null = null;
  let nextId = 1;
  let broken = false;

  const fail = (error: Error): void => {
    broken = true;
    rejectReady?.(error);
    resolveReady = null;
    rejectReady = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      pending = null;
    }
  };

  const shutdown = (): void => {
    const current = worker;
    worker = null;
    if (!current) return;
    void current.terminate().catch(() => undefined);
  };

  ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const attach = (target: Worker): void => {
    target.on('message', (message: WorkerMessage) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ready') {
        resolveReady?.();
        resolveReady = null;
        rejectReady = null;
        return;
      }
      if (message.type === 'init-error') {
        fail(new Error(message.message));
        return;
      }
      if (message.type === 'log') {
        options.onLog?.(message.message);
        pending?.logs.push(message.message);
        return;
      }
      if (message.type === 'result' && pending && message.id === pending.id) {
        const done = pending;
        pending = null;
        clearTimeout(done.timer);
        done.resolve({ output: message.output, logs: message.logs ?? done.logs });
        return;
      }
      if (message.type === 'error' && pending && message.id === pending.id) {
        const done = pending;
        pending = null;
        clearTimeout(done.timer);
        done.reject(new Error(message.message));
      }
    });
    target.on('error', error => fail(error instanceof Error ? error : new Error(String(error))));
    target.on('exit', code => {
      if (code !== 0) fail(new Error(`插件进程异常退出（代码 ${code}）`));
      else if (pending) fail(new Error('插件进程已退出'));
    });
  };

  if (worker) attach(worker);

  return {
    invoke(input: string): Promise<InvokeResult> {
      if (broken || !worker) return Promise.reject(new Error('插件未就绪或已停止'));
      if (pending) return Promise.reject(new Error('插件正忙'));
      const target = worker;
      const id = nextId++;
      return ready!
        .then(() => new Promise<InvokeResult>((resolve, reject) => {
          if (broken || !target) {
            reject(new Error('插件未就绪或已停止'));
            return;
          }
          const timer = setTimeout(() => {
            pending = null;
            broken = true;
            shutdown();
            reject(new Error(`插件调用超过 ${timeoutMs} 毫秒未返回，已终止`));
          }, timeoutMs);
          pending = { id, resolve, reject, logs: [], timer };
          target.postMessage({ type: 'invoke', id, input });
        }))
        .catch(error => {
          broken = true;
          shutdown();
          throw error instanceof Error ? error : new Error(String(error));
        });
    },
    close(): void {
      if (worker) {
        try {
          worker.postMessage({ type: 'close' });
        } catch {
          /* the worker may already be gone */
        }
      }
      broken = true;
      shutdown();
    },
  };
}