"use client";

import { DEFAULT_DESCRIBER } from "../lib/model.ts";

const SUGGESTIONS = [
  { name: "qwen3vl_8b_int8_convrot.safetensors", label: "Qwen3-VL 8B · INT8", size: "9,35 GB", note: "Opción por defecto de Openjutsu", url: "https://huggingface.co/Comfy-Org/Qwen3-VL/blob/main/text_encoders/qwen3vl_8b_int8_convrot.safetensors" },
  { name: "qwen3vl_4b_fp8_scaled.safetensors", label: "Qwen3-VL 4B · FP8", size: "5,24 GB", note: "Alternativa Qwen más pequeña", url: "https://huggingface.co/Comfy-Org/Qwen3-VL/blob/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors" },
  { name: "gemma4_e2b_it_int8_convrot.safetensors", label: "Gemma 4 E2B · INT8", size: "5,2 GB", note: "Alternativa de visión más pequeña", url: "https://huggingface.co/Comfy-Org/gemma-4/blob/main/text_encoders/gemma4_e2b_it_int8_convrot.safetensors" },
];

export function Welcome({ value, options, onChange, loading, error, onRefresh, onContinue }: {
  value: string; options: string[]; onChange: (value: string) => void; loading: boolean; error: string;
  onRefresh: () => void; onContinue: () => void;
}) {
  const installed = !error && options.includes(value);
  const suggested = SUGGESTIONS.filter((model) => options.includes(model.name));
  const other = options.filter((name) => !SUGGESTIONS.some((model) => model.name === name));

  return <main className="shell welcome">
    <header className="top"><div className="brand">
      <span className="mark" aria-hidden>忍</span>
      <div><h1>Openjutsu</h1><p>Pesos abiertos. Tu vídeo. Tu GPU.</p></div>
    </div></header>

    <section className="welcome-intro">
      <p className="eyebrow">ANTES DE TU PRIMER CAMBIO</p>
      <h2>Bienvenido a Openjutsu.</h2>
      <p>Dale a tu vídeo un reparto nuevo, cambia un objeto o reconstruye la escena. Empieza eligiendo el modelo que ayuda a Openjutsu a entender lo que ve.</p>
      <ol className="welcome-flow">
        <li><strong>Ver y describir</strong><span>Un modelo de visión y lenguaje lee tus fotos y fotogramas, identifica a las personas y escribe los prompts.</span></li>
        <li><strong>Seguir la edición</strong><span>SAM sigue a las personas o cosas que quieres cambiar.</span></li>
        <li><strong>Hacer el vídeo</strong><span>MiniMax H3 usa esos prompts y referencias para generar el resultado.</span></li>
      </ol>
    </section>

    <section className="panel welcome-picker" aria-labelledby="describer-heading">
      <div><p className="eyebrow">01 / ELIGE TU DESCRIPTOR VISUAL</p>
        <h2 id="describer-heading">Un modelo que ve y escribe.</h2>
        <p className="hint">Usa un modelo de visión y lenguaje (VLM) con comprensión de imágenes y generación de texto. Esta elección también se aplica a Buscar personas.</p>
      </div>
      <label htmlFor="describer">Descriptor visual</label>
      <select id="describer" className="file-name" value={value} onChange={(event) => onChange(event.target.value)} disabled={loading} aria-describedby="describer-help">
        {!options.includes(value) && <option value={value}>{value}{loading ? " — comprobando…" : " — no instalado"}</option>}
        {suggested.length > 0 && <optgroup label="Modelos sugeridos instalados en ComfyUI">
          {suggested.map((model) => <option key={model.name} value={model.name}>{model.label}{model.name === DEFAULT_DESCRIBER ? " (por defecto)" : ""}</option>)}
        </optgroup>}
        {other.length > 0 && <optgroup label="Otros modelos instalados — comprueba el soporte de visión">
          {other.map((name) => <option key={name} value={name}>{name}</option>)}
        </optgroup>}
      </select>
      <p id="describer-help" className="hint">Los demás modelos deben funcionar con los nodos CLIPLoader y Generate Text de ComfyUI, incluida la entrada de imágenes y fotogramas. Que un archivo aparezca aquí confirma que está instalado; no confirma que tenga visión. Los modelos solo de texto y los archivos GGUF que necesitan otro cargador no se pueden usar aquí.</p>
      <p className="hint">El codificador de texto de MiniMax H3 sigue estando en Componentes del modelo. Elige aquí un modelo de visión y lenguaje completo, no un codificador específico de H3.</p>

      <div className="welcome-install">
        <strong>Primero pon el modelo en esta carpeta</strong>
        <code>ComfyUI\models\text_encoders</code>
        <p className="hint">Usa la carpeta de tu instalación de ComfyUI. Añade un modelo de archivo único compatible con sus pesos de visión y después actualiza la lista. Si sigue sin aparecer, reinicia ComfyUI y vuelve a actualizar.</p>
        <div className="row"><span className="hint" role="status">{loading ? "Leyendo los modelos instalados…" : error ? "Lista de modelos de ComfyUI no disponible" : installed ? "El archivo elegido está instalado" : "El archivo elegido no está instalado"}</span>
          <button className="secondary" disabled={loading} onClick={onRefresh}>{loading ? "Actualizando…" : "Actualizar modelos"}</button></div>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </section>

    <section className="panel welcome-memory" aria-labelledby="vram-heading">
      <div><p className="eyebrow">02 / DEJA ESPACIO PARA EL TRABAJO</p><h2 id="vram-heading">Elige según tu VRAM disponible.</h2></div>
      <p className="hint">Con poca VRAM, empieza por un modelo cuantizado más pequeño como Qwen3-VL 4B FP8 o Gemma 4 E2B INT8. Con más margen, mantén el Qwen3-VL 8B INT8 por defecto. Una precisión mayor suele necesitar más memoria.</p>
      <div className="welcome-table"><table>
        <caption>Ejemplos disponibles como archivos de modelo de ComfyUI</caption>
        <thead><tr><th scope="col">Modelo</th><th scope="col">Tamaño del archivo</th><th scope="col">Uso</th></tr></thead>
        <tbody>{SUGGESTIONS.map((model) => <tr key={model.name}>
          <th scope="row"><a href={model.url} target="_blank" rel="noreferrer">{model.label}</a></th>
          <td>{model.size}</td><td>{model.note}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="hint">El tamaño del archivo es una guía aproximada del almacenamiento de pesos, no un requisito de VRAM. Las imágenes, los fotogramas, el contexto y la memoria de trabajo necesitan espacio adicional. ComfyUI puede descargar a la RAM del sistema, lo que puede ser más lento. La generación de vídeo con H3 tiene sus propias necesidades de memoria, mayores; esta elección por sí sola no garantiza que quepa un cambio completo.</p>
      <p className="hint">Gemma necesita una versión con soporte de visión. Otros modelos alternativos pueden cambiar la calidad de los prompts y la fiabilidad con la que se empareja a las personas; los flujos de Openjutsu usan Qwen3-VL 8B por defecto.</p>
    </section>

    <footer className="welcome-actions">
      <div><strong>Tu elección se queda en este navegador.</strong><p className="hint">Vuelve a abrir Bienvenida y modelos cuando quieras cambiarla.</p></div>
      <div className="row"><button className="secondary" onClick={onContinue}>Configurar más tarde</button>
        <button className="primary" disabled={loading || !installed} onClick={onContinue}>Continuar a Openjutsu →</button></div>
    </footer>
  </main>;
}
