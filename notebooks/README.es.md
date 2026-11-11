# Openjutsu en Google Colab

[`openjutsu_colab.ipynb`](openjutsu_colab.ipynb) instala Openjutsu con ComfyUI en un worker de Colab, abre un túnel público y guarda la base de datos de trabajos en Google Drive para que sobreviva a los reinicios.

Está pensado para probar la interfaz y la API, no para trabajar a diario: una T4 de 16 GB no alcanza para el flujo completo de MiniMax H3 y Colab corta la sesión por inactividad.

## Qué hace cada celda

| Celda | Qué hace |
| --- | --- |
| 1 | Muestra la GPU, la RAM y el disco libres. Si no hay GPU, para aquí. |
| 2 | Define rutas, la rama a clonar y genera la contraseña del navegador y la clave de la API. También define las utilidades (`run`, `start_background`, `wait_for_http`…). |
| 3 | Monta Google Drive y crea `/content/drive/MyDrive/openjutsu`. |
| 4 | Instala Node.js 22 desde NodeSource (la base de datos usa `node:sqlite`, que necesita 22.13 o superior). |
| 5 | Clona tu fork en la rama `espanol-colab-api`, o actualiza la copia que ya exista. |
| 6 | Restaura `openjutsu.db` desde Drive, o crea una base vacía, y muestra su estado con `npm run db:info`. |
| 7 | Instala ComfyUI y los nodos personalizados del README (incluido SolarRenderer desde su subcarpeta `comfyui/`). |
| 8 | Opcional: descarga los pesos que tienen URL pública. Está desactivada por defecto. |
| 9 | Arranca ComfyUI en `127.0.0.1:8188` y espera a que responda. |
| 10 | Instala `comfy-api-proxy==0.1.6`, aplica `patch_proxy.py` y lo arranca en `127.0.0.1:8189`. |
| 11 | Escribe `.env.local`, ejecuta `npm ci`, `npm run build` y arranca la aplicación en `127.0.0.1:3000`. |
| 12 | Descarga `cloudflared` y abre el túnel; imprime la URL pública, la contraseña y la clave. |
| 13 | Comprueba `/api/v1/health`, `/api/v1/stats` y lista los últimos trabajos guardados. |
| 14 | Copia la base de datos a Drive al momento y cada 5 minutos (`save_database()` guarda a mano). |

## Requisitos

- Una GPU NVIDIA. El plan gratuito da una T4 de 16 GB y unos 80 GB de disco; el plan de pago ofrece L4, A100 o similar.
- Espacio para los pesos. Los modelos de H3 (difusión, LoRA DMAD, codificador de texto de 32B, VAEs y SAM 3.1) ocupan decenas de GB y **no tienen descarga pública** en este repositorio: hay que subirlos. La celda 8 solo baja los que sí tienen enlace (Qwen3-VL, Gemma 4, LoRAs de SolarRenderer, modelos de Corregir caras).
- Cuenta de Google con Drive. Los pesos y las copias de la base de datos caben, pero revisa la cuota.

## Los pesos de H3

La celda 8 imprime la lista de archivos que faltan y su carpeta en `ComfyUI/models`:

```
diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors
loras/minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors
text_encoders/qwen3vl_32b_minimax_h3_int4_convrot.safetensors
vae/minimax_h3_video_vae_int8_convrot.safetensors
vae/minimax_h3_audio_vae_fp32.safetensors
checkpoints/sam3.1_multiplex_fp16.safetensors
```

Súbelos a Drive una vez y enlaza la carpeta antes de arrancar ComfyUI (celda 9), para no repetir la subida en cada sesión:

```python
import shutil
shutil.rmtree(COMFY_DIR / "models", ignore_errors=True)
(COMFY_DIR / "models").symlink_to(DRIVE_DIR / "models", target_is_directory=True)
```

Funciona, pero Drive es lento: úsalo para ahorrar descargas, no para renderizar a diario.

## Reinicios y sesiones

- Un reinicio del worker borra `/content`. Vuelve a ejecutar las celdas **2 a 14**; la 6 restaura la base de datos desde Drive, así que la lista de trabajos vuelve.
- La celda 14 copia cada 5 minutos mientras el kernel vive. Si cierras la pestaña, la última copia puede ser de hace unos minutos; ejecuta `save_database()` antes de irte.
- Colab corta la sesión a las ~12 h y tras ~90 min de inactividad. El túnel y la aplicación mueren con ella.
- Las claves se generan en cada sesión. Para una fija, escribe la tuya en la celda 2 (la contraseña necesita 12 caracteres o más).

## Usar la API

Con la URL del túnel y la clave que imprime la celda 12:

```sh
curl -H "Authorization: Bearer $OPENJUTSU_API_KEY" "$PUBLIC_URL/api/v1/health"
```

La referencia completa, con los campos de cada modo y ejemplos en Python, está en [`docs/API.es.md`](../docs/API.es.md).

## Seguridad

El túnel de `trycloudflare` es público: cualquiera con la URL llega al login. La contraseña protege el acceso y la clave protege la API, pero no compartas ninguna de las dos ni dejes el cuaderno abierto en una cuenta compartida. Para usar Openjutsu con datos reales, ejecútalo en local o en una máquina propia detrás de HTTPS.
