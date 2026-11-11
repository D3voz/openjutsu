# Cambios

Todos los cambios destacados de Openjutsu. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [versionado semántico](https://semver.org/lang/es/).

## [Sin publicar]

### Añadido

- Interfaz en español: textos, avisos, etiquetas de modos y márgenes, nombres de las diecisiete luces de Iluminación y mensajes de error. Los identificadores internos y los prompts que se envían a los modelos siguen en inglés.
- API HTTP en `/api/v1` para lanzar, consultar y reexportar trabajos desde scripts o cuadernos: `health`, `jobs`, `jobs/{id}`, `models`, `stats` y `db/export`/`db/import`. Autenticación con `Authorization: Bearer` o `x-api-key`; el login Basic del navegador sigue funcionando.
- Referencia de la API en [`docs/API.es.md`](docs/API.es.md), con ejemplos en `curl` y Python.
- Persistencia en SQLite con el módulo `node:sqlite` (sin dependencias nativas): tablas `meta`, `jobs` y `events`, `journal_mode=WAL`, instantáneas JSON portables y copias `.db` completas.
- CLI de mantenimiento `npm run db` (`info`, `init`, `list`, `export`, `import`, `backup`, `restore`, `prune`, `vacuum`).
- Cuaderno de Google Colab ([`notebooks/openjutsu_colab.ipynb`](notebooks/openjutsu_colab.ipynb)) que instala ComfyUI y los nodos, restaura la base de datos desde Drive, arranca el proxy y la aplicación, abre un túnel de `cloudflared` y guarda copias cada 5 minutos. Instrucciones en [`notebooks/README.es.md`](notebooks/README.es.md).
- README en español; el original queda en [`README.en.md`](README.en.md).

### Cambiado

- Node.js 22.13 o superior (`engines.node`), necesario para `node:sqlite`.
- Las copias de la base de datos usan `VACUUM INTO`, así que salen consistentes aunque la aplicación esté escribiendo.
- `.env.example` documenta `OPENJUTSU_API_KEY`, `OPENJUTSU_DB_PATH` y `OPENJUTSU_DB`.
