import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';

const tests = process.argv.includes('--tests');
mkdirSync('dist/renderer', { recursive: true });

const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'es2022' };

await esbuild.build({ ...common, entryPoints: ['src/main/main.ts'], platform: 'node', format: 'cjs', external: ['electron', 'koffi'], outfile: 'dist/main.js' });
await esbuild.build({ ...common, entryPoints: ['src/main/match_worker.ts'], platform: 'node', format: 'cjs', outfile: 'dist/match_worker.js' });
await esbuild.build({ ...common, entryPoints: ['src/preload.ts'], platform: 'node', format: 'cjs', external: ['electron'], outfile: 'dist/preload.js' });
await esbuild.build({ ...common, entryPoints: ['src/renderer/renderer.ts'], platform: 'browser', format: 'iife', outfile: 'dist/renderer/renderer.js' });
cpSync('src/renderer/index.html', 'dist/renderer/index.html');
cpSync('src/renderer/styles.css', 'dist/renderer/styles.css');
await esbuild.build({ ...common, entryPoints: ['src/renderer/badges.ts'], platform: 'browser', format: 'iife', outfile: 'dist/renderer/badges.js' });
cpSync('src/renderer/badges.html', 'dist/renderer/badges.html');
cpSync('src/renderer/badges.css', 'dist/renderer/badges.css');

if (tests) {
  const files = readdirSync('test').filter(f => f.endsWith('.test.ts')).map(f => `test/${f}`);
  await esbuild.build({ ...common, entryPoints: files, platform: 'node', format: 'cjs', outdir: 'dist/test' });
}
