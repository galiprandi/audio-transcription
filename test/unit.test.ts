import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LockTimeoutError, isLocked, withMutex } from '../src/locks.js';
import { resolveCacheDir } from '../src/paths.js';
import { writeTempInput } from '../src/decoder.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'at-test-'));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe('withMutex', () => {
  it('runs fn exclusively and releases the lock', async () => {
    const locks = tmp();
    let inside = false;
    const order: string[] = [];
    await Promise.all([
      withMutex(locks, 'a', 5000, async () => { inside = true; await new Promise(r => setTimeout(r, 30)); order.push('first'); inside = false; }),
      withMutex(locks, 'a', 5000, async () => { expect(inside).toBe(false); order.push('second'); }),
    ]);
    expect(order).toEqual(['first', 'second']);
    expect(isLocked(locks, 'a')).toBe(false);
  });

  it('times out when the lock is held', async () => {
    const locks = tmp();
    const holder = withMutex(locks, 'b', 60_000, () => new Promise(r => setTimeout(r, 2000)));
    await expect(withMutex(locks, 'b', 300, async () => 'never')).rejects.toBeInstanceOf(LockTimeoutError);
    await holder;
  });

  it('releases the lock even when fn throws', async () => {
    const locks = tmp();
    await expect(withMutex(locks, 'c', 5000, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(isLocked(locks, 'c')).toBe(false);
    await expect(withMutex(locks, 'c', 5000, async () => 'ok')).resolves.toBe('ok');
  });
});

describe('resolveCacheDir', () => {
  it('prefers the explicit override', () => {
    expect(resolveCacheDir('/custom/dir')).toBe('/custom/dir');
  });

  it('honors AUDIO_TRANSCRIPTION_CACHE env', () => {
    const prev = process.env.AUDIO_TRANSCRIPTION_CACHE;
    process.env.AUDIO_TRANSCRIPTION_CACHE = '/env/cache';
    try {
      expect(resolveCacheDir()).toBe('/env/cache');
    } finally {
      if (prev === undefined) delete process.env.AUDIO_TRANSCRIPTION_CACHE;
      else process.env.AUDIO_TRANSCRIPTION_CACHE = prev;
    }
  });

  it('honors XDG_CACHE_HOME on linux', () => {
    if (process.platform === 'win32') return;
    const prevXdg = process.env.XDG_CACHE_HOME;
    const prevEnv = process.env.AUDIO_TRANSCRIPTION_CACHE;
    delete process.env.AUDIO_TRANSCRIPTION_CACHE;
    process.env.XDG_CACHE_HOME = '/xdg/cache';
    try {
      expect(resolveCacheDir()).toBe('/xdg/cache/audio-transcription');
    } finally {
      if (prevXdg === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = prevXdg;
      if (prevEnv !== undefined) process.env.AUDIO_TRANSCRIPTION_CACHE = prevEnv;
    }
  });
});

describe('writeTempInput', () => {
  it('writes the buffer with a sanitized extension and cleans up', async () => {
    const { path, cleanup } = writeTempInput(Buffer.from('fake-audio'), 'ogg');
    expect(path).toMatch(/\.ogg$/);
    cleanup();
    expect(() => import('node:fs').then(fs => fs.accessSync(path))).rejects.toThrow();
  });

  it('sanitizes dangerous extensions', () => {
    const { path, cleanup } = writeTempInput(Buffer.from('x'), 'og g;rm -rf');
    expect(path).not.toContain(' ');
    cleanup();
  });
});
