import { execFileSync } from 'node:child_process';
import { existsSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Cross-platform process/binary resolution helpers.
 *
 * Windows notes:
 * - `npm` is `npm.cmd`; Node >=20.12 refuses to spawn .cmd/.bat without a
 *   shell, so we resolve `npm-cli.js` and run it with `process.execPath`.
 * - `ffmpeg-static` ships `ffmpeg.exe` on Windows.
 * - GNU tar treats `C:` as a remote host; Windows ships bsdtar at
 *   `%SystemRoot%\\System32\\tar.exe` which handles local paths correctly.
 */

let cachedNpmCli: string | null | undefined;

/** Absolute path to npm-cli.js, or null if npm cannot be located. */
export function resolveNpmCli(): string | null {
  if (cachedNpmCli !== undefined) return cachedNpmCli;
  cachedNpmCli = findNpmCli();
  return cachedNpmCli;
}

function findNpmCli(): string | null {
  const candidates: string[] = [];

  // 1) npm_execpath is set when running under an npm lifecycle script.
  if (process.env.npm_execpath) candidates.push(process.env.npm_execpath);

  // 2) Standard install next to the node binary.
  candidates.push(join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'));

  // 3) Ask the OS where `npm` lives and derive candidates from it.
  try {
    const whereBin = process.platform === 'win32' ? 'where.exe' : 'which';
    const out = execFileSync(whereBin, ['npm'], { encoding: 'utf8', timeout: 10_000 });
    for (const line of out.split(/\r?\n/)) {
      const p = line.trim();
      if (p) candidates.push(p);
    }
  } catch { /* which/where unavailable — fall through */ }

  for (const raw of candidates) {
    const cli = npmCliFromPath(raw);
    if (cli && existsSync(cli)) return cli;
  }
  return null;
}

/**
 * Derive the npm-cli.js path from a `which npm`/`where npm` result.
 * Handles: direct npm-cli.js path, npm shell wrapper (symlink), npm.cmd,
 * and npm.ps1.
 */
function npmCliFromPath(p: string): string | null {
  const norm = p.replace(/\\/g, '/');
  if (norm.endsWith('npm-cli.js')) return norm;

  // npm.cmd / npm.ps1 live in the prefix root; cli is under node_modules/npm.
  if (/npm\.(cmd|bat|ps1)$/i.test(norm)) {
    const prefix = dirname(norm);
    return join(prefix, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  }

  // npm shell wrapper: resolve symlink/realpath — usually ends at
  // <npm-root>/bin/npm-cli.js or <prefix>/lib/node_modules/npm/bin/npm-cli.js.
  try {
    const real = realpathSync(p);
    const r = npmCliFromPath(real);
    if (r) return r;
  } catch { /* broken symlink */ }
  try {
    const target = readlinkSync(p);
    const r = npmCliFromPath(join(dirname(p), target));
    if (r) return r;
  } catch { /* not a symlink */ }
  return null;
}

/**
 * Command + leading args to run `npm <args>` cross-platform.
 * Throws a clear error if npm cannot be located.
 */
export function npmInvocation(): { cmd: string; baseArgs: string[] } {
  const cli = resolveNpmCli();
  if (cli) return { cmd: process.execPath, baseArgs: [cli] };
  if (process.platform === 'win32') {
    throw new Error('npm not found. Install Node.js (which ships npm) or add npm to PATH.');
  }
  return { cmd: 'npm', baseArgs: [] };
}

/** Absolute path to the ffmpeg binary shipped by ffmpeg-static in `pkgDir`. */
export function findFfmpegBinary(pkgDir: string): string {
  const candidates = process.platform === 'win32'
    ? [join(pkgDir, 'ffmpeg.exe'), join(pkgDir, 'ffmpeg')]
    : [join(pkgDir, 'ffmpeg'), join(pkgDir, 'ffmpeg.exe')];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

/**
 * tar binary for extraction. On Windows prefer the system bsdtar
 * (System32\\tar.exe) — GNU tar misinterprets `C:\` as a remote host.
 */
export function tarCommand(): string {
  if (process.platform === 'win32') {
    const sysroot = process.env.SystemRoot || 'C:\\Windows';
    const bsdtar = join(sysroot, 'System32', 'tar.exe');
    if (existsSync(bsdtar)) return bsdtar;
  }
  return 'tar';
}
