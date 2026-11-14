import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureModel, type ModelInfo, PARAKEET_V3 } from '../src/model.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'at-model-'));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function populateModel(cacheDir: string): void {
  const dir = join(cacheDir, 'models', PARAKEET_V3.dirName);
  mkdirSync(dir, { recursive: true });
  for (const f of Object.values(PARAKEET_V3.files)) writeFileSync(join(dir, f), 'x');
  writeFileSync(join(dir, '.complete'), new Date().toISOString());
}

/** Build a tiny fake model tarball and serve it over localhost HTTP. */
async function serveTarball(files: Record<string, string>): Promise<{ url: string; close: () => void }> {
  const work = tmp();
  const inner = join(work, 'fake-model-v1');
  mkdirSync(inner, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(inner, name), content);
  const tarball = join(work, 'model.tar.bz2');
  execFileSync('tar', ['-cjf', tarball, '-C', work, 'fake-model-v1']);
  const bytes = (await import('node:fs')).readFileSync(tarball);

  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-length': bytes.length });
    res.end(bytes);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/model.tar.bz2`,
    close: () => server.close(),
  };
}

const TINY_MODEL: ModelInfo = {
  id: 'tiny-test',
  dirName: 'tiny-test',
  url: '', // filled per-test
  files: { encoder: 'enc.onnx', decoder: 'dec.onnx', joiner: 'join.onnx', tokens: 'tokens.txt' },
};

describe('ensureModel', () => {
  it('returns resolved paths without network when .complete marker + files exist', async () => {
    const cache = tmp();
    populateModel(cache);
    const m = await ensureModel(cache, PARAKEET_V3, {});
    expect(m.encoder).toContain(PARAKEET_V3.files.encoder);
    expect(m.tokens).toContain(PARAKEET_V3.files.tokens);
  });

  it('downloads, extracts, validates and marks a model end-to-end', async () => {
    const cache = tmp();
    const srv = await serveTarball({
      'enc.onnx': 'e', 'dec.onnx': 'd', 'join.onnx': 'j', 'tokens.txt': 't',
    });
    try {
      const model = { ...TINY_MODEL, url: srv.url };
      const m = await ensureModel(cache, model, {});
      expect(m.dir).toContain('tiny-test');
      const { existsSync, readFileSync } = await import('node:fs');
      expect(readFileSync(m.tokens, 'utf8')).toBe('t');
      expect(existsSync(join(m.dir, '.complete'))).toBe(true);
      // Second call must not hit the network again.
      const m2 = await ensureModel(cache, model, {});
      expect(m2.encoder).toBe(m.encoder);
    } finally {
      srv.close();
    }
  }, 30_000);

  it('rejects when the archive lacks expected files', async () => {
    const cache = tmp();
    const srv = await serveTarball({ 'enc.onnx': 'e', 'tokens.txt': 't' }); // missing dec/join
    try {
      const model = { ...TINY_MODEL, url: srv.url };
      await expect(ensureModel(cache, model, {})).rejects.toThrow(/missing|did not contain/);
    } finally {
      srv.close();
    }
  }, 30_000);

  it('rejects on HTTP error', async () => {
    const cache = tmp();
    const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      await expect(
        ensureModel(cache, { ...TINY_MODEL, url: `http://127.0.0.1:${port}/x` }, {})
      ).rejects.toThrow(/404/);
    } finally {
      server.close();
    }
  }, 30_000);
});
