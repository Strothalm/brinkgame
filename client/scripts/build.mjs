// Bundles the renderer into client/dist (used by Electron and served by the server for browsers).
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

fs.mkdirSync(dist, { recursive: true });

const options = {
  entryPoints: [path.join(root, 'src/renderer/main.jsx')],
  bundle: true,
  outfile: path.join(dist, 'app.js'),
  format: 'iife',
  target: ['chrome120'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  loader: { '.woff2': 'file', '.woff': 'file', '.svg': 'file', '.png': 'file' },
  assetNames: 'assets/[name]-[hash]',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'info',
};

function copyStatic() {
  fs.copyFileSync(path.join(root, 'src/renderer/index.html'), path.join(dist, 'index.html'));
  const flagsSrc = path.join(root, 'node_modules/flag-icons/flags/4x3');
  const flagsDst = path.join(dist, 'flags');
  fs.mkdirSync(flagsDst, { recursive: true });
  for (const f of fs.readdirSync(flagsSrc)) {
    if (f.endsWith('.svg')) fs.copyFileSync(path.join(flagsSrc, f), path.join(flagsDst, f));
  }
  const bgSrc = path.join(root, 'src/renderer/backgrounds');
  if (fs.existsSync(bgSrc)) {
    const bgDst = path.join(dist, 'backgrounds');
    fs.mkdirSync(bgDst, { recursive: true });
    for (const f of fs.readdirSync(bgSrc)) fs.copyFileSync(path.join(bgSrc, f), path.join(bgDst, f));
  }
  const icon = path.join(root, 'build/icon.png');
  if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(dist, 'icon.png'));
}

copyStatic();
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching…');
} else {
  await esbuild.build(options);
}
