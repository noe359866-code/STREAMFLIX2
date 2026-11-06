#!/usr/bin/env node
'use strict';

/**
 * Verificador de transporte de vídeo del addon desplegado.
 *
 * Responde, contra un addon real (por defecto el de Beamup), a las preguntas que
 * no se pueden contestar leyendo el código:
 *
 *   1. ¿La pasarela está activa y con presupuesto?           → /health
 *   2. ¿Qué vía usa cada enlace (directo / proxyHeaders / pasarela)? → /diagnostico
 *   3. ¿El ticket firmado se acepta y el playlist se reescribe? → /g/playlist.m3u8
 *   4. ¿El ticket caduca y se rechaza lo manipulado?          → /g/*
 *
 * Uso:
 *   node scripts/verify-proxy.cjs https://7e2a912be9c9-streamflix2.baby-beamup.club
 *   node scripts/verify-proxy.cjs <base> --id tt1375666 --type movie
 *
 * Salida en texto legible; código de salida 1 si algo está roto (no si la
 * pasarela simplemente está apagada: eso es el modo recomendado).
 */

const http = require('node:http');
const https = require('node:https');

function parseArgs(argv) {
  const args = { base: '', id: 'tt1375666', type: 'movie', config: '', timeout: 25000 };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--id') args.id = argv[++i];
    else if (arg === '--type') args.type = argv[++i];
    else if (arg === '--config') args.config = argv[++i];
    else if (arg === '--timeout') args.timeout = Number(argv[++i]) || 25000;
    else if (!arg.startsWith('-')) rest.push(arg);
  }
  args.base = (rest[0] || process.env.ADDON_BASE_URL || '').replace(/\/+$/, '');
  return args;
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https:') ? https : http;
    const req = transport.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 20000,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function getJson(url, options) {
  const res = await request(url, options);
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch (_) {
    json = null;
  }
  return { ...res, json };
}

const ok = (text) => `✅ ${text}`;
const warn = (text) => `⚠️  ${text}`;
const bad = (text) => `❌ ${text}`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.base) {
    console.error('Falta la URL base. Ejemplo:\n  node scripts/verify-proxy.cjs https://7e2a912be9c9-streamflix2.baby-beamup.club');
    process.exit(2);
  }

  const problems = [];
  console.log(`\nVerificando ${args.base}\n${'─'.repeat(64)}`);

  // 1. Salud
  const health = await getJson(`${args.base}/health`, { timeout: args.timeout });
  if (!health.json || health.status !== 200) {
    console.log(bad(`/health no responde (HTTP ${health.status})`));
    process.exit(1);
  }
  const gateway = health.json.gateway || {};
  console.log(ok(`Addon v${health.json.version} · ${health.json.activeProviders} proveedores activos`));

  const proxy = health.json.proxy || {};
  console.log(proxy.healthy > 0
    ? ok(`Pool de raspado: ${proxy.healthy} proxies sanos`)
    : warn(`Pool de raspado vacío (${proxy.lastError || 'sin detalle'}) — el raspado directo sigue funcionando`));

  if (gateway.enabled) {
    console.log(ok(`Pasarela: ${gateway.mode} · ${gateway.bytesToday}/${gateway.budgetBytes} bytes (${gateway.budgetUsedPct}%) · max ${gateway.maxConcurrent} conexiones`));
    if (gateway.secret !== 'configured') {
      console.log(bad('  STREAM_GATEWAY_SECRET no está configurado: los tickets morirán en cada reinicio'));
      problems.push('falta STREAM_GATEWAY_SECRET');
    }
    if (gateway.budgetUsedPct >= 90) console.log(warn('  Presupuesto casi agotado: hoy se cortará pronto'));
  } else {
    console.log(ok('Pasarela apagada (modo recomendado): el vídeo no toca el anfitrión'));
  }
  if (gateway.lastError) console.log(warn(`Último error de pasarela: ${gateway.lastError}`));

  // MediaFlow (si el operador lo configuró)
  const mediaflow = health.json.mediaflow || {};
  if (mediaflow.configured) {
    const probe = await getJson(`${args.base}/mediaflow?probe=1`, { timeout: args.timeout });
    const result = (probe.json && probe.json.probe) || mediaflow.lastProbe || {};
    if (result.ok) {
      console.log(ok(`MediaFlow: ${mediaflow.baseUrl} · IP pública ${result.ip || '?'} · ${result.ms} ms`));
    } else {
      console.log(bad(`MediaFlow configurado (${mediaflow.baseUrl}) pero no responde: ${result.error || 'sin detalle'}`));
      problems.push('MediaFlow no responde');
    }
    if (mediaflow.password !== 'configured') {
      console.log(bad('  MEDIAFLOW_PASSWORD no está configurado'));
      problems.push('falta MEDIAFLOW_PASSWORD');
    }
  } else {
    console.log(ok('MediaFlow no configurado (la pasarela interna/proxyHeaders cubren el caso)'));
  }

  // 2. Diagnóstico de un título: qué vía usa cada enlace
  const seg = args.config ? `${args.config.replace(/^\/+|\/+$/g, '')}/` : '';
  const diagUrl = `${args.base}/${seg}diagnostico/stream/${args.type}/${encodeURIComponent(args.id)}.json`;
  const diag = await getJson(diagUrl, { timeout: Math.max(args.timeout, 45000) });
  if (!diag.json || diag.json.ok === false) {
    console.log(warn(`Diagnóstico no disponible: ${(diag.json && diag.json.error) || `HTTP ${diag.status}`}`));
    problems.push('diagnóstico sin datos (¿la sonda live está bloqueada desde tu red?)');
  } else {
    const transports = diag.json.transports || {};
    console.log(ok(`Diagnóstico ${args.id}: ${diag.json.streams} streams en ${diag.json.elapsedMs} ms (plazo ${diag.json.deadlineMs} ms)`));
    console.log(`   transportes: ${Object.keys(transports).length ? Object.entries(transports).map(([k, v]) => `${k}=${v}`).join(' · ') : 'ninguno'}`);
    if (diag.json.streamGateway) {
      console.log(`   pasarela: modo=${diag.json.streamGateway.mode} servidor=${diag.json.streamGateway.serverMode} preferencia=${diag.json.streamGateway.userPreference} base=${diag.json.streamGateway.baseUrl || '(sin URL pública)'}`);
    }
    const nowDirect = diag.json.providersWithResults || 0;
    console.log(`   proveedores con enlaces: ${nowDirect}/${diag.json.providersQueried}`);
    if (diag.json.providersRescuedByProxy) console.log(ok(`   rescatados por proxy de raspado: ${diag.json.providersRescuedByProxy}`));
    if (!transports.gateway && !transports.mediaflow && (gateway.enabled || mediaflow.configured)) {
      console.log(warn('   ningún enlace pasó por proxy: o no hay HLS con cabeceras, o falta PUBLIC_BASE_URL/MEDIAFLOW_URL'));
    }
    if (transports.mediaflow) console.log(ok(`   enlaces delegados a MediaFlow: ${transports.mediaflow}`));
  }

  // 3. Un ticket tiene que servir un playlist real y reescrito
  if (gateway.enabled) {
    const sample = await getJson(`${args.base}/diagnostico/stream/${args.type}/${encodeURIComponent(args.id)}.json`, { timeout: Math.max(args.timeout, 45000) });
    const gatewayStreamUrl = await findGatewayStream(args, seg);
    if (gatewayStreamUrl) {
      const res = await request(gatewayStreamUrl, { timeout: args.timeout });
      const looksPlaylist = /mpegurl/i.test(String(res.headers['content-type'] || ''));
      if (res.status === 200 && looksPlaylist) {
        const rewritten = /\/g\/(?:playlist\.m3u8|segment)\?t=/.test(res.body);
        console.log(rewritten
          ? ok('Ticket válido: el playlist se sirve y sus URIs se reescriben a la pasarela')
          : warn('El playlist se sirve pero sin URIs reescritas (¿es un MP4 o un playlist sin segmentos?)'));
      } else {
        console.log(bad(`El ticket no devolvió un playlist (HTTP ${res.status}, ${res.headers['content-type'] || 'sin tipo'})`));
        problems.push('la pasarela no sirve playlists');
      }
    } else {
      console.log(warn('No se encontró ningún enlace de pasarela para probar (proveedores sin resultados en este título)'));
    }
    void sample;

    const bogus = await request(`${args.base}/g/segment?t=firma-invalida`, { timeout: args.timeout });
    if (bogus.status === 403 || bogus.status === 404) {
      console.log(ok(`Ticket inválido rechazado (HTTP ${bogus.status})`));
    } else {
      console.log(bad(`Un ticket inválido NO fue rechazado (HTTP ${bogus.status})`));
      problems.push('la pasarela acepta tickets no firmados');
    }
  }

  console.log(`${'─'.repeat(64)}`);
  if (problems.length) {
    console.log(bad(`Revisar: ${problems.join('; ')}`));
    process.exit(1);
  }
  console.log(ok('Sin problemas detectados.'));
}

/** Busca en el listado de streams una URL que empiece por /g/. */
async function findGatewayStream(args, seg) {
  const url = `${args.base}/${seg}stream/${args.type}/${encodeURIComponent(args.id)}.json`;
  try {
    const res = await request(url, { timeout: Math.max(args.timeout, 30000) });
    const json = JSON.parse(res.body);
    const stream = (json.streams || []).find((item) => /\/g\/(?:playlist\.m3u8|segment)\?t=/.test(String(item.url || '')));
    return stream ? stream.url : '';
  } catch (_) {
    return '';
  }
}

main().catch((error) => {
  console.error(bad(`Error: ${error.message}`));
  process.exit(1);
});
