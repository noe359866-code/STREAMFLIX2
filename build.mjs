import { build } from 'esbuild';
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
    legalComments: 'inline',
    // Nuvio QuickJS ofrece require('crypto-js'); no se debe convertir en una dependencia de Node.
    external: ['crypto-js'],
    banner: { js: `/* ${id} · STREAMFLIX2 · Apache-2.0 · Generado con npm run build */` },
    logLevel: 'warning',
  });
  console.log(`✓ ${id}`);
}

// El manifiesto se genera desde una única fuente para evitar IDs/rutas obsoletos.
const manifestSource = JSON.parse(await readFile(path.join(root, 'src', 'manifest.json'), 'utf8'));
const available = new Set((await readdir(sourceRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name));
manifestSource.scrapers = manifestSource.scrapers.filter((scraper) => available.has(scraper.id));
await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifestSource, null, 2)}\n`);
console.log(`✓ manifest.json (${manifestSource.scrapers.length} proveedores)`);
