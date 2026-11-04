// @vitest-environment node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createServer } from 'vite';
import { expect, it } from 'vitest';

it('resolves every browser Firebase SDK import locally when its CDN is unavailable', async () => {
  const root = process.cwd();
  const files = await readdir(path.join(root, 'src'), { recursive: true });
  const imports = [];
  for (const file of files.filter(file => /\.[jt]sx?$/.test(file))) {
    const source = await readFile(path.join(root, 'src', file), 'utf8');
    for (const match of source.matchAll(/from\s+['"](https:\/\/www\.gstatic\.com\/firebasejs\/[^'"]+)['"]/g))
      imports.push({ specifier: match[1], file: path.join(root, 'src', file) });
  }
  expect(imports.length).toBeGreaterThan(0);
  const server = await createServer({ root, configFile: path.join(root, 'vite.config.js'), mode: 'production', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, watch: null } });
  try {
    for (const entry of imports) {
      const resolved = await server.pluginContainer.resolveId(entry.specifier, entry.file);
      expect(resolved?.external, entry.file).not.toBe(true);
      expect(resolved?.id, entry.file).not.toMatch(/^https?:/);
      expect(resolved?.id, entry.file).toContain('node_modules');
    }
  } finally { await server.close(); }
}, 15000);
