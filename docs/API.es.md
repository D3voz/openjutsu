# API de Openjutsu

Openjutsu expone una API JSON en `/api/v1` para usar el motor de cambios de personaje y de objeto desde scripts, cuadernos de Colab, automatizaciones o cualquier otro servicio.

> La referencia en inglés está en el `README.en.md` del repositorio; este documento describe la API en español.

- [Base y autenticación](#base-y-autenticación)
- [Endpoints](#endpoints)
- [Crear un trabajo](#crear-un-trabajo)
- [Consultar el progreso](#consultar-el-progreso)
- [Base de datos](#base-de-datos)
- [Ejemplos](#ejemplos)
- [Errores](#errores)

## Base y autenticación

- URL base local: `http://127.0.0.1:3000`. En Colab suele ser la URL del túnel (por ejemplo `https://algo.trycloudflare.com`).
- Todas las respuestas son JSON, salvo `GET /api/v1/db/export?format=sqlite`, que devuelve el archivo `.db`.
- Formatos aceptados de subida: MP4, MOV, MKV, WebM y AVI para el vídeo; PNG, JPEG y WebP para las fotos.

### Cabeceras

```http
Authorization: Bearer <OPENJUTSU_API_KEY>
```

o bien:

```http
x-api-key: <OPENJUTSU_API_KEY>
```

- Con `OPENJUTSU_API_KEY` definida en el servidor, esas cabeceras bastan y **no** se aplica la comprobación de origen (`Origin` / `Sec-Fetch-Site`). Es lo que permite llamar a la API desde otro host o desde un cuaderno.
- Sin clave configurada, se usa el login Basic de la aplicación (usuario `openjutsu`) o, si tampoco hay `OPENJUTSU_PASSWORD`, solo se admite tráfico local.
- Una clave incorrecta devuelve `401` con `WWW-Authenticate: Bearer`.

> La API es de un solo propietario: quien tenga la clave o la contraseña ve todos los trabajos.

## Endpoints

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Estado del servicio, de SQLite y de ComfyUI |
| `GET` | `/api/v1/jobs` | Lista los trabajos guardados |
| `POST` | `/api/v1/jobs` | Envía un trabajo nuevo (multipart, igual que la interfaz) |
| `GET` | `/api/v1/jobs/{id}` | Estado en vivo de un trabajo, su registro y sus eventos |
| `DELETE` | `/api/v1/jobs/{id}` | Cancela un trabajo |
| `GET` | `/api/v1/models` | Modelos, LoRAs, codificadores de texto y VAE instalados en ComfyUI |
| `GET` | `/api/v1/stats` | Conteos por estado y por tipo, y tamaño de la base de datos |
| `GET` | `/api/v1/db/export` | Descarga una instantánea JSON (`?format=sqlite` para el archivo `.db`) |
| `POST` | `/api/v1/db/import` | Restaura una instantánea exportada |

### `GET /api/v1/health`

```json
{
  "ok": true,
  "service": "openjutsu",
  "time": "2026-11-10T12:00:00.000Z",
  "db": { "ok": true, "path": "/content/openjutsu/data/openjutsu.db", "sizeBytes": 40960, "jobs": 12, "lastJobAt": "2026-11-10T11:58:03.000Z" },
  "comfy": { "ok": true }
}
```

`ok` es `true` solo si responden tanto la base de datos como ComfyUI. Un fallo se informa dentro del objeto (`db.ok` / `comfy.ok` con su `error`), no como error HTTP, para que un monitor pueda distinguir "servidor vivo, ComfyUI caído".

### `GET /api/v1/jobs`

Parámetros de consulta:

| Parámetro | Por defecto | Límites | Qué hace |
| --- | --- | --- | --- |
| `limit` | `50` | 1–500 | Tamaño de página |
| `offset` | `0` | 0–1 000 000 | Desplazamiento |
| `status` | — | — | Filtra por estado (`queued`, `running`, `succeeded`, `failed`, `canceled`, `expired`) |
| `kind` | — | — | Filtra por tipo (`simple`, `advanced`, `object`, `face`, `color`, `people`, `montage`, `mask`, `fit`) |

```json
{
  "jobs": [
    {
      "id": "6f1c…",
      "kind": "simple",
      "status": "succeeded",
      "title": "simple · person · the singer",
      "params": { "start": 0, "length": 6, "resolution": "736p", "seed": 42, "roles": [] },
      "result": { "status": "succeeded", "video": "h3_oneclick_swap_00001.mp4", "url": "/api/jobs/6f1c…/outputs/0" },
      "comfyPromptId": "6f1c…",
      "createdAt": "2026-11-10T11:58:03.000Z",
      "updatedAt": "2026-11-10T12:06:41.000Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

### `GET /api/v1/jobs/{id}`

Devuelve el estado real que reporta ComfyUI, más `record` (la fila guardada en SQLite) y `events` (hasta 200, los más recientes primero). Si el trabajo existe en la base de datos, esta llamada refresca su estado guardado.

```json
{
  "id": "6f1c…",
  "status": "running",
  "progress": { "node": "SamplerCustomAdvanced", "step": 3, "steps": 6, "clip": 1 },
  "video": null,
  "record": { "…": "…" },
  "events": [{ "at": "2026-11-10T12:00:00.000Z", "type": "progress", "message": "clip 1" }]
}
```

### `DELETE /api/v1/jobs/{id}`

Cancela el trabajo en ComfyUI y actualiza su estado guardado. Devuelve el trabajo público cancelado.

### `GET /api/v1/models`

Reexporta la ruta que usa la interfaz. Es la forma de saber qué nombres exactos enviar en `model`, `describer`, `text_encoder`, `video_vae`, `audio_vae` y `lora`.

```json
{ "models": ["minimax_h3_ref2va_pruned_int8_convrot.safetensors"], "loras": ["minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors"], "textEncoders": ["qwen3vl_8b_int8_convrot.safetensors"], "vaes": ["minimax_h3_video_vae_int8_convrot.safetensors"] }
```

### `GET /api/v1/stats`

```json
{
  "jobs": 12,
  "byStatus": { "succeeded": 9, "failed": 2, "running": 1 },
  "byKind": { "simple": 7, "object": 5 },
  "lastJobAt": "2026-11-10T11:58:03.000Z",
  "database": { "path": "/content/openjutsu/data/openjutsu.db", "sizeBytes": 40960 }
}
```

## Crear un trabajo

`POST /api/v1/jobs` acepta `multipart/form-data`, exactamente igual que el formulario de la interfaz. Campos comunes:

| Campo | Tipo | Obligatorio | Qué es |
| --- | --- | --- | --- |
| `mode` | texto | sí | `simple`, `advanced`, `object`, `face`, `color`, `people`, `montage`, `mask` o `fit` |
| `video` | archivo | sí | Vídeo de origen |
| `start` | número | no | Segundo donde empieza la parte a usar (por defecto `0`) |
| `length` | número | no | Duración de la parte; `0` o vacío usa el vídeo entero |
| `resolution` | texto | según modo | `480p`, `576p`, `736p`, `768p`, `1080p`, o `anchoxalto` (por ejemplo `1280x720`, 256–2048 px por lado, múltiplos de 32) |
| `motion` | número | según modo | `512`, `768` o `1376` |
| `seed` | entero | según modo | `0` a `4294967295` |
| `clip_seconds` | número | según modo | Duración de cada clip o bloque |
| `steps` | entero | según modo | Pasos de muestreo |
| `model` | texto | según modo | Modelo base instalado en ComfyUI |
| `lora`, `lora_strength`, `lora_speed` | repetidos | no | Un `lora` por LoRA, con su intensidad y `true`/`false` si es rápida |
| `text_encoder`, `video_vae`, `audio_vae` | texto | no | Nombres exactos de los archivos instalados |
| `describer` | texto | no | Descriptor visual (`models/text_encoders`) |
| `acceleration` | texto | no | `none` o `spectrum` |

Campos por modo:

- **`simple`**: `picture` (foto del personaje), `role`, `no_lip_sync`, `hat_fix`, `margin` (`tight`/`normal`/`loose`), `target` (lo que sigue SAM, en inglés: `person` por defecto).
- **`advanced`**: `picture` y `role` repetidos (1–4), `no_lip_sync`, `hat_fix`, `margin`, `target`, `max_quality` (necesita exactamente dos fotos).
- **`object`**: `edit_mode` (`change`/`add`/`remove`/`background`), `target`, `change_to`, `picture` (opcional, salvo en `add`/`change`), `biggest_only`, `keep_outline`, `margin` (`tight` = 10 px, `normal` = 20 px, `loose` = 40 px), `paint` o `placement` (JSON, opcional), `action` (solo `add`).
- **`face`**: `picture` (la foto de la persona), `style` (`photo` = igualar la foto, `mouth` = seguir la boca), `seed`, `clip_seconds`.
- **`color`**: `detail` (por ejemplo `-0.20`, vacío para desactivar) y/o `tone_mode` (`Filmic Soft`, `Filmic Strong`, `ACES Approx`, `Reinhard`, `Cineon-ish`) con los valores `tone_<clave>`.
- **`people`**: `role` repetido con "quién - aspecto" para cada foto; solo analiza y guarda los seguimientos.
- **`montage`**: como `advanced`, más `tracks` e `labels` si vienes de `people`.
- **`mask`** y **`fit`**: comprobaciones previas sin H3.

Respuesta: `202 Accepted` con el trabajo público (el mismo objeto que devuelve `GET /api/v1/jobs/{id}` en cuanto ComfyUI lo conoce).

> Los mensajes de error del servidor están en inglés, porque son los mismos que muestra la interfaz y los fija la batería de pruebas (`npm test`).

## Consultar el progreso

No hay SSE en la v1 (la interfaz usa `/api/jobs/{id}/events`). Para automatizar, consulta `GET /api/v1/jobs/{id}` cada 5–10 s:

```python
import time, requests

while True:
    job = requests.get(f"{BASE}/api/v1/jobs/{job_id}", headers=HEADERS, timeout=30).json()
    if job["status"] in {"succeeded", "failed", "canceled", "expired"}:
        break
    time.sleep(8)
```

Cuando termina bien, `video.url` es la ruta de descarga dentro de la aplicación (`/api/jobs/{id}/outputs/0`) y `record.result.url` guarda la misma ruta para poder recuperarla después de reiniciar el worker.

## Base de datos

La API v1 también expone el almacén SQLite:

- `GET /api/v1/db/export` → instantánea JSON `{ schemaVersion, exportedAt, meta, jobs, events }`.
- `GET /api/v1/db/export?format=sqlite` → el archivo `.db` completo. La copia se hace con `VACUUM INTO`, así que es íntegra aunque la aplicación esté escribiendo en ese momento.
- `POST /api/v1/db/import` → acepta la instantánea tal cual, o `{ "replace": true, "snapshot": { … } }` para vaciar el historial antes de restaurar. La importación es transaccional: si falla, el archivo queda intacto.

```sh
# Copia a Google Drive desde un worker de Colab
curl -H "Authorization: Bearer $OPENJUTSU_API_KEY" \
  "$BASE/api/v1/db/export?format=sqlite" -o openjutsu-backup.db

# Restaurar una instantánea JSON
curl -X POST -H "Authorization: Bearer $OPENJUTSU_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @openjutsu-2026-11-10.json \
  "$BASE/api/v1/db/import"
```

Esquema (versión 1):

- `meta(key, value, updated_at)`: versión del esquema, última importación y otros datos sueltos.
- `jobs(id, kind, status, title, params_json, result_json, comfy_prompt_id, created_at, updated_at)`.
- `events(id, job_id, at, type, message)`.

## Ejemplos

### 1. Estado del servidor

```sh
curl -s -H "Authorization: Bearer $OPENJUTSU_API_KEY" \
  "http://127.0.0.1:3000/api/v1/health" | jq
```

### 2. Lanzar un cambio simple desde Python

```python
import os, requests

BASE = os.environ.get("OPENJUTSU_URL", "http://127.0.0.1:3000")
HEADERS = {"Authorization": f"Bearer {os.environ['OPENJUTSU_API_KEY']}"}

models = requests.get(f"{BASE}/api/v1/models", headers=HEADERS, timeout=30).json()

with open("video.mp4", "rb") as video, open("personaje.png", "rb") as photo:
    response = requests.post(
        f"{BASE}/api/v1/jobs",
        headers=HEADERS,
        timeout=600,
        data={
            "mode": "simple",
            "role": "the singer - red dress",
            "resolution": "736p",
            "motion": "512",
            "seed": "42",
            "clip_seconds": "6",
            "steps": "6",
            "model": models["models"][0],
            "lora": "minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors",
            "lora_strength": "1",
            "lora_speed": "true",
            "target": "person",
        },
        files={"video": ("video.mp4", video, "video/mp4"), "picture": ("personaje.png", photo, "image/png")},
    )

response.raise_for_status()
job = response.json()
print(job["id"], job["status"])
```

### 3. Descargar el resultado

```python
detail = requests.get(f"{BASE}/api/v1/jobs/{job['id']}", headers=HEADERS, timeout=30).json()
if detail.get("video"):
    video = requests.get(BASE + detail["video"]["url"], headers=HEADERS, timeout=300)
    open("resultado.mp4", "wb").write(video.content)
```

### 4. Copia de seguridad en Colab

```python
import requests

db = requests.get(f"{BASE}/api/v1/db/export?format=sqlite", headers=HEADERS, timeout=120)
open("/content/drive/MyDrive/openjutsu/openjutsu.db", "wb").write(db.content)
```

## Errores

| Código | Cuándo |
| --- | --- |
| `400` | Datos inválidos: falta un campo, un archivo no es del tipo correcto, una instantánea mal formada |
| `401` | Clave de API incorrecta o falta el login |
| `403` | Petición de otro origen sin clave, o servidor expuesto sin contraseña |
| `404` | Salida inexistente al descargar un vídeo o una vista previa |
| `413` | Subida de más de 512 MB o campos de formulario demasiado grandes |
| `429` | Ya hay tres subidas en curso, o demasiados intentos de login |
| `500` | Fallo de la base de datos (por ejemplo con `OPENJUTSU_DB=off`) |
| `502` | ComfyUI no responde, rechazó el trabajo o ya no conoce ese id |

El cuerpo del error sigue siempre la forma `{ "error": "…" }`.
