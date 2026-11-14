export interface TranscribeOptions {
  /**
   * Root cache directory for the runtime (npm-installed native modules) and
   * model weights. Shared across all consumers on this machine/user.
   * Resolution order: this option → `AUDIO_TRANSCRIPTION_CACHE` env →
   * `$XDG_CACHE_HOME/audio-transcription` → `~/.cache/audio-transcription`
   * (Windows: `%LOCALAPPDATA%/audio-transcription`).
   */
  cacheDir?: string;
  /**
   * ONNX Runtime threads for decoding. Default: `min(8, os.availableParallelism())`.
   * Lower this on shared or weak machines.
   */
  numThreads?: number;
  /**
   * How long to wait for another process's decode lock before failing.
   * Default: 10 minutes.
   */
  lockTimeoutMs?: number;
  /**
   * Called with progress events during first-time setup (runtime install,
   * model download). Optional.
   */
  onProgress?: (event: TranscribeProgress) => void;
}

export interface TranscribeProgress {
  stage: 'runtime-install' | 'model-download' | 'model-extract' | 'decode' | 'recognize';
  message: string;
}
