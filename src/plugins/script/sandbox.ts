/**
 * Instantiates a Zig-compiled WASM plug-in and drives its `dfy_invoke` entry.
 *
 * The sandbox is intentionally environment-agnostic: it touches only the
 * WebAssembly and TextEncoder APIs, so the exact same code runs inside the
 * worker thread (isolation for the app) and inside the unit tests (in-process).
 * The surrounding runtime, not the module, decides what those calls mean.
 */
import { REQUIRED_EXPORTS, SCRIPT_ABI_VERSION } from './abi.ts';

export interface SandboxOptions {
  /** Called for every `dfy_log` the module emits. */
  onLog?: (level: number, message: string) => void;
  /** Initial output buffer size; grows on demand when the plug-in asks for more. */
  initialOutBytes?: number;
  /** Hard cap for a single response, protecting the host from runaway output. */
  maxOutBytes?: number;
}

interface Exports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  dfy_abi_version: () => number;
  dfy_alloc: (len: number) => number;
  dfy_free: (ptr: number, len: number) => void;
  dfy_invoke: (inPtr: number, inLen: number, outPtr: number, outCap: number) => number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

export class ScriptSandbox {
  private readonly exports: Exports;
  private readonly memory: WebAssembly.Memory;
  private readonly initialOutBytes: number;
  private readonly maxOutBytes: number;
  private logSink: ((level: number, message: string) => void) | null;
  private closed = false;

  private constructor(instance: WebAssembly.Instance, options: SandboxOptions) {
    this.exports = instance.exports as Exports;
    this.memory = this.exports.memory;
    this.initialOutBytes = Math.max(1024, options.initialOutBytes ?? 65_536);
    this.maxOutBytes = Math.max(this.initialOutBytes, options.maxOutBytes ?? 4 * 1024 * 1024);
    this.logSink = options.onLog ?? null;
    if (!(this.memory instanceof WebAssembly.Memory)) throw new Error('模块没有导出 memory');
    for (const name of REQUIRED_EXPORTS) {
      if (typeof (this.exports as Record<string, unknown>)[name] !== 'function') {
        throw new Error(`模块缺少导出：${name}`);
      }
    }
  }

  /** Compile and instantiate a module, verifying the ABI version. */
  static async create(raw: Uint8Array, options: SandboxOptions = {}): Promise<ScriptSandbox> {
    if (!(raw instanceof Uint8Array) || raw.byteLength === 0) throw new Error('WASM 文件为空');
    // Copy into a plain ArrayBuffer so `WebAssembly.compile` accepts it under
    // strict BufferSource typing (a Node Buffer is backed by ArrayBufferLike).
    const bytes = new Uint8Array(raw.byteLength);
    bytes.set(raw);
    // `dfy_log` forwards to whatever sink the live sandbox currently sets, so
    // per-invocation log capture works without swapping the import closure.
    let sandboxRef: ScriptSandbox | null = null;
    const imports: WebAssembly.Imports = {
      env: {
        dfy_log: (level: number, ptr: number, len: number): void => {
          sandboxRef?.emitLog(level, ptr, len);
        },
      },
    };
    let module: WebAssembly.Module;
    try {
      module = await WebAssembly.compile(bytes);
    } catch (error) {
      throw new Error(`WASM 编译失败：${error instanceof Error ? error.message : String(error)}`);
    }
    let instance: WebAssembly.Instance;
    try {
      instance = await WebAssembly.instantiate(module, imports);
    } catch (error) {
      throw new Error(`WASM 实例化失败：${error instanceof Error ? error.message : String(error)}`);
    }
    const sandbox = new ScriptSandbox(instance, options);
    sandboxRef = sandbox;
    const abi = sandbox.exports.dfy_abi_version();
    if (abi !== SCRIPT_ABI_VERSION) {
      throw new Error(`不支持的 ABI 版本：${abi}（需要 ${SCRIPT_ABI_VERSION}）`);
    }
    return sandbox;
  }

  private emitLog(level: number, ptr: number, len: number): void {
    if (!this.logSink) return;
    try {
      const message = decoder.decode(new Uint8Array(this.memory.buffer, ptr >>> 0, len >>> 0));
      this.logSink(level | 0, message);
    } catch {
      /* logging must never break a plug-in call */
    }
  }

  get abiVersion(): number {
    return this.exports.dfy_abi_version();
  }

  private view(): Uint8Array {
    return new Uint8Array(this.memory.buffer);
  }

  private alloc(len: number): { ptr: number; len: number } {
    const ptr = this.exports.dfy_alloc(len) >>> 0;
    if (ptr === 0) throw new Error('dfy_alloc 返回空指针');
    return { ptr, len };
  }

  private free(region: { ptr: number; len: number }): void {
    try {
      this.exports.dfy_free(region.ptr, region.len);
    } catch {
      /* optional cleanup */
    }
  }

  /** Feed one JSON envelope and return the plug-in's JSON response plus any logs. */
  invoke(input: string): { output: string; logs: string[] } {
    if (this.closed) throw new Error('沙箱已关闭');
    const logs: string[] = [];
    const previousSink = this.logSink;
    this.logSink = (level, message) => {
      logs.push(message);
      previousSink?.(level, message);
    };
    try {
      const inBytes = encoder.encode(input);
      const inputRegion = this.alloc(inBytes.length);
      this.view().set(inBytes, inputRegion.ptr);
      let outCapacity = this.initialOutBytes;
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const outRegion = this.alloc(outCapacity);
          const written = this.exports.dfy_invoke(inputRegion.ptr, inBytes.length, outRegion.ptr, outCapacity) >>> 0;
          if (written > outCapacity) {
            // The plug-in reports the capacity it needs; retry with a larger buffer.
            this.free(outRegion);
            if (written > this.maxOutBytes) throw new Error(`插件响应过大：需要 ${written} 字节`);
            outCapacity = written;
            continue;
          }
          const output = decoder.decode(new Uint8Array(this.memory.buffer, outRegion.ptr, written));
          this.free(outRegion);
          return { output, logs };
        }
        throw new Error('插件未能在放大缓冲区后返回结果');
      } finally {
        this.free(inputRegion);
      }
    } finally {
      this.logSink = previousSink;
    }
  }

  close(): void {
    this.closed = true;
  }
}
