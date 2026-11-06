#!/usr/bin/env node
'use strict';

/**
 * Auditoría de reproducción desde GitHub Actions, no prueba del catálogo.
 * Uso: node scripts/media-audit.cjs --all --output media-audit.json
 *      node scripts/media-audit.cjs --provider poseidonhd2 --output resultado.json
 *
 * Por seguridad los informes NO incluyen URLs firmadas, cabeceras ni tokens.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { checkMedia, classifyProvider, hostOf } = require('./media-audit-lib.cjs');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const ATTEMPTS = 3;
const MAX_MEDIA = 6;
const CONCURRENCY = 4;
const ATTEMPT_TIMEOUT_MS = 65000;

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? '' : process.argv[index + 1] || '';
}

// Metadatos de títulos conocidos; permiten probar los proveedores sin guardar
// una clave TMDB en el artefacto. El ID numérico se usa en los adaptadores
// directos, y el resto realiza una búsqueda real por título.
const MOVIE = {
  id: '550', mediaType: 'movie', title: 'Fight Club', originalTitle: 'El club de la lucha',
  titles: ['Fight Club', 'El club de la lucha'], imdbId: 'tt0137523', year: '1999',
};
const ANIME = {
  id: '37854', mediaType: 'tv', title: 'One Piece', originalTitle: 'One Piece',
  titles: ['One Piece'], imdbId: 'tt0388629', year: '1999',
};
const SERIES = {
  id: '1396', mediaType: 'tv', title: 'Breaking Bad', originalTitle: 'Breaking Bad',
  titles: ['Breaking Bad'], imdbId: 'tt0903747', year: '2008',
};
const CARTOON = {
  id: '456', mediaType: 'tv', title: 'The Simpsons', originalTitle: 'Los Simpson',
  titles: ['The Simpsons', 'Los Simpson'], imdbId: 'tt0096697', year: '1989',
};
const DORAMA = {
  id: 'tt10850932', mediaType: 'tv', title: 'Crash Landing on You',
  originalTitle: 'Crash Landing on You', titles: ['Crash Landing on You', 'Aterrizaje de emergencia en tu corazón'],
  imdbId: 'tt10850932', year: '2019',
};
const WEAPONS = {
  id: 'weapons', mediaType: 'movie', title: 'Weapons', originalTitle: 'La hora de la desaparición',
  titles: ['Weapons', 'La hora de la desaparición'], imdbId: '', year: '2025',
};
const TURKISH = {
  id: 'kara-sevda', mediaType: 'tv', title: 'Kara Sevda', originalTitle: 'Amor eterno',
  titles: ['Kara Sevda', 'Amor eterno'], imdbId: '', year: '2015',
};

function sampleFor(scraper) {
  const id = scraper.id;
  if (['animeav1', 'animeonlineninja', 'jkanime', 'latanime', 'tioanime'].includes(id)) return ANIME;
  if (['danimados', 'lacartoons'].includes(id)) return CARTOON;
  if (id === 'doramasflix') return DORAMA;
  if (id === 'seriesturcas') return TURKISH;
  if (['seriesflix'].includes(id)) return SERIES;
  if (['hdfull', 'pelisgo'].includes(id)) return WEAPONS;
  if (!scraper.supportedTypes.includes('movie')) return SERIES;
  return MOVIE;
}

function writeJson(filename, object) {
  fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(object, null, 2)}\n`);
}

async function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function auditOne(scraper) {
  const sample = sampleFor(scraper);
  const plugin = require(path.join(ROOT, scraper.filename));
  const rawFetch = globalThis.fetch;
  let phase = 'descubrimiento';
  let controller;
  let discovery403;
  globalThis.__STREAMFLIX_METADATA_HOOK = async () => ({ ...sample });
  globalThis.fetch = async (input, init = {}) => {
    const signals = [AbortSignal.timeout(10000)];
    if (controller) signals.push(controller.signal);
    if (init.signal) signals.push(init.signal);
    const url = typeof input === 'string' ? input : input?.url || String(input);
    const response = await rawFetch(input, { ...init, signal: AbortSignal.any(signals) });
    if (phase === 'descubrimiento' && response.status === 403 && discovery403.length < 12) {
      discovery403.push(hostOf(response.url || url));
    }
    return response;
  };
  const originalWarn = console.warn;
  let warnings = 0;
  // providerGuard escribe la URL original en sus avisos. No publicarla en CI.
  console.warn = () => { warnings += 1; };
  const attempts = [];
  try {
    for (let i = 1; i <= ATTEMPTS; i += 1) {
      if (i > 1) await wait(1200);
      controller = new AbortController();
      discovery403 = [];
      warnings = 0;
      phase = 'descubrimiento';
      const deadline = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
      const started = Date.now();
      try {
        let streams = [];
        try {
          streams = await plugin.getStreams(sample.id, sample.mediaType, 1, 1);
        } catch (_) { /* un error de catálogo NO es un resultado de media */ }
        const candidates = streams.filter((stream) => ['hls', 'mp4'].includes(String(stream.type).toLowerCase()));
        const attempt = {
          number: i,
          discovered: streams.length,
          mediaCount: candidates.length,
          otherFormats: streams.length - candidates.length,
          discovery403: [...new Set(discovery403)],
          warnings,
          media: [],
        };
        phase = 'medio';
        for (const stream of candidates.slice(0, MAX_MEDIA)) {
          if (controller.signal.aborted) break;
          try {
            attempt.media.push(await checkMedia(stream, { signal: controller.signal }));
          } catch (_) {
            attempt.media.push({ format: String(stream.type), outcome: 'otro', stage: 'error', host: hostOf(stream.url), status: null });
          }
        }
        attempt.elapsedMs = Date.now() - started;
        attempt.timedOut = controller.signal.aborted;
        attempts.push(attempt);
      } finally {
        clearTimeout(deadline);
        controller = null;
      }
    }
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = rawFetch;
    delete globalThis.__STREAMFLIX_METADATA_HOOK;
  }
  return {
    provider: scraper.id,
    sample: { title: sample.title, mediaType: sample.mediaType, season: sample.mediaType === 'tv' ? 1 : null, episode: sample.mediaType === 'tv' ? 1 : null },
    attempts,
    decision: classifyProvider(attempts, ATTEMPTS),
  };
}

function runChild(id, output) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [__filename, '--provider', id, '--output', output], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    });
    // No repetir avisos del proveedor ni URLs firmadas en el log del workflow.
    child.stdout.resume();
    child.stderr.resume();
    const deadline = setTimeout(() => child.kill('SIGKILL'), ATTEMPTS * (ATTEMPT_TIMEOUT_MS + 5000) + 20000);
    child.on('error', () => { /* se registra como no concluyente */ });
    child.on('close', () => {
      clearTimeout(deadline);
      try { resolve(JSON.parse(fs.readFileSync(output, 'utf8'))); }
      catch (_) { resolve({ provider: id, attempts: [], decision: 'no-concluyente', error: 'worker-no-finalizo' }); }
    });
  });
}

function annotateResults(results, proposedRemoval) {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  // Las anotaciones se pueden consultar con la API de GitHub incluso cuando
  // el almacenamiento externo de artefactos/logs no está disponible.
  for (const item of results) {
    const evidence = {
      provider: item.provider,
      decision: item.decision,
      ...(item.error ? { error: item.error } : {}),
      attempts: item.attempts.map((attempt) => ({
        discovered: attempt.discovered,
        mediaCount: attempt.mediaCount,
        otherFormats: attempt.otherFormats,
        discovery403: attempt.discovery403,
        timedOut: attempt.timedOut,
        media: attempt.media.map((media) => ({ format: media.format, stage: media.stage, status: media.status, host: media.host, outcome: media.outcome })),
      })),
    };
    console.log(`::notice file=scripts/media-audit.cjs,title=media-${item.provider}::${JSON.stringify(evidence)}`);
  }
  console.log(`::notice file=scripts/media-audit.cjs,title=media-resumen::${JSON.stringify({ audited: results.length, attempts: ATTEMPTS, proposedRemoval })}`);
}

function appendSummary(results, output) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const lines = [
    '## Auditoría de medios HLS/MP4 · 3 intentos por proveedor',
    '',
    'Se prueban URLs recién resueltas, variantes y segmentos HLS o el inicio del MP4. Un 403 de catálogo, un título ausente o un timeout **NO** justifican retirar un proveedor. Un 403 persistente se atribuye solamente a la red de GitHub Actions.',
    '',
    '| Proveedor | Intentos con medio | 403 en medios | Otros/OK | Decisión |',
    '| - | -: | -: | -: | - |',
  ];
  for (const item of results) {
    const media = item.attempts.flatMap((entry) => entry.media || []);
    lines.push(`| ${item.provider} | ${item.attempts.filter((entry) => entry.mediaCount).length}/${ATTEMPTS} | ${media.filter((entry) => entry.outcome === 'http403').length} | ${media.filter((entry) => entry.outcome !== 'http403').length} | ${item.decision} |`);
  }
  lines.push('', `Informe detallado sin URLs firmadas: \`${path.basename(output)}\`.`, '');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

async function auditAll(output) {
  const active = manifest.scrapers.filter((entry) => entry.enabled);
  const results = new Array(active.length);
  let next = 0;
  const temp = path.join(ROOT, '.tmp', 'media-audit');
  fs.mkdirSync(temp, { recursive: true });
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < active.length) {
      const index = next++;
      const id = active[index].id;
      results[index] = await runChild(id, path.join(temp, `${id}.json`));
      const found = results[index].attempts.map((attempt) => attempt.mediaCount || 0).join('/');
      console.log(`${id}: ${results[index].decision} (medios por intento: ${found || 'sin informe'})`);
    }
  }));
  const report = {
    createdAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA || '',
    attemptsPerProvider: ATTEMPTS,
    note: 'Solo un 403 persistente en TODOS los medios HLS/MP4 encontrados en los tres intentos propone retirada; las IP de Actions pueden diferir de las del usuario.',
    providers: results,
    proposedRemoval: results.filter((item) => item.decision === 'retirar-403').map((item) => item.provider),
  };
  writeJson(output, report);
  appendSummary(results, output);
  annotateResults(results, report.proposedRemoval);
  console.log(`Informe: ${output}; propuestos para retirada: ${report.proposedRemoval.join(', ') || 'ninguno'}`);
}

(async () => {
  const output = arg('output') || path.join(ROOT, '.tmp', 'media-audit.json');
  if (process.argv.includes('--all')) {
    await auditAll(output);
    return;
  }
  const id = arg('provider');
  const scraper = manifest.scrapers.find((entry) => entry.enabled && entry.id === id);
  if (!scraper) throw new Error('Usa --all o --provider con un ID activo del manifiesto');
  const result = await auditOne(scraper);
  writeJson(output, result);
  console.log(`${id}: ${result.decision} (medios por intento: ${result.attempts.map((item) => item.mediaCount).join('/')})`);
})().catch((error) => {
  console.error(`Auditoría no completada: ${error.name || 'error'}`);
  process.exitCode = 1;
});
