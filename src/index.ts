import { resolveCacheDir } from './paths.js';
import { decodeToWav, writeTempInput } from './decoder.js';
import { ensureRuntime } from './runtime.js';
import { getRecognizer, withDecodeLock } from './recognizer.js';
import type { TranscribeOptions } from './types.js';

export type { TranscribeOptions, TranscribeProgress } from './types.js';

/**
 * Transcribe an audio/video file (any ffmpeg-supported container: ogg/opus,
 * mp3, m4a, wav, mp4…) to plain text. Fully local — downloads the speech
 * runtime and model weights into a shared user cache on first use.
 *
 * Throws on any failure (runtime install, download, decode, recognition);
 * callers decide how to surface errors.
 */
export async function transcribeAudio(
  filePath: string,
  opts: TranscribeOptions = {},
): Promise<string> {
  const cacheDir = resolveCacheDir(opts.cacheDir);
  const runtime = await ensureRuntime(cacheDir, opts);
  const { sherpa, recognizer } = await getRecognizer(cacheDir, opts);

  const { wavPath, cleanup } = await decodeToWav(filePath, runtime.ffmpegPath);
  try {
    return await withDecodeLock(cacheDir, opts, async () => {
      opts.onProgress?.({ stage: 'decode', message: 'Decoding audio…' });
      const wave = sherpa.readWave(wavPath);
      const stream = recognizer.createStream();
      stream.acceptWaveform({ samples: wave.samples, sampleRate: 16000 });
      opts.onProgress?.({ stage: 'recognize', message: 'Transcribing…' });
      await recognizer.decodeAsync(stream);
      const result = recognizer.getResult(stream) as { text?: string };
      return (result.text ?? '').trim();
    });
  } finally {
    cleanup();
  }
}

/**
 * Transcribe an in-memory audio buffer. `ext` should be a file extension or
 * mime subtype hint (e.g. `'ogg'`, `'.ogg'`, `'audio/ogg'`) so ffmpeg can
 * detect the container; without it ffmpeg probes the content anyway.
 */
export async function transcribeBuffer(
  buf: Buffer,
  extOrMime = '',
  opts: TranscribeOptions = {},
): Promise<string> {
  const ext = extOrMime.includes('/') ? extOrMime.split('/').pop() ?? '' : extOrMime;
  const { path, cleanup } = writeTempInput(buf, ext);
  try {
    return await transcribeAudio(path, opts);
  } finally {
    cleanup();
  }
}


