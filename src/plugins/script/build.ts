/**
 * Compiles a user's Zig source into a plug-in module, on this machine.
 *
 * This is the "WindHawk" half of the story: the user writes code, the app turns
 * it into a WASM module with the Zig they already have installed, and the file
 * lands in their local plug-in directory. Nothing leaves the device.
 *
 * The command line below is deliberately fixed. Zig 0.17 runs wasm-ld with
 * `--gc-sections`, so symbols the SDK defines with `@export` are dropped unless
 * each one is also named on the command line; without the four `--export=`
 * flags the module links but exports nothing and the loader rejects it.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { ScriptSandbox } from './sandbox.ts';
import { buildHostInput, parseScriptResponse } from './abi.ts';

export interface ZigCompileRequest {
  /** The user's `main.zig` (or any `.zig` file) — copied in as `main.zig`. */
  sourcePath: string;
  /** Path to the bundled SDK, `sdk/dfy.zig`. */
  sdkPath: string;
  /** Scratch directory for the build; a temp dir is created when omitted. */
  workDir?: string;
  /** Override the Zig executable; otherwise `zig` is looked up on PATH. */
  zigPath?: string;
  /** Cache directories to keep builds warm (normally under `userData`). */
  cacheDir?: string;
  globalCacheDir?: string;
  /** Hard cap on the compiler run. */
  timeoutMs?: number;
}

export type ZigCompileResult =
  | { ok: true; wasm: Uint8Array; outputName: string }
  | { ok: false; error: string; detail?: string };

const EXPORT_FLAGS = [
  '--export=dfy_abi_version',
  '--export=dfy_alloc',
  '--export=dfy_free',
  '--export=dfy_invoke',
];

/** Locate the Zig executable: an explicit path, then PATH (`zig` / `zig.exe`). */
export function findZig(explicit?: string): string | null {
  if (explicit && existsSync(explicit)) return explicit;
  const pathValue = process.env.PATH ?? process.env.Path ?? '';
  const names = process.platform === 'win32' ? ['zig.exe', 'zig'] : ['zig'];
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = join(directory, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function clip(text: string, limit = 1_200): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

/**
 * Run the compiler and validate the artifact by loading it in the sandbox and
 * sending an `install` event. A module that compiles but cannot answer the ABI
 * is rejected here rather than at run time.
 */
export async function compileZigPlugin(request: ZigCompileRequest): Promise<ZigCompileResult> {
  const zig = findZig(request.zigPath);
  if (!zig) {
    return {
      ok: false,
      error: '未找到 Zig 编译器',
      detail: '请安装 Zig 0.17 或更新版本，并确认 `zig version` 能在终端运行。',
    };
  }
  if (!existsSync(request.sourcePath)) return { ok: false, error: '找不到源文件' };
  if (!existsSync(request.sdkPath)) return { ok: false, error: '找不到内置 SDK（sdk/dfy.zig）' };

  const temporary = !request.workDir;
  const workDir = request.workDir ?? mkdtempSync(join(process.env.TEMP ?? process.env.TMPDIR ?? '.', 'dfy-build-'));
  try {
    mkdirSync(workDir, { recursive: true });
    copyFileSync(request.sdkPath, join(workDir, 'dfy.zig'));
    copyFileSync(request.sourcePath, join(workDir, 'main.zig'));

    const args = [
      'build-exe',
      '-O', 'ReleaseSmall',
      '-target', 'wasm32-freestanding',
      '-fno-entry',
      ...EXPORT_FLAGS,
      ...(request.cacheDir ? ['--cache-dir', request.cacheDir] : []),
      ...(request.globalCacheDir ? ['--global-cache-dir', request.globalCacheDir] : []),
      'main.zig',
    ];
    const result = spawnSync(zig, args, {
      cwd: workDir,
      encoding: 'utf8',
      timeout: request.timeoutMs ?? 120_000,
      windowsHide: true,
    });
    const stderr = `${result.stderr ?? ''}`;
    if (result.error) {
      return { ok: false, error: '编译进程启动失败', detail: clip(result.error.message) };
    }
    if (result.status !== 0) {
      return {
        ok: false,
        error: `Zig 编译失败（退出码 ${result.status ?? '未知'}）`,
        detail: clip(stderr || `${result.stdout ?? ''}`),
      };
    }
    const wasmPath = join(workDir, 'main.wasm');
    if (!existsSync(wasmPath)) {
      return { ok: false, error: '编译未生成 main.wasm', detail: clip(stderr) };
    }
    const wasm = new Uint8Array(readFileSync(wasmPath));
    const check = await verifyWasm(wasm);
    if (!check.ok) return { ok: false, error: check.error, detail: check.detail };
    return { ok: true, wasm, outputName: 'plugin.wasm' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (temporary) rmSync(workDir, { recursive: true, force: true });
  }
}

/** Load a candidate module and let it answer one `install` event. */
export async function verifyWasm(wasm: Uint8Array): Promise<{ ok: true } | { ok: false; error: string; detail?: string }> {
  let sandbox: ScriptSandbox | null = null;
  try {
    sandbox = await ScriptSandbox.create(wasm);
    const input = buildHostInput(
      { id: 'verify', version: '0.0.0' },
      { type: 'install' },
      { interests: [], options: {}, locale: 'zh-CN' },
      {},
      Date.now(),
    );
    const { output } = sandbox.invoke(JSON.stringify(input));
    const parsed = parseScriptResponse(JSON.parse(output));
    if (!parsed.ok) return { ok: false, error: `模块响应无效：${parsed.error}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    sandbox?.close();
  }
}

/** Write a compiled module into a plug-in directory. */
export function writeModule(directory: string, wasm: Uint8Array, name = 'plugin.wasm'): string {
  mkdirSync(directory, { recursive: true });
  const target = join(directory, name);
  writeFileSync(target, wasm);
  return target;
}
