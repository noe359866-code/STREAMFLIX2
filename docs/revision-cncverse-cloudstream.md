# Revisión de CNCVerse Cloud Stream Extension

Contraste de [CNCVerse-Cloud-Stream-Extension](https://github.com/NivinCNC/CNCVerse-Cloud-Stream-Extension) con STREAMFLIX2 (Nuvio/QuickJS y addon Stremio), consultado el **6 de noviembre de 2026**. Referencias fijadas: rama `master` en [`4ea17d319a`](https://github.com/NivinCNC/CNCVerse-Cloud-Stream-Extension/commit/4ea17d319af75c74fe4c31f1c70e3b951bd96595) y rama [`builds` en `c84f8c98fc`](https://github.com/NivinCNC/CNCVerse-Cloud-Stream-Extension/tree/c84f8c98fc). Se leyó `CNC.json`, se inventarió `plugins.json` y se inspeccionó **solo la estructura de empaquetado** de muestras `.cs3`; no se ejecutaron ni se incorporaron los binarios.

## Resultado

**No se añaden proveedores ni extractores de CNCVerse a STREAMFLIX2 en esta revisión.** El proyecto actual ofrece extensiones compiladas para CloudStream/Android, predominantemente tamil y de otros idiomas, pero **ningún plugin declarado como español (`es`)**. STREAMFLIX2 distribuye plugins JavaScript con `getStreams(tmdbId, mediaType, season, episode)` para VOD en español. Un `.cs3` no es un bundle QuickJS ni una fuente Stremio; cambiarle la extensión o registrarlo en `manifest.json` no lo haría funcionar.

La falta de coincidencia de idioma **no demuestra** que ninguna película tenga una pista española: `language` es un metadato del plugin, no una prueba de audio/subtítulos de cada vídeo. Tampoco la etiqueta «Working» en el README constituye una prueba de HLS/MP4 reproducible desde GitHub Actions.

## Inventario comprobable

[`builds/plugins.json`](https://github.com/NivinCNC/CNCVerse-Cloud-Stream-Extension/blob/c84f8c98fc/plugins.json) tiene **42 registros**: **41 extensiones** listadas en el README y **un `SubscriptionManager`** (sin idioma declarado, no tratado como proveedor de vídeo). Entre las 41 extensiones hay **27 VOD, 12 Live y 2 de audiolibros** según `tvTypes`. Sus idiomas declarados son `ta` 24, `en` 9, `bn` 3, `hi` 3, `ru` 1 y `te` 1; `es` 0. **39** se anuncian como funcionales, Bilibili como *Geo-Restricted* y HDO como *Broken*. Estos estados son metadatos publicados por el autor, **no** resultados de nuestra auditoría de medios.

| VOD por idioma declarado | Plugins del manifiesto | Comparación con este paquete |
|---|---|---|
| `ta` (16) | BilibiliProvider, CastleTvProvider, CineTvProvider, CNC Verse, CNC Verse Mobile, DoFlixProvider, EinthusanProvider, HDOProvider, MovieBoxProvider, MovieBoxProviderIN, PikashowProvider, Rtally, StreamFlixProvider, TamilDhoolProvider, Tamilian, XonProvider | No sustituyen a un adaptador VOD español. Bilibili está marcado como georrestringido; HDO, como roto. `StreamFlixProvider` es un **nombre de plugin tamil**, no prueba de equivalencia con Streamflix Reborn 2. |
| `en` (3) | AniKoto, AnimeSuge, Watch32 | Anime/películas en inglés, sin declaración de español; no se incorpora un hoster por compartir título con un catálogo TMDB. |
| `bn` (3) | CineDozeProvider, MLSBDProvider, MovieLinkBDProvider | Bengalí; no hay evidencia de episodio y HLS/MP4 español apto para este paquete. |
| `hi` (3) | CineVoodProvider, DesiSerialsProvider, VegaMoviesProvider | Hindi; fuera del idioma actual. |
| `ru` (1) | HDrezkaProvider | Ruso; fuera del idioma actual. |
| `te` (1) | MoviezwapProvider | Telugu; fuera del idioma actual. |

Los **12 Live** (`CricifyProvider`, `DaddyLiveProvider`, `LivXowProvider`, `M3UPlaylistPlayerProvider`, `NTVProvider`, `PlayFyProvider`, `PlayZTVProvider`, `PPVProvider`, `RadioIndiaProvider`, `SKTechProvider`, `SportzxProvider`, `TamilUltraProvider`) y los **2 audiolibros** (`GoldenAudiobook`, `LibriVoxAudiobook`) tampoco son películas/episodios VOD localizables por TMDB mediante este contrato. No se los añade como si fueran series. `CNC.json` remite a ese manifiesto, no a un endpoint Stremio.

## Compatibilidad y permisos

- `master` contiene el README, logotipos y automatización, **no los fuentes actuales de los plugins ni una licencia** (`license: null` en GitHub); `builds` distribuye `.cs3` con `manifest.json` y `classes.dex`. No se descompiló ni se trasplantó código. El hecho de poder descargar un archivo no concede permiso para redistribuirlo o portarlo bajo la licencia Apache-2.0 de este repositorio.
- En el [historial antiguo](https://github.com/NivinCNC/CNCVerse-Cloud-Stream-Extension/tree/37a25bed5ad4d5bc23a1faabf18284978af6f220) sí había fuentes Kotlin y un archivo **GNU GPL v3**; el [commit de limpieza `39858ac631`](https://github.com/NivinCNC/CNCVerse-Cloud-Stream-Extension/commit/39858ac631) eliminó fuentes y `LICENSE`. Una licencia del historial no autoriza a asumir que los binarios **actuales** son reutilizables bajo Apache-2.0; incorporar código GPL v3 al producto actual también introduciría obligaciones incompatibles con mantener este porte solamente bajo Apache-2.0. No se copiaron fuentes históricas.
- El mismo autor publica [CNCVerse Bridge](https://github.com/NivinCNC/CNCVerse-Bridge): **otra aplicación**, para Android y escritorio/servidor, que carga extensiones CloudStream y expone un addon Stremio/Nuvio. Su [README](https://github.com/NivinCNC/CNCVerse-Bridge#readme) indica que está en fase alfa y que Nuvio puede detectar su servidor local. Su [licencia](https://github.com/NivinCNC/CNCVerse-Bridge/blob/main/LICENSE) reserva derechos y prohíbe copiar o distribuir su código sin permiso explícito, con excepciones para terceros. Puede ser una **alternativa instalada por separado por quien quiera probar esos plugins**, no un proveedor JavaScript de STREAMFLIX2 ni una dependencia que debamos incrustar. No se verificó una instalación ni su reproducción.

## Decisión, validación y siguientes pasos

No se añaden URLs de `.cs3` al manifiesto, fuentes de vídeo inferidas de nombres, pasarelas no probadas ni código de los proyectos CNCVerse. No hubo modificación de proveedores activos ni de medios: **no procede atribuir a esta revisión una auditoría nueva** de 41 extensiones que este proyecto no ejecuta. La [última auditoría de nuestros proveedores en Actions](https://github.com/noe359866-code/STREAMFLIX2/actions/runs/42298326175) sigue siendo la de **32 webs × 3 intentos**, con cuatro proveedores que obtuvieron alguna muestra válida y cero retiradas confirmadas.

Si se decide ampliar el producto a otro idioma o a TV en vivo, primero hay que definir el contrato de contenido y obtener una implementación reutilizable con permiso compatible **o crear un adaptador independiente basado en interfaces públicas**. Antes de activar cada web nueva, ejecutar desde **GitHub Actions tres intentos por web**, recorrer título/episodio y comprobar **bytes reales de HLS o MP4**, incluidos segmentos o recursos de inicialización. No retirar ni declarar funcional una fuente basándose únicamente en el HTTP 403/200 de su página, el estado del README o una playlist sin medio. Para el alcance actual de VOD español no hay una aportación portable verificable de CNCVerse que justifique cambiar los 34 adaptadores de STREAMFLIX2.
