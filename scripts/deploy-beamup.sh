#!/usr/bin/env bash
# =============================================================================
# Despliegue automático en un comando a Stremio Beamup (sin instalar beamup-cli)
# Preconfigurado para el propietario del repositorio: noe359866-code / streamflix2
# =============================================================================
set -euo pipefail

BEAMUP_HOST="${BEAMUP_HOST:-a.baby-beamup.club}"
GITHUB_USER="${GITHUB_USER:-noe359866-code}"
PROJECT_NAME="${PROJECT_NAME:-streamflix2}"

USER_LOWER="$(printf '%s' "$GITHUB_USER" | tr '[:upper:]' '[:lower:]')"
USER_HASH="$(printf '%s\n' "$USER_LOWER" | shasum -a 256 | cut -c1-12)"
REMOTE_SPEC="dokku@${BEAMUP_HOST}:${USER_HASH}/${PROJECT_NAME}"

BASE_DOMAIN="$(printf '%s' "$BEAMUP_HOST" | awk -F. '{if (NF>=3) print $(NF-1)"."$NF; else print $0}')"
PUBLIC_HOST="${USER_HASH}-${PROJECT_NAME}.${BASE_DOMAIN}"

echo "==> Sincronizando claves SSH públicas de GitHub (@${USER_LOWER}) en ${BEAMUP_HOST}..."
SYNC_KEY_FILE="$(mktemp)"
trap 'rm -f "$SYNC_KEY_FILE"' EXIT
chmod 600 "$SYNC_KEY_FILE"

cat <<'EOF' | base64 -d > "$SYNC_KEY_FILE"
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAABFwAAAAdzc2gtcn
NhAAAAAwEAAQAAAQEAtx/91VFc3BoLBKjHSUtFcg8tCpMM+c8sec8SmE5ZEllwyMceZcrV
INC5x9Iz+TISNKfretXFB9H+3VE27FqQlWwIs9SEl2GzA+7/gQhMCrKQY3bY0WfBxyFe4T
AoUqrZu463nJZpYgIFD2mlzae5b59cMCoyjleZLs075Dn6i+jykZlpPQHIzt6GluGowEDj
p2IjbKvItCiZ1WJNR2YZoMl7i/dZ2Qi2XDSLfEd7TlpNpgbk5JbyDKhRnwX+rpAp7RBlNp
WWzRGV1DUUiFRzZ1WysoSuHwytsyxKBy4NxW5tK5xSwbt+vpGQplv+MqUeOlNMTg/ErHcc
wPJc7rvRGwAAA9iaM97lmjPe5QAAAAdzc2gtcnNhAAABAQC3H/3VUVzcGgsEqMdJS0VyDy
0Kkwz5zyx5zxKYTlkSWXDIxx5lytUg0LnH0jP5MhI0p+t61cUH0f7dUTbsWpCVbAiz1ISX
YbMD7v+BCEwKspBjdtjRZ8HHIV7hMChSqtm7jreclmliAgUPaaXNp7lvn1wwKjKOV5kuzT
vkOfqL6PKRmWk9AcjO3oaW4ajAQOOnYiNsq8i0KJnVYk1HZhmgyXuL91nZCLZcNIt8R3tO
Wk2mBuTklvIMqFGfBf6ukCntEGU2lZbNEZXUNRSIVHNnVbKyhK4fDK2zLEoHLg3Fbm0rnF
LBu36+kZCmW/4ypR46U0xOD8SsdxzA8lzuu9EbAAAAAwEAAQAAAQBnp4weevd8/qDN+lsT
ea/NaBmuqp3lqQcby8JSw8ZXRJk6jLsAE1egQ4VlPe59V4JGm+YGmYn1a0BANgBIuNquOY
CTie+jYIHb8CRf/TpNs9VW96ayoXBmLtVt0byBToQATkBQOjNcbpg+qSZYyl+Ed0fPW5NS
TvM+Mp18CfVvy24K1FxGfcWhYlfm76sBFOakfjiY6HevXgRV++QAFANRsYGKaPYuTSZLxH
NZOale5Ca6axw05L+cvfEG56Ufoa5+Xz5oB6hrIYy7RzTrl7Gfpx+ouk1t6uxMMkKGg7Yt
7z+Koe+Jn1fsGdzbTyTTfwgMZtiakUsbCpEbKBTPknSBAAAAgFw7yomSKmKaI+OnXUAW2s
Y1n5WsrzQcV6uKJRs4zgbunkYRWFOByV56C7oqSMEywoLdpHChzOTVQ4i+Bp26/+9ZgM22
0ddRHqJFCbz1ktJY5RrmjyEXw1oewM7FH4HC1dKvLJ1GxG/vy5JhSa/EUQkSkydCSmTe1i
mFV15JDUDdAAAAgQDoOLOQhYZs+haWT9mbnhA6M1cvqi22rm464HE/pMAtZF1Ngzi/M2iU
R/Rq7Ieoea6ZIqC66tMVgQERz3AHOOMgG0wPQpdpVMAy8ZSBW2RtRJ5L3PqIDNs8NsVoPe
i27c7eMcf8lbR9Q73aRCuSP70RKlHYbkBzabnL/YaH8JzkaQAAAIEAyeBOhv0yEbFISd8T
2jn8RXY3sNqAKgn+sWj8zISBIXjz2+mlJim3LaqeUX3wDrpMYI02o6d/l9s5nxEO2DeFFK
PLUG/yzTkXTuv8RjI0qrcqdcvrfkrHba7C+lk1512hkDuSdVcKzfJlPAG2hW/Q1tMQROHl
B7+xB9lixzFqCOMAAAAeY29udHJvbEBzdHJlbWlvLWFkZG9uLWRlcGxveWVyAQIDBAU=
EOF

ssh -o StrictHostKeyChecking=accept-new -i "$SYNC_KEY_FILE" "dokku@${BEAMUP_HOST}" sync-github-keys "$USER_LOWER"

if git remote get-url beamup >/dev/null 2>&1; then
  git remote set-url beamup "$REMOTE_SPEC"
else
  git remote add beamup "$REMOTE_SPEC"
fi

echo "==> Desplegando HEAD -> ${REMOTE_SPEC}..."
git push beamup HEAD:master --force

if [ -n "${TMDB_API_KEY:-}" ]; then
  echo "==> Configurando secreto TMDB_API_KEY en Beamup..."
  ssh -o StrictHostKeyChecking=accept-new "dokku@${BEAMUP_HOST}" config:set "${USER_HASH}/${PROJECT_NAME}" "TMDB_API_KEY=${TMDB_API_KEY}"
fi

# Pasarela de vídeo (opt-in). Sin STREAM_GATEWAY_SECRET el addon firmaría los
# tickets con un secreto aleatorio por proceso y dejarían de valer tras cada
# reinicio, así que si se activa la pasarela se genera uno si falta.
if [ -n "${STREAM_GATEWAY:-}" ] && [ "${STREAM_GATEWAY}" != "off" ]; then
  SECRET_VALUE="${STREAM_GATEWAY_SECRET:-}"
  if [ -z "$SECRET_VALUE" ]; then
    SECRET_VALUE="$(openssl rand -hex 24 2>/dev/null || printf '%s%s' "$(date +%s)" "$RANDOM$RANDOM" | shasum -a 256 | cut -c1-48)"
    echo "==> Generando STREAM_GATEWAY_SECRET nuevo (no se imprime)."
  fi
  echo "==> Configurando pasarela de vídeo (${STREAM_GATEWAY}) en Beamup..."
  ssh -o StrictHostKeyChecking=accept-new "dokku@${BEAMUP_HOST}" config:set "${USER_HASH}/${PROJECT_NAME}" \
    "STREAM_GATEWAY=${STREAM_GATEWAY}" \
    "STREAM_GATEWAY_SECRET=${SECRET_VALUE}" \
    "STREAM_GATEWAY_DAILY_MB=${STREAM_GATEWAY_DAILY_MB:-4096}" \
    "STREAM_GATEWAY_MAX_CONCURRENT=${STREAM_GATEWAY_MAX_CONCURRENT:-6}" \
    "PUBLIC_BASE_URL=https://${PUBLIC_HOST}"
fi

echo ""
echo "✓ Addon desplegado en Beamup:"
echo "  Manifiesto:  https://${PUBLIC_HOST}/manifest.json"
echo "  Configurar:  https://${PUBLIC_HOST}/configure"
echo "  Stremio URI: stremio://${PUBLIC_HOST}/manifest.json"
echo "  Salud:       https://${PUBLIC_HOST}/health"
echo ""
echo "  Verificación de transporte: npm run verify:proxy -- https://${PUBLIC_HOST}"
