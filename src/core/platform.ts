import { win32, posix } from 'node:path';
import { homedir } from 'node:os';

export interface PlatformQuery {
  platform?: NodeJS.Platform;
  home?: string;
  env?: Record<string, string | undefined>;
}

/**
 * Where an installed Magpie app lives. Windows and macOS share this logic so
 * the same code finds Magpie on both platforms; only the paths differ.
 */
export function magpieAppCandidates({ platform = process.platform, home = homedir(), env = process.env }: PlatformQuery = {}): string[] {
  if (platform === 'darwin') {
    return ['/Applications/magpie.app', posix.join(home, 'Applications', 'magpie.app')];
  }
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local');
    return [
      win32.join(local, 'Programs', 'magpie', 'magpie.exe'),
      win32.join(local, 'magpie', 'magpie.exe'),
      ...[env.ProgramFiles, env['ProgramFiles(x86)']].filter((directory): directory is string => Boolean(directory))
        .map(directory => win32.join(directory, 'magpie', 'magpie.exe')),
    ];
  }
  return [];
}
