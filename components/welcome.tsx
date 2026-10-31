"use client";

import { useT, LanguageSwitch } from "./language.tsx";

import { DEFAULT_DESCRIBER } from "../lib/model.ts";

const SUGGESTIONS = [
  { name: "qwen3vl_8b_int8_convrot.safetensors", label: "Qwen3-VL 8B · INT8", size: "9.35 GB", note: "Openjutsu default", url: "https://huggingface.co/Comfy-Org/Qwen3-VL/blob/main/text_encoders/qwen3vl_8b_int8_convrot.safetensors" },
  { name: "qwen3vl_4b_fp8_scaled.safetensors", label: "Qwen3-VL 4B · FP8", size: "5.24 GB", note: "Smaller Qwen alternative", url: "https://huggingface.co/Comfy-Org/Qwen3-VL/blob/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors" },
  { name: "gemma4_e2b_it_int8_convrot.safetensors", label: "Gemma 4 E2B · INT8", size: "5.2 GB", note: "Smaller vision alternative", url: "https://huggingface.co/Comfy-Org/gemma-4/blob/main/text_encoders/gemma4_e2b_it_int8_convrot.safetensors" },
];

export function Welcome({ value, options, onChange, loading, error, onRefresh, onContinue }: {
  value: string; options: string[]; onChange: (value: string) => void; loading: boolean; error: string;
  onRefresh: () => void; onContinue: () => void;
}) {
  const t = useT();
  const installed = !error && options.includes(value);
  const suggested = SUGGESTIONS.filter((model) => options.includes(model.name));
  const other = options.filter((name) => !SUGGESTIONS.some((model) => model.name === name));

  return <main className="shell welcome">
    <header className="top row"><div className="brand">
      <span className="mark" aria-hidden>忍</span>
      <div><h1>Openjutsu</h1><p>{t("Open weights. Your video. Your GPU.")}</p></div>
    </div><LanguageSwitch /></header>

    <section className="welcome-intro">
      <p className="eyebrow">{t("BEFORE YOUR FIRST SWAP")}</p>
      <h2>{t("Welcome to Openjutsu.")}</h2>
      <p>{t("Give your video a new cast, change an object or rebuild the scene. Start by choosing the model that helps Openjutsu understand what it sees.")}</p>
      <ol className="welcome-flow">
        <li><strong>{t("See & describe")}</strong><span>{t("A vision-language model reads your photos and video frames, identifies people and writes prompts.")}</span></li>
        <li><strong>{t("Track the edit")}</strong><span>{t("SAM follows the people or things you want to change.")}</span></li>
        <li><strong>{t("Make the video")}</strong><span>{t("MiniMax H3 uses those prompts and references to generate the result.")}</span></li>
      </ol>
    </section>

    <section className="panel welcome-picker" aria-labelledby="describer-heading">
      <div><p className="eyebrow">{t("01 / CHOOSE YOUR VISUAL DESCRIBER")}</p>
        <h2 id="describer-heading">{t("A model that can see and write.")}</h2>
        <p className="hint">{t("Use a vision-language model (VLM) with image understanding and text generation. This choice also applies to Find people.")}</p>
      </div>
      <label htmlFor="describer">{t("Visual describer")}</label>
      <select id="describer" className="file-name" value={value} onChange={(event) => onChange(event.target.value)} disabled={loading} aria-describedby="describer-help">
        {!options.includes(value) && <option value={value}>{value}{loading ? t(" — checking…") : t(" — not installed")}</option>}
        {suggested.length > 0 && <optgroup label={t("Suggested models installed in ComfyUI")}>
          {suggested.map((model) => <option key={model.name} value={model.name}>{model.label}{model.name === DEFAULT_DESCRIBER ? t(" (default)") : ""}</option>)}
        </optgroup>}
        {other.length > 0 && <optgroup label={t("Other installed models — check vision support")}>
          {other.map((name) => <option key={name} value={name}>{name}</option>)}
        </optgroup>}
      </select>
      <p id="describer-help" className="hint">{t("Other models must work with ComfyUI’s CLIPLoader and Generate Text nodes, including image and video-frame input. A file appearing here confirms it is installed; it does not confirm vision support. Text-only models and GGUF files needing a different loader cannot be used here.")}</p>
      <p className="hint">{t("The separate MiniMax H3 text encoder stays in Model components. Choose a full vision-language model here, rather than an H3-specific encoder.")}</p>

      <div className="welcome-install">
        <strong>{t("Put the model in this folder first")}</strong>
        <code>ComfyUI\models\text_encoders</code>
        <p className="hint">{t("Use your ComfyUI installation folder. Add a compatible single-file model with its vision weights, then refresh the list. If it still does not appear, restart ComfyUI and refresh again.")}</p>
        <div className="row"><span className="hint" role="status">{loading ? t("Reading installed models…") : error ? t("ComfyUI model list unavailable") : installed ? t("Selected file is installed") : t("Selected file is not installed")}</span>
          <button className="secondary" disabled={loading} onClick={onRefresh}>{loading ? t("Refreshing…") : t("Refresh models")}</button></div>
        {error && <p className="error" role="alert">{t(error)}</p>}
      </div>
    </section>

    <section className="panel welcome-memory" aria-labelledby="vram-heading">
      <div><p className="eyebrow">{t("02 / LEAVE ROOM FOR THE WORK")}</p><h2 id="vram-heading">{t("Choose for your available VRAM.")}</h2></div>
      <p className="hint">{t("For limited VRAM, start with a smaller quantized model such as Qwen3-VL 4B FP8 or Gemma 4 E2B INT8. With more headroom, keep the Qwen3-VL 8B INT8 default. Higher precision usually needs more memory.")}</p>
      <div className="welcome-table"><table>
        <caption>{t("Examples available as ComfyUI model files")}</caption>
        <thead><tr><th scope="col">{t("Model")}</th><th scope="col">{t("File size")}</th><th scope="col">{t("Use")}</th></tr></thead>
        <tbody>{SUGGESTIONS.map((model) => <tr key={model.name}>
          <th scope="row"><a href={model.url} target="_blank" rel="noreferrer">{model.label}</a></th>
          <td>{model.size}</td><td>{t(model.note)}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="hint">{t("File size is a rough guide to weight storage, not a VRAM requirement. Images, video frames, context and working memory need extra space. ComfyUI may offload to system RAM, which can be slower. H3 video generation has its own, larger memory needs; this choice alone does not guarantee a full swap will fit.")}</p>
      <p className="hint">{t("Gemma needs a version with vision support. Alternative models can change prompt quality and how reliably people are matched; Openjutsu’s workflows default to Qwen3-VL 8B.")}</p>
    </section>

    <footer className="welcome-actions">
      <div><strong>{t("Your choice stays in this browser.")}</strong><p className="hint">{t("Reopen Welcome & models any time to change it.")}</p></div>
      <div className="row"><button className="secondary" onClick={onContinue}>{t("Set up later")}</button>
        <button className="primary" disabled={loading || !installed} onClick={onContinue}>{t("Continue to Openjutsu →")}</button></div>
    </footer>
  </main>;
}
