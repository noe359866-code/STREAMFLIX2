#!/usr/bin/env bash
# =============================================================================
# Instalador automático del Nginx externo de STREAMFLIX2 (Ubuntu / Debian)
# Uso: sudo BEAMUP_HOST=7e2a912be9c9-streamflix2.baby-beamup.club bash nginx/install-nginx.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE_FILE="${SCRIPT_DIR}/streamflix2.conf.template"

NGINX_PORT="${NGINX_PORT:-8080}"
SERVER_NAME="${SERVER_NAME:-_}"
BEAMUP_SCHEME="${BEAMUP_SCHEME:-https}"
BEAMUP_HOST="${BEAMUP_HOST:-7e2a912be9c9-streamflix2.baby-beamup.club}"
NGINX_PROXY_TOKEN="${NGINX_PROXY_TOKEN:-}"
DNS_RESOLVER="${DNS_RESOLVER:-1.1.1.1 8.8.8.8}"
CONF_DEST="${CONF_DEST:-/etc/nginx/conf.d/streamflix2.conf}"

if ! command -v nginx >/dev/null 2>&1; then
  echo "==> Instalando nginx..."
  apt-get update -y && apt-get install -y nginx gettext-base
fi

mkdir -p /var/cache/nginx/streamflix2_addon
if id www-data >/dev/null 2>&1; then
  chown -R www-data:www-data /var/cache/nginx/streamflix2_addon
fi

if command -v node >/dev/null 2>&1; then
  NGINX_PORT="$NGINX_PORT" \
  SERVER_NAME="$SERVER_NAME" \
  BEAMUP_SCHEME="$BEAMUP_SCHEME" \
  BEAMUP_HOST="$BEAMUP_HOST" \
  NGINX_PROXY_TOKEN="$NGINX_PROXY_TOKEN" \
  DNS_RESOLVER="$DNS_RESOLVER" \
  node "${SCRIPT_DIR}/render-config.cjs" --output "$CONF_DEST"
else
  export NGINX_PORT SERVER_NAME BEAMUP_SCHEME BEAMUP_HOST NGINX_PROXY_TOKEN DNS_RESOLVER
  envsubst '${NGINX_PORT} ${SERVER_NAME} ${BEAMUP_SCHEME} ${BEAMUP_HOST} ${NGINX_PROXY_TOKEN} ${DNS_RESOLVER}' \
    < "$TEMPLATE_FILE" > "$CONF_DEST"
fi

echo "==> Validando configuración con nginx -t..."
nginx -t

if command -v systemctl >/dev/null 2>&1 && systemctl is-system-running >/dev/null 2>&1; then
  systemctl enable nginx
  systemctl reload nginx || systemctl restart nginx
else
  nginx -s reload 2>/dev/null || nginx
fi

echo "✓ Nginx externo activo en puerto ${NGINX_PORT} -> upstream ${BEAMUP_SCHEME}://${BEAMUP_HOST}"
