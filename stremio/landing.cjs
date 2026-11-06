'use strict';

const {
  ADDON_NAME,
  ADDON_VERSION,
  ACTIVE_SCRAPERS,
  ACTIVE_IDS,
} = require('./config.cjs');
const { resolveGatewayOptions } = require('./stream-gateway.cjs');
const { resolveMediaFlowOptions } = require('./mediaflow.cjs');

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="256" y2="256" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#141824"/>
      <stop offset="100%" stop-color="#090b10"/>
    </linearGradient>
    <linearGradient id="accent" x1="36" y1="36" x2="220" y2="220" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ff3b5c"/>
      <stop offset="55%" stop-color="#ff6b3d"/>
      <stop offset="100%" stop-color="#ffb020"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="56" fill="url(#bg)"/>
  <rect x="10" y="10" width="236" height="236" rx="46" stroke="url(#accent)" stroke-width="4" stroke-opacity="0.45"/>
  <path d="M88 74C88 66.4 96.3 61.7 102.9 65.6L186.2 114.6C192.7 118.4 192.7 127.8 186.2 131.6L102.9 180.6C96.3 184.5 88 179.8 88 172.2V74Z" fill="url(#accent)"/>
  <text x="128" y="220" text-anchor="middle" fill="#f3f5fa" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="22" font-weight="800" letter-spacing="2.5">SF2 · ES</text>
</svg>
`;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CATEGORY_LABELS = {
  general: 'Películas y series',
  movies: 'Solo películas',
  series: 'Series / Animación',
  anime: 'Anime',
  doramas: 'Doramas',
};

function renderConfigurePage(options = {}) {
  const env = options.env || process.env;
  const userConfig = options.userConfig || {};
  const baseUrl = String(options.baseUrl || '').replace(/\/+$/, '');
  const hasServerTmdbKey = Boolean(env.TMDB_API_KEY);

  // Nunca serializar secretos del servidor en el HTML público; solo reflejar lo que vino en /:config/configure
  const initialClientConfig = {
    providers: Array.isArray(userConfig.providers) ? userConfig.providers : ACTIVE_IDS,
    lang: userConfig.lang || 'all',
    tmdbKey: userConfig.tmdbKey || '',
    timeoutSec: Number(userConfig.timeoutSec) || 10,
    gateway: userConfig.gateway || 'auto',
  };

  // Estado de la pasarela en el servidor, para explicar en la UI por qué el
  // selector puede quedar inactivo (el servidor siempre manda).
  const gatewayServer = resolveGatewayOptions(env);
  const mediaflowServer = resolveMediaFlowOptions(env);

  const scrapersData = ACTIVE_SCRAPERS.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    types: item.supportedTypes,
    category: item.category,
    categoryLabel: CATEGORY_LABELS[item.category] || 'General',
  }));

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(ADDON_NAME)} · Configurar Addon Stremio</title>
  <link rel="icon" type="image/svg+xml" href="/logo.svg">
  <style>
    :root {
      --bg: #0b0e16;
      --panel: #131826;
      --panel-2: #1a2134;
      --border: rgba(255, 255, 255, 0.09);
      --text: #eef2ff;
      --muted: #9aa5c4;
      --accent: #ff4d5a;
      --accent-2: #ff8a3d;
      --ok: #2dd4bf;
      --radius: 14px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at 15% 0%, rgba(255, 77, 90, 0.14), transparent 42%),
                  radial-gradient(circle at 85% 10%, rgba(123, 97, 255, 0.14), transparent 42%),
                  var(--bg);
      color: var(--text);
      line-height: 1.5;
      min-height: 100vh;
    }
    .wrap {
      max-width: 1040px;
      margin: 0 auto;
      padding: 28px 18px 64px;
    }
    header {
      display: flex;
      align-items: center;
      gap: 18px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }
    header img {
      width: 64px;
      height: 64px;
      border-radius: 16px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
    }
    .title-group h1 {
      margin: 0;
      font-size: 1.55rem;
      letter-spacing: -0.02em;
    }
    .badges {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 6px;
    }
    .badge {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.07);
      color: var(--muted);
      border: 1px solid var(--border);
    }
    .badge.ok {
      color: var(--ok);
      border-color: rgba(45, 212, 191, 0.35);
      background: rgba(45, 212, 191, 0.1);
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      margin-bottom: 18px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.24);
    }
    .card h2 {
      margin: 0 0 6px;
      font-size: 1.08rem;
    }
    .card p.hint {
      margin: 0 0 14px;
      font-size: 0.88rem;
      color: var(--muted);
    }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 14px;
    }
    label.field { display: block; }
    label.field span.lbl {
      display: block;
      font-size: 0.84rem;
      font-weight: 600;
      margin-bottom: 6px;
      color: #dbe3ff;
    }
    input[type="text"], input[type="password"], input[type="number"], select {
      width: 100%;
      background: var(--panel-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 0.92rem;
      outline: none;
    }
    input:focus, select:focus { border-color: var(--accent); }
    .toolbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .btn-chip {
      background: var(--panel-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-chip:hover { border-color: var(--accent); }
    .providers-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(225px, 1fr));
      gap: 10px;
    }
    .prov-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 11px;
      padding: 10px 12px;
      cursor: pointer;
      user-select: none;
    }
    .prov-item.checked { border-color: rgba(255, 77, 90, 0.5); }
    .prov-item input { margin-top: 3px; accent-color: var(--accent); }
    .prov-meta { min-width: 0; flex: 1; }
    .prov-name {
      font-weight: 650;
      font-size: 0.88rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .prov-cat { font-size: 0.7rem; color: var(--muted); }
    .prov-types { font-size: 0.68rem; color: #ffb088; white-space: nowrap; }
    .install-bar {
      position: sticky;
      bottom: 14px;
      background: rgba(19, 24, 38, 0.94);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 77, 90, 0.4);
      border-radius: 16px;
      padding: 16px 18px;
      box-shadow: 0 18px 42px rgba(0, 0, 0, 0.55);
    }
    .manifest-preview {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.8rem;
      background: #090c14;
      color: #b9c5e8;
      padding: 9px 12px;
      border-radius: 9px;
      border: 1px solid var(--border);
      word-break: break-all;
      margin-bottom: 12px;
    }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 11px 18px;
      border-radius: 11px;
      font-weight: 700;
      font-size: 0.92rem;
      text-decoration: none;
      border: none;
      cursor: pointer;
    }
    .btn-primary {
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      color: #fff;
    }
    .btn-secondary {
      background: var(--panel-2);
      color: var(--text);
      border: 1px solid var(--border);
    }
    .footer-note {
      margin-top: 18px;
      font-size: 0.8rem;
      color: var(--muted);
      text-align: center;
    }
    .footer-note a { color: #ff8a6b; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <img src="/logo.svg" alt="STREAMFLIX2">
      <div class="title-group">
        <h1>${escapeHtml(ADDON_NAME)}</h1>
        <div class="badges">
          <span class="badge">v${escapeHtml(ADDON_VERSION)}</span>
          <span class="badge ok">Beamup Ready</span>
          <span class="badge">24 proveedores activos</span>
          <span class="badge">IMDb (tt…) + TMDB</span>
          ${hasServerTmdbKey ? '<span class="badge ok">TMDB configurada en servidor</span>' : '<span class="badge">Fallback Cinemeta activo</span>'}
        </div>
      </div>
    </header>

    <section class="card">
      <h2>1. Idioma, Metadatos TMDB y Tiempos</h2>
      <p class="hint">
        Los IDs de IMDb (<code>tt…</code>) funcionan sin clave usando Cinemeta automáticamente, y las cabeceras de stream se entregan con <code>behaviorHints.proxyHeaders</code>. Añadir una clave TMDB v3 mejora la coincidencia con títulos localizados en español (<code>es-MX</code>) y habilita IDs <code>tmdb:…</code>.
      </p>
      <div class="grid-2">
        <label class="field">
          <span class="lbl">Preferencia / filtro de idioma</span>
          <select id="lang">
            <option value="all">Todos · Priorizar Español Latino</option>
            <option value="prefer-es-ES">Todos · Priorizar Castellano (España)</option>
            <option value="prefer-es-SUB">Todos · Priorizar Subtitulado (VOSE)</option>
            <option value="only-es-LAT">Solo Español Latino (es-LAT)</option>
            <option value="only-es-ES">Solo Castellano (es-ES)</option>
            <option value="only-es-SUB">Solo Subtitulado (es-SUB)</option>
          </select>
        </label>
        <label class="field">
          <span class="lbl">Timeout máximo por proveedor (segundos)</span>
          <input type="number" id="timeoutSec" min="4" max="25" step="1" value="10">
        </label>
        <label class="field" style="grid-column: 1 / -1;">
          <span class="lbl">Transporte de vídeo (proxy)</span>
          <select id="gateway">
            <option value="auto">Automático · usar lo que el servidor tenga configurado</option>
            <option value="off">Siempre directo / cabeceras locales · nunca gastar datos del anfitrión</option>
            <option value="on">Preferir proxy del addon si el servidor lo tiene activo</option>
          </select>
          <span class="hint" style="margin-top:6px">
            Estado del servidor: <strong>${mediaflowServer.enabled ? 'MediaFlow delegado' : gatewayServer.mode}</strong>${mediaflowServer.enabled ? ` · ${mediaflowServer.baseUrl}` : (gatewayServer.enabled ? ` · presupuesto ${Math.round(gatewayServer.dailyBudgetBytes / (1024 * 1024))} MB/día` : ' · retransmisión desactivada (coste 0)')}.
            Por defecto los enlaces con <code>Referer</code> se reproducen con <code>proxyHeaders</code>, sin usar ancho de banda del addon.
          </span>
        </label>
        <label class="field" style="grid-column: 1 / -1;">
          <span class="lbl">Clave API de TMDB v3 (opcional)</span>
          <input type="password" id="tmdbKey" autocomplete="off" placeholder="${hasServerTmdbKey ? '✓ TMDB_API_KEY activa en el servidor (deja vacío para usarla)' : 'Opcional · p. ej. a1b2c3d4e5f6...'}">
        </label>
      </div>
    </section>

    <section class="card">
      <h2>2. Proveedores activos (<span id="selectedCount">24</span> / ${ACTIVE_SCRAPERS.length})</h2>
      <p class="hint">Selecciona qué conectores consultar en cada búsqueda.</p>
      <div class="toolbar">
        <button type="button" class="btn-chip" data-filter="all">Todos (${ACTIVE_SCRAPERS.length})</button>
        <button type="button" class="btn-chip" data-filter="general">Películas y series</button>
        <button type="button" class="btn-chip" data-filter="anime">Solo Anime</button>
        <button type="button" class="btn-chip" data-filter="series">Series / Animación</button>
        <button type="button" class="btn-chip" data-filter="movies">Solo Películas</button>
        <button type="button" class="btn-chip" data-filter="doramas">Doramas</button>
        <button type="button" class="btn-chip" data-filter="none">Desmarcar todos</button>
      </div>
      <div class="providers-grid" id="providersGrid"></div>
    </section>

    <div class="install-bar">
      <div class="manifest-preview" id="manifestUrlPreview"></div>
      <div class="actions">
        <a class="btn btn-primary" id="installDesktopBtn" href="#">Instalar en Stremio</a>
        <a class="btn btn-secondary" id="installWebBtn" href="#" target="_blank" rel="noopener">Abrir en Stremio Web</a>
        <button type="button" class="btn btn-secondary" id="copyBtn">Copiar URL</button>
      </div>
    </div>

    <div class="footer-note">
      STREAMFLIX2 · Apache-2.0 · También disponible como repositorio de plugins Nuvio en
      <a href="/nuvio/manifest.json">/nuvio/manifest.json</a>
    </div>
  </div>

  <script>
    (function () {
      const SCRAPERS = ${JSON.stringify(scrapersData)};
      const ALL_IDS = SCRAPERS.map((s) => s.id);
      const INITIAL = ${JSON.stringify(initialClientConfig)};
      const SERVER_BASE = ${JSON.stringify(baseUrl)};

      const grid = document.getElementById('providersGrid');
      const countEl = document.getElementById('selectedCount');
      const previewEl = document.getElementById('manifestUrlPreview');
      const installDesktopBtn = document.getElementById('installDesktopBtn');
      const installWebBtn = document.getElementById('installWebBtn');
      const copyBtn = document.getElementById('copyBtn');
      const langEl = document.getElementById('lang');
      const timeoutEl = document.getElementById('timeoutSec');
      const tmdbEl = document.getElementById('tmdbKey');
      const gatewayEl = document.getElementById('gateway');

      const selected = new Set(INITIAL.providers && INITIAL.providers.length ? INITIAL.providers : ALL_IDS);

      function toBase64Url(str) {
        const bytes = new TextEncoder().encode(str);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
        return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
      }

      function renderProviders() {
        grid.innerHTML = '';
        SCRAPERS.forEach((s) => {
          const label = document.createElement('label');
          const isChecked = selected.has(s.id);
          label.className = 'prov-item' + (isChecked ? ' checked' : '');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = isChecked;
          cb.addEventListener('change', () => {
            if (cb.checked) selected.add(s.id);
            else selected.delete(s.id);
            label.classList.toggle('checked', cb.checked);
            updateUrls();
          });
          const meta = document.createElement('div');
          meta.className = 'prov-meta';
          const typesLabel = s.types.map((t) => (t === 'movie' ? 'PELI' : 'SERIE')).join('·');
          meta.innerHTML =
            '<div class="prov-name"><span>' + s.name + '</span><span class="prov-types">' + typesLabel + '</span></div>' +
            '<div class="prov-cat">' + s.categoryLabel + '</div>';
          label.appendChild(cb);
          label.appendChild(meta);
          grid.appendChild(label);
        });
      }

      function buildEncodedSegment() {
        const payload = {};
        const list = ALL_IDS.filter((id) => selected.has(id));
        if (list.length !== ALL_IDS.length) payload.p = list;
        if (langEl.value !== 'all') payload.l = langEl.value;
        const cleanTmdb = tmdbEl.value.trim();
        if (cleanTmdb) payload.t = cleanTmdb;
        const tSec = Math.max(4, Math.min(25, Math.round(Number(timeoutEl.value) || 10)));
        if (tSec !== 10) payload.s = tSec;
        if (gatewayEl && gatewayEl.value !== 'auto') payload.g = gatewayEl.value;

        if (Object.keys(payload).length === 0) return '';
        return 'cfg_' + toBase64Url(JSON.stringify(payload));
      }

      function updateUrls() {
        countEl.textContent = String(selected.size);
        const originBase = (window.location && window.location.origin && window.location.origin !== 'null')
          ? window.location.origin
          : SERVER_BASE;
        const seg = buildEncodedSegment();
        const manifestUrl = originBase + (seg ? '/' + seg : '') + '/manifest.json';
        const stremioUrl = manifestUrl.replace(/^https?:\\/\\//i, 'stremio://');
        previewEl.textContent = manifestUrl;
        installDesktopBtn.href = stremioUrl;
        installWebBtn.href = 'https://web.stremio.com/#/addons?addon=' + encodeURIComponent(manifestUrl);
      }

      langEl.value = INITIAL.lang || 'all';
      timeoutEl.value = String(INITIAL.timeoutSec || 10);
      tmdbEl.value = INITIAL.tmdbKey || '';
      if (gatewayEl) gatewayEl.value = INITIAL.gateway || 'auto';

      [langEl, timeoutEl, tmdbEl, gatewayEl].filter(Boolean).forEach((el) => {
        el.addEventListener('input', updateUrls);
        el.addEventListener('change', updateUrls);
      });

      document.querySelectorAll('.btn-chip').forEach((btn) => {
        btn.addEventListener('click', () => {
          const filter = btn.dataset.filter;
          selected.clear();
          if (filter === 'all') {
            ALL_IDS.forEach((id) => selected.add(id));
          } else if (filter !== 'none') {
            SCRAPERS.filter((s) => s.category === filter).forEach((s) => selected.add(s.id));
          }
          renderProviders();
          updateUrls();
        });
      });

      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(previewEl.textContent);
          const prev = copyBtn.textContent;
          copyBtn.textContent = '✓ Copiado';
          setTimeout(() => { copyBtn.textContent = prev; }, 1600);
        } catch (_) {
          window.prompt('Copia la URL del manifiesto:', previewEl.textContent);
        }
      });

      renderProviders();
      updateUrls();
    })();
  </script>
</body>
</html>`;
}

module.exports = {
  LOGO_SVG,
  renderConfigurePage,
};
