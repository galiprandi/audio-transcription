import { execFile } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { cacheSubdir } from './paths.js';
import { withMutex } from './locks.js';
import type { TranscribeOptions } from './types.js';

const execFileAsync = promisify(execFile);

export interface ModelInfo {
  id: string;
  /** Directory inside <cacheDir>/models that holds the weights. */
  dirName: string;
  /** GitHub release asset URL for the tarball. */
  url: string;
  /** Expected member file names inside the tarball's top-level dir. */
  files: {
    encoder: string;
    decoder: string;
    joiner: string;
    tokens: string;
  };
}

/** sherpa-onnx NeMo Parakeet TDT 0.6B v3, int8 — ~490MB, 25 European languages. */
export const PARAKEET_V3: ModelInfo = {
  id: 'parakeet-tdt-0.6b-v3',
  dirName: 'parakeet-tdt-0.6b-v3',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2',
  files: {
    encoder: 'encoder.int8.onnx',
    decoder: 'decoder.int8.onnx',
    joiner: 'joiner.int8.onnx',
    tokens: 'tokens.txt',
  },
};

export interface ResolvedModel {
  dir: string;
  encoder: string;
  decoder: string;
  joiner: string;
  tokens: string;
}

/**
 * Ensure the model weights are downloaded + extracted under
 * `<cacheDir>/models/<dirName>` with a `.complete` marker. Serialized via
 * mutex; waiting processes re-check and skip once the winner finishes.
 */
export async function ensureModel(
  cacheDir: string,
  model: ModelInfo,
  opts: TranscribeOptions,
): Promise<ResolvedModel> {
  const modelsDir = cacheSubdir(cacheDir, 'models');
  const target = join(modelsDir, model.dirName);
  const marker = join(target, '.complete');

  const resolve = (): ResolvedModel => ({
    dir: target,
    encoder: join(target, model.files.encoder),
    decoder: join(target, model.files.decoder),
    joiner: join(target, model.files.joiner),
    tokens: join(target, model.files.tokens),
  });

  const isReady = () => {
    if (!existsSync(marker)) return false;
    const m = resolve();
    return [m.encoder, m.decoder, m.joiner, m.tokens].every(existsSync);
  };
  if (isReady()) return resolve();

  const locksDir = cacheSubdir(cacheDir, 'locks');
  await withMutex(locksDir, `model-${model.dirName}`, opts.lockTimeoutMs ?? 30 * 60 * 1000, async () => {
    if (isReady()) return; // winner finished while we waited
    opts.onProgress?.({ stage: 'model-download', message: `Downloading speech model ${model.id} (~490MB, first run only)…` });

    const tmpDir = join(modelsDir, `.tmp-${model.dirName}`);
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true, mode: 0o700 });

    try {
      const tarball = join(tmpDir, 'model.tar.bz2');
      await download(model.url, tarball, opts.onProgress);

      opts.onProgress?.({ stage: 'model-extract', message: 'Extracting speech model…' });
      await execFileAsync('tar', ['-xf', tarball, '-C', tmpDir], { timeout: 10 * 60 * 1000 });
      rmSync(tarball, { force: true });

      // The tarball contains a single top-level dir; find it.
      const inner = readdirSync(tmpDir).find(e => {
        try { return readdirSync(join(tmpDir, e)).includes(model.files.tokens); } catch { return false; }
      });
      if (!inner) throw new Error(`Model archive did not contain expected ${model.files.tokens}`);

      const innerDir = join(tmpDir, inner);
      for (const f of Object.values(model.files)) {
        if (!existsSync(join(innerDir, f))) {
          throw new Error(`Model archive missing ${f}`);
        }
      }

      rmSync(target, { recursive: true, force: true });
      renameSync(innerDir, target);
      // Write marker last — its presence means "fully installed".
      writeFileSync(marker, new Date().toISOString(), { mode: 0o600 });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  return resolve();
}

async function download(url: string, dest: string, onProgress?: TranscribeOptions['onProgress']): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Model download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let received = 0;
  let lastPct = -1;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      if (total > 0) {
        const pct = Math.floor((received / total) * 100);
        if (pct !== lastPct && pct % 25 === 0) {
          lastPct = pct;
          onProgress?.({ stage: 'model-download', message: `Downloading model… ${pct}%` });
        }
      }
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), counter, createWriteStream(dest, { mode: 0o600 }));
}
