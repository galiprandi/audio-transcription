# AGENTS.md — audio-transcription

Local audio-to-text for Node.js: `transcribeAudio(path)` / `transcribeBuffer(buf, ext)` → text. Lazy-installs sherpa-onnx (Parakeet TDT v3) + ffmpeg-static into a shared per-user cache on first use.

## Stack

- TypeScript (ESM), Node ≥ 20, tsc build, Vitest
- Runtime deps installed lazily at first transcription (NOT package deps):
  `sherpa-onnx-node@2.0.1`, `ffmpeg-static@5.3.0` — pinned in `src/runtime.ts`
- Model: `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` (~490MB) — pinned in `src/model.ts`

## Commands

- `pnpm build` / `pnpm typecheck` / `pnpm test`
- Real transcription tests: `AUDIO_TRANSCRIPTION_CACHE=<populated cache> pnpm test`
  (auto-skip without cache; `AUDIO_TRANSCRIPTION_E2E=1` forces)

## MONITOR — this field moves fast, check regularly

The ASR/speech ecosystem evolves quickly. **Periodically review (monthly or
before any release) for:**

- **New sherpa-onnx releases**: `npm view sherpa-onnx-node version` — bump the
  pinned version in `src/runtime.ts` after verifying API compatibility
  (`OfflineRecognizer.createAsync`, `readWave`, `acceptWaveform` signatures
  may change between majors).
- **New/better models**: Parakeet TDT versions (v3 → next), Moonshine,
  whisper.cpp, NVIDIA Parakeet updates — check
  `github.com/k2-fsa/sherpa-onnx/releases` (`asr-models` tag) and
  `github.com/istupakov/sherpa-onnx` mirrors for new int8 ONNX bundles.
  A newer/better model = update `src/model.ts` (URL + file names) and bump
  the package minor version.
- **ffmpeg-static**: `npm view ffmpeg-static version` — bump pin; verify the
  static binary still ships in-package (npm allow-scripts may block its
  install script on newer npm — we rely on the bundled binary).
- **API stability**: if `sherpa-onnx-node` breaks or stalls, evaluate
  whisper.cpp bindings (`whisper-node`) or transformers.js as alternate
  engines — the public API (`transcribeAudio`/`transcribeBuffer`) must NOT
  change; engines are internal.
- **Languages**: Parakeet v3 covers 25 European languages. If a user needs
  others (e.g. Chinese), that's a model swap — keep `transcribeAudio` stable.

## Rules

- Commits: Conventional Commits. Tests + docs in English.
- Never add the heavy runtime/model as package dependencies — lazy install
  into the user cache is the core design (keeps `npm i` cheap).
- All spawns use arg arrays (no shell) — `cacheDir` is user-controlled.
- File writes: `0600`, dirs `0700`, temp dirs under `os.tmpdir()` cleaned in
  `finally`.
- Locks: reuse `withMutex` from `src/locks.ts` for any new cross-process
  setup step; check artifact-readiness before AND inside the mutex.

## Release

Manual: bump `package.json`, `pnpm build`, `gh release create vX.Y.Z` →
`.github/workflows/publish.yml` publishes via OIDC trusted publishing
(configured with `npm trust github`). First publish of any NEW package name
may sit in npm's staged-review queue (`0.0.0-stage` placeholder) — approve at
npmjs.com → package → Staged Packages.
