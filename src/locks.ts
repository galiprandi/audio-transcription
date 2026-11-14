import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';

const POLL_MS = 500;
/** A lock older than this is considered stale (holder crashed). */
const STALE_MS = 30 * 60 * 1000;

export class LockTimeoutError extends Error {
  constructor(name: string, timeoutMs: number) {
    super(`Timed out waiting for lock "${name}" after ${timeoutMs}ms`);
    this.name = 'LockTimeoutError';
  }
}

/**
 * Cross-process mutex via atomic mkdir. Callers should check artifact
 * readiness BEFORE calling (and again inside fn) so waiting processes can
 * skip the work entirely once the winner finishes.
 */
export async function withMutex<T>(
  locksDir: string,
  name: string,
  timeoutMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const dir = join(locksDir, name);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(dir, { mode: 0o700 });
      break;
    } catch {
      try {
        if (Date.now() - statSync(dir).mtimeMs > STALE_MS) {
          rmSync(dir, { recursive: true, force: true });
          continue;
        }
      } catch { /* raced with removal — retry */ }
      if (Date.now() > deadline) throw new LockTimeoutError(name, timeoutMs);
      await sleep(Math.min(POLL_MS, Math.max(1, deadline - Date.now())));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function lockPath(locksDir: string, name: string): string {
  return join(locksDir, name);
}

export function isLocked(locksDir: string, name: string): boolean {
  return existsSync(lockPath(locksDir, name));
}
