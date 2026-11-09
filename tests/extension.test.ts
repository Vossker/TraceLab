import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

test('MV3 manifest uses only user-initiated permissions and local scripts', async () => {
  const manifest = JSON.parse(await readFile('apps/extension/manifest.json', 'utf8'));
  assert.equal(manifest.manifest_version, 3); assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']); assert.equal(manifest.host_permissions, undefined);
  const html = await readFile('apps/extension/popup.html', 'utf8'); assert.match(html, /src="popup.js"/); assert.ok(!html.includes('https://api.'));
});
test('popup recognizes creator, reads visible profile, opens Dashboard and supports manual input', async () => {
  const bundle = await build({ entryPoints: ['apps/extension/popup.ts'], bundle: true, write: false, format: 'iife', platform: 'browser' });
  const listeners = new Map<string, (event: { preventDefault: () => void }) => void>();
  const elements = new Map<string, { value: string; textContent: string; hidden: boolean; className: string; addEventListener: (event: string, callback: (e: { preventDefault: () => void }) => void) => void }>();
  const get = (id: string) => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', hidden: true, className: '', addEventListener: (event, cb) => listeners.set(`${id}:${event}`, cb) });
    return elements.get(id)!;
  };
  const opened: string[] = [];
  const chrome = { storage: { local: { get: async () => ({}), set: async () => undefined } }, tabs: { query: async () => [{ id: 1, url: 'https://space.bilibili.com/123456/video' }], create: async (input: { url: string }) => { opened.push(input.url); } }, scripting: { executeScript: async () => [{ result: { name: '页面中的创作者', avatar: null } }] } };
  runInNewContext(bundle.outputFiles[0].text, { chrome, document: { getElementById: get }, URL, console });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(get('creator-url').value, 'https://space.bilibili.com/123456'); assert.equal(get('creator-name').textContent, '页面中的创作者');
  listeners.get('form:submit')!({ preventDefault() {} }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(new URL(opened[0]).searchParams.get('creator'), 'https://space.bilibili.com/123456');
  assert.equal(new URL(opened[0]).searchParams.get('source'), 'public');
  get('creator-url').value = '98765'; listeners.get('form:submit')!({ preventDefault() {} }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(new URL(opened[1]).searchParams.get('creator'), 'https://space.bilibili.com/98765');
  listeners.get('demo:click')!({ preventDefault() {} }); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(new URL(opened[2]).searchParams.get('report'), 'demo');
});
