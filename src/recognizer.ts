import { availableParallelism } from 'node:os';
import { cacheSubdir, resolveCacheDir } from './paths.js';
import { withMutex } from './locks.js';
import { ensureModel, PARAKEET_V3, type ResolvedModel } from './model.js';
import { ensureRuntime, requireSherpa, type Runtime } from './runtime.js';
import type { TranscribeOptions } from './types.js';

interface RecognizerLike {
  createStream(): { acceptWaveform(obj: { samples: Float32Array; sampleRate: number }): void };
  decode(stream: unknown): Promise<void> | void;
  decodeAsync(stream: unknown): Promise<void>;
  getResult(stream: unknown): { text: string };
}

interface SherpaLike {
  OfflineRecognizer: {
    createAsync(config: Record<string, unknown>): Promise<RecognizerLike>;
  };
  readWave(path: string): { samples: Float32Array };
}

let cached: { key: string; sherpa: SherpaLike; recognizer: RecognizerLike } | null = null;
let pending: Promise<RecognizerLike> | null = null;

function defaultThreads(): number {
  try {
    return Math.max(1, Math.min(8, availableParallelism()));
  } catch {
    return 4;
  }
}

/**
 * Process-wide singleton recognizer. Model + runtime are loaded once; the
 * decode step is serialized across ALL processes on this machine via a
 * mutex in the shared cache dir (one decode at a time per machine).
 */
export async function getRecognizer(
  cacheDir: string,
  opts: TranscribeOptions,
): Promise<{ sherpa: SherpaLike; recognizer: RecognizerLike }> {
  const numThreads = opts.numThreads ?? defaultThreads();
  const key = `${cacheDir}:${numThreads}`;
  if (cached?.key === key) return cached;

  pending ??= (async () => {
    const runtime: Runtime = await ensureRuntime(cacheDir, opts);
    const model: ResolvedModel = await ensureModel(cacheDir, PARAKEET_V3, opts);
    const sherpa = requireSherpa(runtime) as SherpaLike;
    opts.onProgress?.({ stage: 'recognize', message: 'Loading speech model into memory…' });
    const recognizer = await sherpa.OfflineRecognizer.createAsync({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: model.encoder,
          decoder: model.decoder,
          joiner: model.joiner,
        },
        tokens: model.tokens,
        numThreads,
        provider: 'cpu',
        debug: 0,
      },
      decodingMethod: 'greedy_search',
    });
    cached = { key, sherpa, recognizer };
    return recognizer;
  })().finally(() => { pending = null; });

  const recognizer = await pending;
  return { sherpa: cached!.sherpa, recognizer };
}

/**
 * Run one transcription under the machine-wide decode mutex so concurrent
 * bridges/processes never saturate the CPU.
 */
export async function withDecodeLock<T>(
  cacheDir: string,
  opts: TranscribeOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const locksDir = cacheSubdir(cacheDir, 'locks');
  return withMutex(locksDir, 'decode', opts.lockTimeoutMs ?? 10 * 60 * 1000, fn);
}

export function defaultCacheDir(): string {
  return resolveCacheDir();
}
