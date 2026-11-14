import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const FFMPEG_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Decode any ffmpeg-supported audio/video file to a 16kHz mono WAV in a temp
 * dir. Returns the wav path; caller must pass it to `cleanup` (or use
 * `decodeToWav` which returns both).
 */
export async function decodeToWav(
  inputPath: string,
  ffmpegPath: string,
): Promise<{ wavPath: string; cleanup: () => void; durationHint?: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'audio-transcription-'));
  const wavPath = join(dir, 'audio.wav');
  try {
    await execFileAsync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inputPath,
      '-ac', '1', '-ar', '16000', '-f', 'wav', wavPath,
    ], { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`Audio decode failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return {
    wavPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Write a buffer to a temp file with the given extension (for container formats). */
export function writeTempInput(buf: Buffer, ext: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'audio-transcription-in-'));
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
  const path = join(dir, `input${safeExt.startsWith('.') ? safeExt : `.${safeExt}`}`);
  writeFileSync(path, buf, { mode: 0o600 });
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
