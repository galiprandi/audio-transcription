import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve the shared cache root. Order:
 * explicit option → AUDIO_TRANSCRIPTION_CACHE env → XDG_CACHE_HOME → ~/.cache
 * (Windows: %LOCALAPPDATA%).
 */
export function resolveCacheDir(override?: string): string {
  if (override) return override;
  if (process.env.AUDIO_TRANSCRIPTION_CACHE) return process.env.AUDIO_TRANSCRIPTION_CACHE;
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    return join(local || join(homedir(), 'AppData', 'Local'), 'audio-transcription');
  }
  const xdg = process.env.XDG_CACHE_HOME;
  return join(xdg || join(homedir(), '.cache'), 'audio-transcription');
}

export function cacheSubdir(cacheDir: string, name: 'runtime' | 'models' | 'locks' | 'tmp'): string {
  const dir = join(cacheDir, name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
