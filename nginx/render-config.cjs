'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TEMPLATE_PATH = path.join(__dirname, 'streamflix2.conf.template');
const ALLOWED_VARS = [
  'NGINX_PORT',
  'SERVER_NAME',
  'BEAMUP_SCHEME',
  'BEAMUP_HOST',
  'NGINX_PROXY_TOKEN',
  'DNS_RESOLVER',
];

function renderNginxConfig(overrides = {}) {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const values = {
    NGINX_PORT: String(overrides.NGINX_PORT ?? process.env.NGINX_PORT ?? '8080').trim(),
    SERVER_NAME: String(overrides.SERVER_NAME ?? process.env.SERVER_NAME ?? '_').trim(),
    BEAMUP_SCHEME: String(overrides.BEAMUP_SCHEME ?? process.env.BEAMUP_SCHEME ?? 'https').trim(),
    BEAMUP_HOST: String(overrides.BEAMUP_HOST ?? process.env.BEAMUP_HOST ?? '7e2a912be9c9-streamflix2.baby-beamup.club').trim(),
    NGINX_PROXY_TOKEN: String(overrides.NGINX_PROXY_TOKEN ?? process.env.NGINX_PROXY_TOKEN ?? '').trim(),
    DNS_RESOLVER: String(overrides.DNS_RESOLVER ?? process.env.DNS_RESOLVER ?? '1.1.1.1 8.8.8.8').trim(),
  };

  if (!/^\d+$/.test(values.NGINX_PORT)) {
    throw new Error(`NGINX_PORT inválido: ${values.NGINX_PORT}`);
  }
  if (!/^https?$/.test(values.BEAMUP_SCHEME)) {
    throw new Error(`BEAMUP_SCHEME inválido: ${values.BEAMUP_SCHEME}`);
  }
  if (!/^[A-Za-z0-9.-]+(?::\d+)?$/.test(values.BEAMUP_HOST)) {
    throw new Error(`BEAMUP_HOST inválido: ${values.BEAMUP_HOST}`);
  }
  if (values.NGINX_PROXY_TOKEN && !/^[A-Za-z0-9._~-]+$/.test(values.NGINX_PROXY_TOKEN)) {
    throw new Error('NGINX_PROXY_TOKEN solo admite caracteres [A-Za-z0-9._~-]');
  }

  let rendered = template;
  for (const key of ALLOWED_VARS) {
    rendered = rendered.split(`\${${key}}`).join(values[key]);
  }
  return rendered;
}

function validateRenderedNginxConfig(confText) {
  const unresolved = confText.match(/\$\{[A-Z0-9_]+\}/g);
  if (unresolved) {
    throw new Error(`Quedaron variables sin sustituir: ${unresolved.join(', ')}`);
  }

  // Verificar balance de llaves fuera de comillas y comentarios
  let depth = 0;
  const lines = confText.split('\n');
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const line = lines[lineIdx];
    let quote = '';
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (!quote && ch === '#') break;
      if (quote) {
        if (ch === '\\') { i += 1; continue; }
        if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth < 0) throw new Error(`Llave de cierre inesperada en línea ${lineIdx + 1}`);
      }
    }
  }
  if (depth !== 0) {
    throw new Error(`Llaves desbalanceadas en configuración Nginx (saldo: ${depth})`);
  }

  const requiredSnippets = [
    'proxy_ssl_server_name on;',
    'resolver ',
    'sub_filter ',
    'proxy_redirect ',
    '$hlsp_raw_tail',
    '$hlsp_ssrf_blocked',
    '$hlsp_auth_denied',
    'X-Forwarded-Host $http_host;',
  ];
  for (const snippet of requiredSnippets) {
    if (!confText.includes(snippet)) {
      throw new Error(`Falta directiva esperada en configuración Nginx: ${snippet}`);
    }
  }

  return true;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const outIdx = args.indexOf('--output');
  const outputPath = outIdx >= 0 ? args[outIdx + 1] : '';

  const rendered = renderNginxConfig();
  validateRenderedNginxConfig(rendered);

  if (checkOnly) {
    console.log('✓ Plantilla Nginx validada correctamente');
  } else if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(outputPath, rendered, 'utf8');
    console.log(`✓ Configuración Nginx generada en ${outputPath}`);
  } else {
    process.stdout.write(rendered);
  }
}

module.exports = {
  renderNginxConfig,
  validateRenderedNginxConfig,
};
