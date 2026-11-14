import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { cacheSubdir, resolveCacheDir } from './paths.js';
import { findFfmpegBinary, npmInvocation } from './platform.js';
import { withMutex } from './locks.js';
import type { TranscribeOptions, TranscribeProgress } from './types.js';

const execFileAsync = promisify(execFile);

export const SHERPA_ONNX_NODE_VERSION = '2.0.1';
export const FFMPEG_STATIC_VERSION = '5.3.0';

const NPM_TIMEOUT_MS = 10 * 60 * 1000;

export interface Runtime {
  /** Absolute path to the sherpa-onnx-node package entry (for createRequire). */
  sherpaEntry: string;
  /** Absolute path to the ffmpeg-static binary. */
  ffmpegPath: string;
}

/**
 * Lazily `npm install`s sherpa-onnx-node + ffmpeg-static into
 * `<cacheDir>/runtime` on first use. Serialized across processes via mutex;
 * artifact check (node_modules + ffmpeg binary) lets late waiters skip.
 */
export async function ensureRuntime(
  cacheDir: string,
  opts: TranscribeOptions,
): Promise<Runtime> {
  const runtimeDir = cacheSubdir(cacheDir, 'runtime');
  const ffmpegPkgDir = join(runtimeDir, 'node_modules', 'ffmpeg-static');
  const sherpaEntry = join(runtimeDir, 'node_modules', 'sherpa-onnx-node', 'non-streaming-asr.js');

  const ready = () => {
    if (!existsSync(sherpaEntry)) return false;
    // ffmpeg-static may not be installed yet — its dir appears only after install.
    return existsSync(ffmpegPkgDir) && existsSync(findFfmpegBinary(ffmpegPkgDir));
  };
  if (ready()) return loadRuntime(runtimeDir);

  const locksDir = cacheSubdir(cacheDir, 'locks');
  await withMutex(locksDir, 'runtime-install', opts.lockTimeoutMs ?? 10 * 60 * 1000, async () => {
    if (ready()) return;
    opts.onProgress?.({ stage: 'runtime-install', message: 'Installing speech runtime (first run only)…' });
    const npm = npmInvocation();
    await execFileAsync(npm.cmd, [
      ...npm.baseArgs,
      'install',
      '--prefix', runtimeDir,
      `sherpa-onnx-node@${SHERPA_ONNX_NODE_VERSION}`,
      `ffmpeg-static@${FFMPEG_STATIC_VERSION}`,
      '--no-audit', '--no-fund',
    ], { timeout: NPM_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
    if (!ready()) {
      throw new Error(
        'Runtime install finished but sherpa-onnx-node or ffmpeg binary is missing. ' +
        `Check ${runtimeDir}/node_modules and npm logs.`,
      );
    }
  });

  return loadRuntime(runtimeDir);
}

function loadRuntime(runtimeDir: string): Runtime {
  return {
    sherpaEntry: join(runtimeDir, 'node_modules', 'sherpa-onnx-node', 'non-streaming-asr.js'),
    ffmpegPath: findFfmpegBinary(join(runtimeDir, 'node_modules', 'ffmpeg-static')),
  };
}

/** Load the sherpa-onnx-node CJS module via createRequire (ESM-safe). */
export function requireSherpa(runtime: Runtime): any {
  const req = createRequire(runtime.sherpaEntry);
  return req('sherpa-onnx-node');
}

export { resolveCacheDir };
