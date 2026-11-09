import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const output = resolve('dist/extension');
await mkdir(output, { recursive: true });
await build({ entryPoints: ['apps/extension/popup.ts'], outfile: `${output}/popup.js`, bundle: true, platform: 'browser', format: 'esm', target: 'chrome109', minify: true });
for (const name of ['manifest.json', 'popup.html', 'popup.css']) await copyFile(resolve('apps/extension', name), resolve(output, name));
console.log(`Chrome MV3 extension built: ${output}`);
