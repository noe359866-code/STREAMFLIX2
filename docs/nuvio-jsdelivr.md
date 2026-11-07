# Instalación de Nuvio mediante jsDelivr

jsDelivr sirve archivos estáticos de repositorios GitHub públicos. STREAMFLIX2 ya versiona `manifest.json` y `providers/*.js`, así que no hay que subir nada a `www.jsdelivr.com`, crear una cuenta ni añadir una dependencia al addon.

## URL de instalación

```text
https://cdn.jsdelivr.net/gh/noe359866-code/STREAMFLIX2@main/manifest.json
```

Añádela en Nuvio como repositorio de plugins. **No** uses `https://www.jsdelivr.com/`: esa es la web del servicio, no el archivo que consume Nuvio.

El manifiesto mantiene rutas relativas:

```json
{ "filename": "providers/cinecalidad.js" }
```

Nuvio las resuelve contra la URL del manifiesto. Por ejemplo:

```text
https://cdn.jsdelivr.net/gh/noe359866-code/STREAMFLIX2@main/providers/cinecalidad.js
```

Por tanto, el mismo paquete funciona en raw GitHub, jsDelivr y el servidor local `/manifest.json` sin generar manifiestos diferentes.

## Requisitos y actualización

- El repositorio debe seguir siendo **público**. No publiques claves, tokens ni configuración privada para hacerlo accesible al CDN.
- La referencia elegida debe existir en GitHub. Un commit local que no se ha publicado no puede descargarlo jsDelivr.
- `@main` es una referencia móvil. La documentación oficial indica una caché de **12 horas** para ramas; los cambios no tienen por qué verse inmediatamente. Las etiquetas/commits exactos se conservan de forma efectiva permanente y no deben reutilizarse para contenido distinto. [1](https://github.com/jsdelivr/jsdelivr)
- Para una instalación reproducible, fija una etiqueta semver o el SHA completo de un commit publicado. Si cambia el paquete, publica una referencia nueva.
- No se ha modificado el contrato de actualización de Nuvio: después de publicar una nueva versión, comprueba en la app que vuelve a descargar el repositorio y los bundles.

## Comandos del repositorio

El script `scripts/nuvio-cdn.cjs` solo usa módulos integrados de Node.js 20+:

```bash
# Sin red: valida manifest.json + providers/*.js e imprime la URL de main.
npm run nuvio:cdn

# Convierte HEAD al SHA completo del checkout actual.
npm run nuvio:cdn -- --ref HEAD

# También admite una etiqueta o SHA publicado explícitos.
npm run nuvio:cdn -- --ref v1.2.3
npm run nuvio:cdn -- --ref <sha-publicado>

# Con red: descarga el manifiesto y todos los bundles anunciados por él.
npm run nuvio:cdn -- --check
npm run nuvio:cdn -- --ref HEAD --check
```

`--check` comprueba HTTP, tipo MIME, JSON del manifiesto, rutas relativas, límite de tamaño y que cada bundle contenga `module.exports` y `getStreams`. **No ejecuta los bundles descargados**, no consulta TMDB ni abre vídeos. Una comprobación correcta demuestra que el CDN entrega el paquete, no que Nuvio reproduzca todos los títulos.

Las pruebas `npm test` cubren el script con respuestas simuladas y **no llaman a jsDelivr**. En GitHub Actions, el workflow manual **Verificar Nuvio en jsDelivr** permite indicar `main`, una etiqueta o un SHA y ejecutar la comprobación real sin secretos. Lanzarlo antes de que la referencia esté publicada o propagada puede devolver 404 o contenido anterior.

## Diagnóstico

| Síntoma | Comprobación |
|---|---|
| 404 en el manifiesto | Repositorio público, referencia publicada y ruta exacta `manifest.json`. |
| 404 en un bundle | El archivo está versionado en esa referencia y su nombre coincide con `filename`. |
| Cambios que no aparecen | Espera la caché de rama o usa una etiqueta/SHA nuevo; no reutilices una URL inmutable para otro contenido. |
| JSON o JavaScript inválido | Ejecuta `npm run check` y después `npm run nuvio:cdn -- --ref <referencia> --check`. |
| Nuvio instala pero no encuentra streams | jsDelivr solo distribuye el código. Revisa el proveedor, la clave efectiva TMDB y los bloqueos del sitio; el CDN no los corrige. |

## Límites

- No sustituye `stremio/server.cjs`, Beamup ni sus rutas dinámicas `/stream/...`.
- No aloja vídeos ni actúa como proxy de reproducción.
- No elude Cloudflare, CAPTCHA, DRM ni restricciones de los hosters.
- No publiques archivos ajenos al paquete ni secretos en las rutas servidas.

Referencia del servicio: [1](https://github.com/jsdelivr/jsdelivr).
