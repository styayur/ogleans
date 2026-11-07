// SPDX-License-Identifier: MPL-2.0
import { build } from 'vite';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve('apps/browser-extension');
const outDir = resolve('dist/chromium');
await build({
  root,
  configFile: false,
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(root, 'popup.html'),
        options: resolve(root, 'options.html'),
      },
    },
  },
});
for (const name of ['background', 'content'])
  await build({
    configFile: false,
    build: {
      outDir,
      emptyOutDir: false,
      lib: {
        entry: resolve(root, `src/${name}.ts`),
        formats: [name === 'content' ? 'iife' : 'es'],
        fileName: () => `${name}.js`,
        name: 'Ogleans',
      },
      rollupOptions: { output: { codeSplitting: false } },
    },
  });
await copyFile(
  resolve(root, 'manifest.json'),
  resolve(outDir, 'manifest.json'),
);
await mkdir('dist/sdk', { recursive: true });
await build({
  configFile: false,
  build: {
    outDir: resolve('dist/sdk'),
    emptyOutDir: true,
    lib: {
      entry: resolve('packages/sdk/src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    minify: false,
  },
});
execFileSync(
  process.execPath,
  [
    resolve('node_modules/typescript/bin/tsc'),
    '--ignoreConfig',
    '--declaration',
    '--emitDeclarationOnly',
    '--outDir',
    'dist/sdk/types',
    '--rootDir',
    'packages',
    '--moduleResolution',
    'bundler',
    '--module',
    'ESNext',
    '--target',
    'ES2022',
    '--skipLibCheck',
    'packages/sdk/src/index.ts',
  ],
  { stdio: 'inherit' },
);
await writeFile(
  'dist/sdk/package.json',
  JSON.stringify(
    {
      name: '@ogleans/sdk',
      version: '0.2.0-alpha.1',
      type: 'module',
      exports: {
        '.': { types: './types/sdk/src/index.d.ts', import: './index.js' },
      },
      license: 'MPL-2.0',
    },
    null,
    2,
  ),
);
await build({
  configFile: false,
  build: {
    outDir: resolve('dist/examples'),
    emptyOutDir: true,
    lib: {
      entry: resolve('examples/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    minify: false,
  },
});
await copyFile('apps/browser-extension/LICENSE', resolve(outDir, 'LICENSE'));
await copyFile('LICENSE', resolve(outDir, 'MPL-2.0-LICENSE'));
await copyFile('LICENSE', 'dist/sdk/LICENSE');
await copyFile('NOTICE', resolve(outDir, 'NOTICE'));
await copyFile('NOTICE', 'dist/sdk/NOTICE');
await copyFile('node_modules/vite/LICENSE.md', 'dist/chromium/VITE-LICENSE');
await build({
  configFile: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: resolve('dist/fixtures'),
    emptyOutDir: true,
    lib: {
      entry: resolve('tests/fixtures/frameworks.ts'),
      formats: ['iife'],
      fileName: () => 'frameworks.js',
      name: 'Fixture',
    },
    rollupOptions: { output: { codeSplitting: false } },
  },
});
