import { build } from 'esbuild';
import { parse } from 'acorn';
import { readdir, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourceRoot = path.join(root, 'src', 'providers');
const outputRoot = path.join(root, 'providers');
const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const minify = process.argv.includes('--minify');

const entries = (await readdir(sourceRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => requested.length === 0 || requested.includes(name))
  .sort();

if (!entries.length) throw new Error('No hay proveedores para compilar.');
await mkdir(outputRoot, { recursive: true });

for (const id of entries) {
  const outfile = path.join(outputRoot, `${id}.js`);
  await build({
    entryPoints: [path.join(sourceRoot, id, 'index.js')],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    target: 'es2020',
    minify,
    sourcemap: false,
    legalComments: 'none',

    external: ['crypto-js'],
    logLevel: 'warning',
  });
  const output = await readFile(outfile, 'utf8');
  const comments = [];
  parse(output, { ecmaVersion: 'latest', sourceType: 'script', onComment: comments });
  let clean = output;
  for (const { start, end } of comments.reverse()) {
    clean = clean.slice(0, start) + output.slice(start, end).replace(/[^\r\n]/g, ' ') + clean.slice(end);
  }
  await writeFile(outfile, clean.replace(/^[ \t]+$/gm, ''));
  console.log(`✓ ${id}`);
}


const manifestSource = JSON.parse(await readFile(path.join(root, 'src', 'manifest.json'), 'utf8'));
const available = new Set((await readdir(sourceRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name));
manifestSource.scrapers = manifestSource.scrapers.filter((scraper) => available.has(scraper.id));
await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifestSource, null, 2)}\n`);
console.log(`✓ manifest.json (${manifestSource.scrapers.length} proveedores)`);
