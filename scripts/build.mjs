import { build, context } from 'esbuild';
import { mkdir, cp } from 'node:fs/promises';
import { makeIcons } from './icons.mjs';
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await makeIcons();
const shared = {
  bundle: true,
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
};
const configs = [
  ...['recorder', 'voice-setup'].map((name) => ({
    ...shared,
    entryPoints: [`src/${name}.ts`],
    outfile: `dist/${name}.js`,
    format: 'iife',
  })),
  {
    ...shared,
    entryPoints: ['src/content.ts'],
    outfile: 'dist/content.js',
    format: 'iife',
    loader: { '.css': 'text' },
  },
  {
    ...shared,
    entryPoints: ['src/background.ts'],
    outfile: 'dist/background.js',
    format: 'esm',
  },
];
if (process.argv.includes('--watch')) {
  for (const options of configs) await (await context(options)).watch();
} else {
  await Promise.all(configs.map((options) => build(options)));
}
