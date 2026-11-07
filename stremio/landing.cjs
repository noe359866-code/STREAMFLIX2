'use strict';

const {
  ADDON_NAME,
  ADDON_VERSION,
  ACTIVE_SCRAPERS,
  ACTIVE_IDS,
} = require('./config.cjs');

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

function jsonForScript(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
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


  const initialClientConfig = {
    providers: Array.isArray(userConfig.providers) ? userConfig.providers : ACTIVE_IDS,
    lang: userConfig.lang || 'all',
    tmdbKey: userConfig.tmdbKey || '',
    timeoutSec: Number(userConfig.timeoutSec) || 10,
  };

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
    :root { color-scheme: dark; --bg:#0c0c0e; --surface:#151517; --border:#2b292b; --muted:#999499; --text:#f4f1ef; --red:#e74647; --red-light:#ff6865; }
    * { box-sizing:border-box; }
    html { scroll-behavior:smooth; }
    body { margin:0; background:var(--bg); color:var(--text); font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; line-height:1.5; }
    button,input,select { font:inherit; }
    button,a,input,select { -webkit-tap-highlight-color:transparent; }
    :focus-visible { outline:2px solid #ff7770; outline-offset:3px; }
    a { color:inherit; }
    .shell { max-width:1320px; margin:auto; padding:0 48px; }
    .topbar { height:78px; display:flex; align-items:center; justify-content:space-between; gap:20px; border-bottom:1px solid #242124; }
    .brand { display:flex; align-items:center; gap:11px; text-decoration:none; font-size:16px; font-weight:850; letter-spacing:.08em; }
    .brand-mark { display:grid; place-items:center; width:32px; height:32px; background:var(--red); border-radius:8px; }
    .brand-mark svg { width:15px; height:15px; margin-left:2px; }
    .brand span span { color:var(--red-light); }
    .top-right { display:flex; align-items:center; gap:24px; color:#a6a0a2; font-size:12px; font-weight:600; }
    .top-right a { text-decoration:none; transition:color .2s; }
    .top-right a:hover { color:white; }
    .top-pill { display:flex; align-items:center; gap:7px; color:#ded8d6; border:1px solid #373134; border-radius:30px; padding:7px 11px; font-size:11px; }
    .top-pill i, .status-dot { width:6px; height:6px; border-radius:50%; background:#80d8a0; box-shadow:0 0 10px #80d8a080; }
    .hero { min-height:315px; position:relative; display:flex; align-items:center; overflow:hidden; border:1px solid #3a292a; border-radius:16px; margin-top:27px; background:#251315 url('/hero.jpg') center 49%/cover no-repeat; }
    .hero:before { content:""; position:absolute; inset:0; background:linear-gradient(90deg,rgba(18,13,14,.98) 0%,rgba(24,14,15,.93) 36%,rgba(33,13,15,.36) 77%,rgba(22,10,11,.3)); }
    .hero-content { position:relative; padding:42px 48px; max-width:720px; }
    .eyebrow { display:flex; align-items:center; gap:9px; color:#ed8b86; font-size:10px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; }
    .eyebrow:before { content:""; width:21px; height:1px; background:#ec6660; }
    .hero h1 { font-size:clamp(34px,4vw,53px); letter-spacing:-.055em; line-height:1.07; margin:15px 0; font-weight:750; }
    .hero h1 em { color:#ef6260; font-style:normal; }
    .hero p { color:#c1b4b3; font-size:14px; line-height:1.8; max-width:500px; margin:0; }
    .hero-tags { display:flex; flex-wrap:wrap; gap:8px; margin-top:23px; }
    .hero-tags span { padding:6px 10px; border:1px solid #ffffff24; background:#ffffff0a; border-radius:5px; color:#ded4d1; font-size:10px; font-weight:700; letter-spacing:.04em; }
    .hero-index { position:absolute; right:28px; bottom:21px; color:#ffffff85; font-size:10px; letter-spacing:.18em; font-weight:700; }
    .section-heading { margin:53px 0 24px; display:flex; align-items:end; justify-content:space-between; gap:20px; }
    .section-kicker { color:#e7716c; font-size:10px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; }
    .section-heading h2 { margin:6px 0 0; font-size:28px; letter-spacing:-.045em; line-height:1.2; }
    .section-heading p { margin:0; color:var(--muted); font-size:12px; }
    .layout { display:grid; grid-template-columns:minmax(0,1fr) 305px; gap:22px; align-items:start; }
    .main-column { min-width:0; display:grid; gap:18px; }
    .card { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:25px; }
    .card-header { display:flex; align-items:flex-start; gap:14px; margin-bottom:22px; }
    .step { flex:none; display:grid; place-items:center; width:32px; height:32px; border-radius:8px; color:#f17973; background:#3a2223; font-size:12px; font-weight:800; }
    .card-header h3 { margin:0 0 3px; font-size:16px; letter-spacing:-.02em; }
    .card-header p { margin:0; color:var(--muted); font-size:12px; }
    .fields { display:grid; grid-template-columns:1fr 1fr; gap:18px 16px; }
    .field-wide { grid-column:1/-1; }
    .lbl { display:block; color:#d7d0cf; font-size:11px; font-weight:700; margin-bottom:8px; }
    input[type="password"],input[type="number"],input[type="search"],select { width:100%; min-height:42px; background:#101012; color:#e7e2df; border:1px solid #363235; border-radius:7px; padding:10px 12px; font-size:12px; outline:none; }
    input:focus,select:focus { border-color:#b95450; box-shadow:0 0 0 3px #e7464718; }
    input::placeholder { color:#777176; }
    .field-help { display:block; color:#827c7e; font-size:10px; line-height:1.6; margin-top:7px; }
    .providers-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
    .selected-pill { white-space:nowrap; padding:6px 9px; background:#292022; border:1px solid #513132; border-radius:6px; color:#ec8c86; font-size:10px; font-weight:700; }
    .provider-tools { display:flex; gap:10px; align-items:center; margin-bottom:13px; }
    .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    .search-wrap { position:relative; flex:1; }
    .search-wrap svg { position:absolute; top:13px; left:12px; width:16px; height:16px; stroke:#888184; pointer-events:none; }
    .search-wrap input { padding-left:36px; }
    .toolbar { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 16px; }
    .toolbar-label { color:#817b7e; font-size:10px; font-weight:700; align-self:center; margin-right:3px; }
    .btn-chip { color:#bdb6b7; background:#1d1b1d; border:1px solid #343033; border-radius:6px; padding:7px 9px; font-size:10px; font-weight:700; cursor:pointer; transition:.2s; }
    .btn-chip:hover { color:#fff; border-color:#a4504c; background:#302020; }
    .providers-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; max-height:420px; overflow:auto; padding-right:4px; scrollbar-color:#514144 #181719; scrollbar-width:thin; }
    .prov-item { min-width:0; display:flex; align-items:center; gap:11px; padding:11px; border:1px solid #302d2f; border-radius:8px; background:#1a191b; cursor:pointer; transition:border-color .18s,background .18s; }
    .prov-item:hover { border-color:#75504e; }
    .prov-item.checked { background:#211b1c; border-color:#63403f; }
    .prov-item[hidden] { display:none; }
    .prov-item input { flex:none; width:16px; height:16px; margin:0; accent-color:var(--red); cursor:pointer; }
    .prov-meta { min-width:0; flex:1; }
    .prov-name { font-size:11px; font-weight:750; display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .prov-name > span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .prov-cat { font-size:10px; color:#91898b; margin-top:2px; }
    .prov-types { color:#c6817c; font-size:9px; font-weight:700; white-space:nowrap; }
    .empty-search { color:var(--muted); font-size:12px; padding:12px 0; }
    .sidebar { position:sticky; top:20px; }
    .summary { padding:23px; }
    .summary-top { display:flex; align-items:center; gap:10px; }
    .summary-icon { display:grid; place-items:center; width:35px; height:35px; background:#392122; color:#f07c73; border-radius:9px; }
    .summary-icon svg { width:17px; height:17px; }
    .summary-top h3 { font-size:15px; margin:0; }
    .summary-top p { font-size:10px; color:var(--muted); margin:2px 0 0; }
    .summary-line { height:1px; background:#302b2d; margin:20px 0; }
    .summary-row { display:flex; justify-content:space-between; align-items:center; gap:12px; font-size:11px; margin:12px 0; }
    .summary-row span:first-child { color:#999194; }
    .summary-row strong { color:#e4dcda; text-align:right; font-weight:650; }
    .status { display:flex; align-items:center; gap:7px; color:#b1d8bc; font-size:11px; }
    .actions { display:grid; gap:8px; margin-top:20px; }
    .btn { display:flex; justify-content:center; align-items:center; gap:8px; min-height:43px; border-radius:7px; text-decoration:none; font-size:11px; font-weight:750; cursor:pointer; transition:transform .15s,background .15s,border-color .15s; }
    .btn:hover { transform:translateY(-1px); }
    .btn svg { width:15px; height:15px; }
    .btn-primary { background:var(--red); color:white; border:1px solid var(--red); }
    .btn-primary:hover { background:#f05251; }
    .btn-secondary { color:#e1d9d7; background:#242123; border:1px solid #3a3436; }
    .btn-secondary:hover { border-color:#75504e; }
    .manifest-label { margin-top:20px; color:#999194; font-size:10px; font-weight:700; }
    .manifest-preview { margin-top:8px; padding:10px; background:#101012; border:1px solid #302b2e; border-radius:6px; color:#a49a9b; font:10px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; max-height:90px; overflow:auto; }
    .privacy-note { color:#827a7d; font-size:10px; line-height:1.65; margin:10px 0 0; }
    footer { margin:60px 0 0; padding:25px 0 30px; border-top:1px solid #292427; display:flex; justify-content:space-between; gap:15px; align-items:center; color:#777174; font-size:10px; }
    footer a { color:#bbb2b2; text-decoration:none; } footer a:hover { color:white; }
    .footer-brand { color:#bcb4b3; letter-spacing:.1em; font-weight:800; }
    @media(max-width:850px) { .shell { padding:0 24px; } .layout { grid-template-columns:1fr; } .sidebar { position:static; } .summary { display:grid; grid-template-columns:1fr 1fr; gap:0 24px; } .summary-top,.summary-line,.summary-details { grid-column:1; } .summary-actions { grid-column:2; grid-row:1/4; } .actions { margin-top:0; } }
    @media(max-width:560px) { .shell { padding:0 16px; } .topbar { height:68px; } .top-right a { display:none; } .top-right { gap:8px; } .hero { margin-top:16px; min-height:290px; } .hero:before { background:linear-gradient(90deg,rgba(18,13,14,.96),rgba(24,14,15,.78)); } .hero-content { padding:32px 24px; } .hero h1 { font-size:36px; } .hero p { font-size:13px; } .hero-index { display:none; } .section-heading { margin-top:38px; align-items:start; flex-direction:column; gap:6px; } .section-heading h2 { font-size:25px; } .card { padding:19px; } .fields { grid-template-columns:1fr; } .field-wide { grid-column:auto; } .providers-grid { grid-template-columns:1fr; max-height:380px; } .providers-head { flex-wrap:wrap; } .summary { display:block; } .actions { margin-top:20px; } footer { flex-wrap:wrap; margin-top:40px; } }
    @media(prefers-reduced-motion:reduce) { *,*:before,*:after { scroll-behavior:auto !important; transition:none !important; } }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="STREAMFLIX2, inicio"><span class="brand-mark"><svg viewBox="0 0 20 20" fill="white" aria-hidden="true"><path d="M4 2.5v15l13-7.5z"/></svg></span><span>STREAMFLIX<span>2</span></span></a>
      <nav class="top-right" aria-label="Navegación principal"><a href="#configuracion">Configuración</a><a href="/nuvio/manifest.json">Plugin Nuvio ↗</a><span class="top-pill"><i></i> ADDON PARA STREMIO</span></nav>
    </header>

    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-content">
        <div class="eyebrow">Tu entretenimiento, a tu manera</div>
        <h1 id="hero-title">Todo empieza con <em>play.</em></h1>
        <p>Configura tus fuentes y encuentra películas, series y anime desde un solo lugar. A tu gusto, en Stremio.</p>
        <div class="hero-tags"><span>PELÍCULAS</span><span>SERIES</span><span>ANIME</span><span>STREMIO</span></div>
      </div>
      <div class="hero-index" aria-hidden="true">STREAMFLIX2 &nbsp; / &nbsp; 01</div>
    </section>

    <main id="configuracion">
      <div class="section-heading"><div><div class="section-kicker">Hazlo tuyo</div><h2>Configura tu experiencia</h2></div><p>Unos ajustes y estarás listo para empezar.</p></div>
      <div class="layout">
        <div class="main-column">
          <section class="card" aria-labelledby="preferences-title">
            <div class="card-header"><span class="step">01</span><div><h3 id="preferences-title">Tus preferencias</h3><p>Elige cómo quieres encontrar tu contenido.</p></div></div>
            <div class="fields">
              <label class="field"><span class="lbl">Idioma preferido</span><select id="lang">
                <option value="all">Todos · Priorizar Español Latino</option><option value="prefer-es-ES">Todos · Priorizar Castellano (España)</option><option value="prefer-es-SUB">Todos · Priorizar Subtitulado (VOSE)</option><option value="only-es-LAT">Solo Español Latino (es-LAT)</option><option value="only-es-ES">Solo Castellano (es-ES)</option><option value="only-es-SUB">Solo Subtitulado (es-SUB)</option>
              </select></label>
              <label class="field"><span class="lbl">Tiempo por proveedor</span><input type="number" id="timeoutSec" min="4" max="25" step="1" value="10"><span class="field-help">Entre 4 y 25 segundos por proveedor.</span></label>
              <label class="field field-wide"><span class="lbl">Clave API de TMDB v3 · Opcional</span><input type="password" id="tmdbKey" autocomplete="off" placeholder="${hasServerTmdbKey ? 'TMDB configurada en el servidor · deja vacío para usarla' : 'Introduce tu clave API de TMDB'}"><span class="field-help">Cinemeta permite usar IDs de IMDb sin clave. Una clave TMDB puede mejorar los metadatos y habilitar búsquedas por ID TMDB.</span></label>
            </div>
          </section>

          <section class="card" aria-labelledby="providers-title">
            <div class="providers-head"><div class="card-header"><span class="step">02</span><div><h3 id="providers-title">Elige tus proveedores</h3><p>Selecciona las fuentes que quieres consultar.</p></div></div><div class="selected-pill"><span id="selectedCount">${initialClientConfig.providers.length}</span> / ${ACTIVE_SCRAPERS.length} seleccionados</div></div>
            <div class="provider-tools"><label class="search-wrap"><span class="sr-only">Buscar proveedores</span><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg><input type="search" id="providerSearch" placeholder="Buscar un proveedor..." autocomplete="off"></label></div>
            <div class="toolbar" aria-label="Selecciones rápidas"><span class="toolbar-label">REEMPLAZAR SELECCIÓN</span><button type="button" class="btn-chip" data-filter="all">Todos</button><button type="button" class="btn-chip" data-filter="general">Películas y series</button><button type="button" class="btn-chip" data-filter="anime">Anime</button><button type="button" class="btn-chip" data-filter="series">Series / Animación</button><button type="button" class="btn-chip" data-filter="movies">Películas</button><button type="button" class="btn-chip" data-filter="doramas">Doramas</button><button type="button" class="btn-chip" data-filter="none">Ninguno</button></div>
            <div class="providers-grid" id="providersGrid" tabindex="0" aria-label="Lista de proveedores"></div><p class="empty-search" id="emptySearch" hidden>No encontramos proveedores con ese nombre.</p>
          </section>
        </div>

        <aside class="sidebar" aria-label="Instalación">
          <div class="card summary">
            <div class="summary-top"><span class="summary-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 17v3h14v-3"/></svg></span><div><h3>Todo listo</h3><p>Tu configuración personalizada</p></div></div>
            <div class="summary-line"></div>
            <div class="summary-details"><div class="summary-row"><span>Proveedores</span><strong id="summaryCount">${initialClientConfig.providers.length} seleccionados</strong></div><div class="summary-row"><span>Idioma</span><strong id="summaryLang">Español Latino</strong></div><div class="summary-row"><span>Versión</span><strong>v${escapeHtml(ADDON_VERSION)}</strong></div><div class="summary-line"></div><div class="status"><span class="status-dot"></span><span id="selectionStatus">Listo para configurar</span></div></div>
            <div class="summary-actions"><div class="actions"><a class="btn btn-primary" id="installDesktopBtn" href="#"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 17v3h14v-3"/></svg> Instalar en Stremio</a><a class="btn btn-secondary" id="installWebBtn" href="#" target="_blank" rel="noopener noreferrer">Abrir en Stremio Web ↗</a><button type="button" class="btn btn-secondary" id="copyBtn">Copiar enlace del addon</button></div><div class="manifest-label">ENLACE DEL MANIFIESTO</div><div class="manifest-preview" id="manifestUrlPreview"></div><p class="privacy-note">Si añades una clave TMDB, quedará incluida en este enlace. No lo compartas si quieres mantenerla privada.</p></div>
          </div>
        </aside>
      </div>
    </main>
    <footer><span class="footer-brand">STREAMFLIX2</span><span>Hecho para tus próximas historias. &nbsp;·&nbsp; Apache-2.0</span><a href="/nuvio/manifest.json">Disponible para Nuvio ↗</a></footer>
  </div>
  <script>
    (function () {
      const SCRAPERS = ${jsonForScript(scrapersData)};
      const ALL_IDS = SCRAPERS.map((s) => s.id);
      const INITIAL = ${jsonForScript(initialClientConfig)};
      const SERVER_BASE = ${jsonForScript(baseUrl)};

      const grid = document.getElementById('providersGrid');
      const countEl = document.getElementById('selectedCount');
      const previewEl = document.getElementById('manifestUrlPreview');
      const installDesktopBtn = document.getElementById('installDesktopBtn');
      const installWebBtn = document.getElementById('installWebBtn');
      const copyBtn = document.getElementById('copyBtn');
      const searchEl = document.getElementById('providerSearch');
      const emptySearch = document.getElementById('emptySearch');
      const summaryCount = document.getElementById('summaryCount');
      const summaryLang = document.getElementById('summaryLang');
      const selectionStatus = document.getElementById('selectionStatus');
      const langEl = document.getElementById('lang');
      const timeoutEl = document.getElementById('timeoutSec');
      const tmdbEl = document.getElementById('tmdbKey');

      const selected = new Set(Array.isArray(INITIAL.providers) ? INITIAL.providers : ALL_IDS);

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
          label.dataset.search = (s.name + ' ' + s.categoryLabel + ' ' + s.id).toLowerCase();
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
          const nameRow = document.createElement('div');
          nameRow.className = 'prov-name';
          const name = document.createElement('span');
          name.textContent = s.name;
          const types = document.createElement('span');
          types.className = 'prov-types';
          types.textContent = typesLabel;
          nameRow.appendChild(name);
          nameRow.appendChild(types);
          const category = document.createElement('div');
          category.className = 'prov-cat';
          category.textContent = s.categoryLabel;
          meta.appendChild(nameRow);
          meta.appendChild(category);
          label.appendChild(cb);
          label.appendChild(meta);
          grid.appendChild(label);
        });
        filterProviders();
      }

      function filterProviders() {
        const term = searchEl.value.trim().toLowerCase();
        let visible = 0;
        grid.querySelectorAll('.prov-item').forEach((item) => {
          item.hidden = !item.dataset.search.includes(term);
          if (!item.hidden) visible += 1;
        });
        emptySearch.hidden = visible > 0;
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

        if (Object.keys(payload).length === 0) return '';
        return 'cfg_' + toBase64Url(JSON.stringify(payload));
      }

      function updateUrls() {
        countEl.textContent = String(selected.size);
        summaryCount.textContent = selected.size + ' seleccionados';
        selectionStatus.textContent = selected.size ? 'Listo para configurar' : 'Selecciona al menos un proveedor';
        summaryLang.textContent = langEl.options[langEl.selectedIndex]?.textContent || '';
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

      searchEl.addEventListener('input', filterProviders);

      [langEl, timeoutEl, tmdbEl].forEach((el) => {
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
