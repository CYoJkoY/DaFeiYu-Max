/**
 * Worker-thread host for one authored-code plug-in.
 *
 * Running each plug-in in its own worker keeps a buggy or hostile module off
 * the main thread: a synchronous infinite loop inside `dfy_invoke` can only
 * stall this thread, and the main process terminates it on timeout. The worker
 * knows nothing about settings or the pet — it just loads WASM, forwards JSON
 * envelopes and streams logs back.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { ScriptSandbox } from './sandbox.ts';

interface InvokeMessage { type: 'invoke'; id: number; input: string }
interface CloseMessage { type: 'close' }
type Inbound = InvokeMessage | CloseMessage;

const port = parentPort;
if (!port) throw new Error('plugin-worker 必须在 worker_threads 中运行');

const wasmPath = (workerData as { wasmPath?: string } | undefined)?.wasmPath ?? '';

function post(message: unknown): void {
  port?.postMessage(message);
}

async function boot(): Promise<void> {
  if (!wasmPath) {
    post({ type: 'init-error', message: '缺少 wasmPath' });
    return;
  }
  try {
    const bytes = readFileSync(wasmPath);
    const sandbox = await ScriptSandbox.create(new Uint8Array(bytes), {
      onLog: (level, message) => post({ type: 'log', level, message }),
    });
    sandboxRef = sandbox;
    post({ type: 'ready', abi: sandbox.abiVersion });
  } catch (error) {
    post({ type: 'init-error', message: error instanceof Error ? error.message : String(error) });
  }
}

let sandboxRef: ScriptSandbox | null = null;

port.on('message', (message: Inbound) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'close') {
    sandboxRef?.close();
    sandboxRef = null;
    port.close();
    return;
  }
  if (message.type === 'invoke') {
    const sandbox = sandboxRef;
    if (!sandbox) {
      post({ type: 'error', id: message.id, message: '沙箱未就绪' });
      return;
    }
    try {
      const { output, logs } = sandbox.invoke(message.input);
      post({ type: 'result', id: message.id, output, logs });
    } catch (error) {
      post({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
});

void boot();
