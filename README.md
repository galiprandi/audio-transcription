# audio-transcription

Local audio-to-text transcription for Node.js. One function call turns any
audio file (ogg/opus, mp3, m4a, wav, mp4…) into plain text — fully on-device,
no API keys, no cloud, no Python.

Built on [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (NeMo Parakeet
TDT 0.6B v3, int8) — fast, accurate for 25 European languages including
Spanish, and runs in real time or faster on CPU.

## Install

```bash
npm install audio-transcription
```

The package itself is tiny. On **first transcription** it lazily installs the
native runtime (`sherpa-onnx-node` + `ffmpeg-static`) and downloads the model
weights (~490MB) into a shared per-user cache — nothing happens at install or
import time. Subsequent runs reuse the cache.

## Usage

```ts
import { transcribeAudio, transcribeBuffer } from 'audio-transcription';

// From a file path
const text = await transcribeAudio('/path/to/voice.ogg');

// From a buffer (extension/mime hint optional — ffmpeg probes content anyway)
const text2 = await transcribeBuffer(oggBuffer, 'audio/ogg');
```

### Options

```ts
await transcribeAudio(path, {
  cacheDir: '/shared/cache',        // default: $XDG_CACHE_HOME/audio-transcription
  numThreads: 4,                    // default: min(8, availableParallelism())
  lockTimeoutMs: 600_000,           // default: 10min — max wait for the machine-wide decode lock
  onProgress: e => console.log(e),  // { stage, message } events during first-run setup
});
```

Environment override: `AUDIO_TRANSCRIPTION_CACHE=/path` sets the cache dir
globally.

## How it works

```
audio file ──ffmpeg-static──▶ 16kHz mono WAV ──sherpa-onnx Parakeet──▶ text
```

- **Runtime**: `npm install sherpa-onnx-node@2.0.1 ffmpeg-static@5.3.0` into
  `<cacheDir>/runtime`, guarded by an atomic mkdir lock so concurrent
  processes don't race.
- **Model**: `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2` (~490MB)
  downloaded to `<cacheDir>/models/`, extracted with system `tar`, activated
  via a `.complete` marker written last.
- **Decode**: serialized machine-wide through `<cacheDir>/locks/decode` — only
  one transcription runs at a time per machine regardless of how many
  processes use the library, so CPUs are never saturated.
- **Threads**: `numThreads` defaults to `min(8, os.availableParallelism())`;
  tune down on shared/weak machines.

## Cache layout

```
~/.cache/audio-transcription/
├── runtime/node_modules/     # sherpa-onnx-node + ffmpeg-static (~150MB)
├── models/parakeet-tdt-0.6b-v3/  # ONNX weights (~650MB uncompressed)
└── locks/                    # runtime-install, model-*, decode mutexes
```

## Requirements

- Node.js ≥ 20, `npm` on PATH (for the one-time runtime install), `tar`
- ~800MB disk for runtime + model, ~1GB RAM while a recognizer is loaded
  (per process; weights are mmap-backed page cache shared by the OS)
- First transcription downloads ~640MB total — expect minutes; `onProgress`
  reports download/extract stages.

## Errors

All failures throw. Common causes: no network/npm on first run, corrupted
archive, unsupported audio, decode-lock timeout (another transcription is
running — retry later).

## License

MIT
