import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findFfmpegBinary, npmInvocation, resolveNpmCli, tarCommand } from '../src/platform.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'at-plat-'));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe('resolveNpmCli', () => {
  it('locates an existing npm-cli.js on this machine', () => {
    const cli = resolveNpmCli();
    expect(cli).not.toBeNull();
    if (process.platform !== 'win32') {
      // On POSIX we can fall back to bare `npm`, but a resolved cli is still valid.
      expect(cli).toMatch(/npm-cli\.js$/);
    }
  });
});

describe('npmInvocation', () => {
  it('returns a runnable command + args', () => {
    const inv = npmInvocation();
    expect(inv.cmd.length).toBeGreaterThan(0);
    if (resolveNpmCli()) {
      expect(inv.baseArgs[0]).toMatch(/npm-cli\.js$/);
    }
  });
});

describe('findFfmpegBinary', () => {
  it('prefers the platform-native name', () => {
    const dir = tmp();
    const native = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const other = process.platform === 'win32' ? 'ffmpeg' : 'ffmpeg.exe';
    writeFileSync(join(dir, other), '');
    writeFileSync(join(dir, native), '');
    expect(findFfmpegBinary(dir)).toBe(join(dir, native));
  });

  it('falls back to the alternate name when native is missing', () => {
    const dir = tmp();
    const other = process.platform === 'win32' ? 'ffmpeg' : 'ffmpeg.exe';
    writeFileSync(join(dir, other), '');
    expect(findFfmpegBinary(dir)).toBe(join(dir, other));
  });

  it('returns a deterministic default when nothing exists', () => {
    const dir = tmp();
    const expected = join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    expect(findFfmpegBinary(dir)).toBe(expected);
  });
});

describe('tarCommand', () => {
  it('returns a non-empty command name', () => {
    expect(tarCommand().length).toBeGreaterThan(0);
  });

  it('on Windows prefers the system bsdtar when present', () => {
    if (process.platform !== 'win32') return;
    const sysroot = process.env.SystemRoot || 'C:\\Windows';
    expect(tarCommand()).toBe(join(sysroot, 'System32', 'tar.exe'));
  });
});
