// Bundles everything with esbuild: Electron main + preload, the MCP server and the renderer.
import { build, context } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const watch = process.argv.includes('--watch');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

const define = { __JAFFLOOP_VERSION__: JSON.stringify(pkg.version) };
const nodeCommon = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  define,
  // electron is provided at runtime; node:sqlite is a built-in
  external: ['electron'],
};

const targets = [
  { name: 'main', ...nodeCommon, entryPoints: [path.join(root, 'src/main/main.ts')], outfile: path.join(root, 'dist/main/main.cjs') },
  { name: 'preload', ...nodeCommon, entryPoints: [path.join(root, 'src/main/preload.ts')], outfile: path.join(root, 'dist/main/preload.cjs') },
  { name: 'mcp', ...nodeCommon, entryPoints: [path.join(root, 'src/mcp/server.ts')], outfile: path.join(root, 'dist/mcp/server.cjs') },
  {
    name: 'renderer',
    entryPoints: [path.join(root, 'src/renderer/index.tsx')],
    outfile: path.join(root, 'dist/renderer/app.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome140',
    sourcemap: true,
    jsx: 'automatic',
    jsxImportSource: 'preact',
    define: { ...define, 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'css', '.ttf': 'dataurl', '.woff2': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' },
    logLevel: 'info',
  },
].filter((t) => fs.existsSync(t.entryPoints[0]) && (!only || t.name === only));

for (const t of targets) {
  const { name, ...opts } = t;
  fs.mkdirSync(path.dirname(opts.outfile), { recursive: true });
  if (watch) {
    const ctx = await context(opts);
    await ctx.watch();
    console.log(`watching ${name}`);
  } else {
    await build(opts);
  }
}

// static renderer assets
const rsrc = path.join(root, 'src/renderer');
const rdst = path.join(root, 'dist/renderer');
if (fs.existsSync(path.join(rsrc, 'index.html')) && (!only || only === 'renderer')) {
  fs.mkdirSync(rdst, { recursive: true });
  fs.copyFileSync(path.join(rsrc, 'index.html'), path.join(rdst, 'index.html'));
}
// The MCP launcher (Contents/MacOS/jaffloop-mcp) is a tiny universal binary compiled from build/mcp-launcher.c (macOS only).
if (process.platform === 'darwin' && (!only || only === 'launcher')) {
  const src = path.join(root, 'build/mcp-launcher.c');
  const out = path.join(root, 'build/bin/jaffloop-mcp');
  if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(src).mtimeMs) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFileSync('clang', ['-O2', '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=12.0', '-o', out, src], { stdio: 'inherit' });
    console.log('compiled build/bin/jaffloop-mcp');
  }
}
if (!watch) console.log('build complete');
