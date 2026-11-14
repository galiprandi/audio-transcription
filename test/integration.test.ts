import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveCacheDir } from '../src/paths.js';
import { transcribeAudio } from '../src/index.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/voice-test.ogg', import.meta.url));

/**
 * Real end-to-end transcription tests. They need the runtime + model cache
 * (~640MB) — auto-skipped unless AUDIO_TRANSCRIPTION_E2E=1 or the default
 * cache already contains a completed model install. CI never runs these.
 */
const cacheDir = resolveCacheDir(process.env.AUDIO_TRANSCRIPTION_CACHE);
const modelReady = existsSync(join(cacheDir, 'models', 'parakeet-tdt-0.6b-v3', '.complete'));
const runtimeReady = existsSync(join(cacheDir, 'runtime', 'node_modules', 'sherpa-onnx-node'));
const RUN = (process.env.AUDIO_TRANSCRIPTION_E2E === '1' || (modelReady && runtimeReady));

const OPTS = {
  cacheDir: process.env.AUDIO_TRANSCRIPTION_CACHE || undefined,
  numThreads: 4,
};

describe.runIf(RUN)('integration: real transcription', () => {
  it('transcribes a voice fixture to the expected text', async () => {
    const text = await transcribeAudio(FIXTURE, { ...OPTS, onProgress: () => {} });
    expect(text.length).toBeGreaterThan(0);
    // TTS fixture says "This is a voice transcription test."
    expect(text.toLowerCase()).toContain('transcription');
  }, 300_000);

  it('rejects on undecodable input and cleans up', async () => {
    const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'at-e2e-'));
    const bad = join(dir, 'not-audio.bin');
    writeFileSync(bad, 'this is not audio at all');
    try {
      await expect(transcribeAudio(bad, OPTS)).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});

describe.runIf(!RUN)('integration: skipped', () => {
  it('real transcription tests skipped (no populated cache)', () => {
    expect(RUN).toBe(false);
  });
});
