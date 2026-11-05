"use client";

import { useEffect, useState } from "react";
import { downloadUrl, SUGGESTIONS } from "../lib/describers.ts";
import { DEFAULT_DESCRIBER } from "../lib/model.ts";

type Download = { name: string; state: "idle" | "downloading" | "done" | "error"; received: number; total: number; error?: string };

export function Welcome({ value, options, onChange, loading, error, onRefresh, onContinue }: {
  value: string; options: string[]; onChange: (value: string) => void; loading: boolean; error: string;
  onRefresh: () => void; onContinue: () => void;
}) {
  const installed = !error && options.includes(value);
  const suggested = SUGGESTIONS.filter((model) => options.includes(model.name));
  const selected = SUGGESTIONS.find((model) => model.name === value);
  const canDownload = selected && !installed;
  const [job, setJob] = useState<Download | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const downloading = job?.state === "downloading";

  async function startDownload() {
    setDownloadError("");
    const response = await fetch("/api/models/download", { method: "POST", body: JSON.stringify({ name: value }) });
    const result = await response.json();
    if (!response.ok) return setDownloadError(result.error ?? "Could not start the download.");
    setJob(result);
  }

  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(async () => {
      try { setJob(await (await fetch("/api/models/download")).json()); } catch {}
    }, 1000);
    return () => clearInterval(timer);
  }, [downloading]);

  useEffect(() => { if (job?.state === "done") onRefresh(); }, [job?.state]);
  const other = options.filter((name) => !SUGGESTIONS.some((model) => model.name === name));

  return <main className="shell welcome">
    <header className="top"><div className="brand">
      <span className="mark" aria-hidden>忍</span>
      <div><h1>Openjutsu</h1><p>Open weights. Your video. Your GPU.</p></div>
    </div></header>

    <section className="welcome-intro">
      <p className="eyebrow">BEFORE YOUR FIRST SWAP</p>
      <h2>Welcome to Openjutsu.</h2>
      <p>Give your video a new cast, change an object or rebuild the scene. Start by choosing the model that helps Openjutsu understand what it sees.</p>
      <ol className="welcome-flow">
        <li><strong>See &amp; describe</strong><span>A vision-language model reads your photos and video frames, identifies people and writes prompts.</span></li>
        <li><strong>Track the edit</strong><span>SAM follows the people or things you want to change.</span></li>
        <li><strong>Make the video</strong><span>MiniMax H3 uses those prompts and references to generate the result.</span></li>
      </ol>
    </section>

    <section className="panel welcome-picker" aria-labelledby="describer-heading">
      <div><p className="eyebrow">01 / CHOOSE YOUR VISUAL DESCRIBER</p>
        <h2 id="describer-heading">A model that can see and write.</h2>
        <p className="hint">Use a vision-language model (VLM) with image understanding and text generation. This choice also applies to Find people.</p>
      </div>
      <div className="row"><label htmlFor="describer">Visual describer</label>
        {canDownload && <button className="secondary download" disabled={downloading || loading} onClick={startDownload}>
          {downloading ? `Downloading… ${job.total ? Math.round(job.received / job.total * 100) + "%" : ""}` : `Download model (${selected.size})`}</button>}</div>
      {canDownload && downloadError && <p className="hint" role="alert">{downloadError} <a href={downloadUrl(selected.url)} rel="noreferrer">Browser download</a></p>}
      {job?.state === "error" && <p className="error" role="alert">{job.error}</p>}
      <select id="describer" className="file-name" value={value} onChange={(event) => onChange(event.target.value)} disabled={loading} aria-describedby="describer-help">
        {!options.includes(value) && <option value={value}>{value}{loading ? " — checking…" : " — not installed"}</option>}
        {suggested.length > 0 && <optgroup label="Suggested models installed in ComfyUI">
          {suggested.map((model) => <option key={model.name} value={model.name}>{model.label}{model.name === DEFAULT_DESCRIBER ? " (default)" : ""}</option>)}
        </optgroup>}
        {other.length > 0 && <optgroup label="Other installed models — check vision support">
          {other.map((name) => <option key={name} value={name}>{name}</option>)}
        </optgroup>}
      </select>
      <p id="describer-help" className="hint">Other models must work with ComfyUI’s CLIPLoader and Generate Text nodes, including image and video-frame input. A file appearing here confirms it is installed; it does not confirm vision support. Text-only models and GGUF files needing a different loader cannot be used here.</p>
      <p className="hint">The separate MiniMax H3 text encoder stays in Model components. Choose a full vision-language model here, rather than an H3-specific encoder.</p>

      <div className="welcome-install">
        <strong>Put the model in this folder first</strong>
        <code>ComfyUI\models\text_encoders</code>
        <p className="hint">Use your ComfyUI installation folder. Use Download model above to save the selected file here automatically (needs COMFYUI_DIR in .env.local), or add a compatible single-file model with its vision weights, then refresh the list. If it still does not appear, restart ComfyUI and refresh again.</p>
        <div className="row"><span className="hint" role="status">{loading ? "Reading installed models…" : error ? "ComfyUI model list unavailable" : installed ? "Selected file is installed" : "Selected file is not installed"}</span>
          <button className="secondary" disabled={loading} onClick={onRefresh}>{loading ? "Refreshing…" : "Refresh models"}</button></div>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </section>

    <section className="panel welcome-memory" aria-labelledby="vram-heading">
      <div><p className="eyebrow">02 / LEAVE ROOM FOR THE WORK</p><h2 id="vram-heading">Choose for your available VRAM.</h2></div>
      <p className="hint">For limited VRAM, start with a smaller quantized model such as Qwen3-VL 4B FP8 or Gemma 4 E2B INT8. With more headroom, keep the Qwen3-VL 8B INT8 default. Higher precision usually needs more memory.</p>
      <div className="welcome-table"><table>
        <caption>Examples available as ComfyUI model files</caption>
        <thead><tr><th scope="col">Model</th><th scope="col">File size</th><th scope="col">Use</th></tr></thead>
        <tbody>{SUGGESTIONS.map((model) => <tr key={model.name}>
          <th scope="row"><a href={model.url} target="_blank" rel="noreferrer">{model.label}</a></th>
          <td>{model.size}</td><td>{model.note}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="hint">File size is a rough guide to weight storage, not a VRAM requirement. Images, video frames, context and working memory need extra space. ComfyUI may offload to system RAM, which can be slower. H3 video generation has its own, larger memory needs; this choice alone does not guarantee a full swap will fit.</p>
      <p className="hint">Gemma needs a version with vision support. Alternative models can change prompt quality and how reliably people are matched; Openjutsu’s workflows default to Qwen3-VL 8B.</p>
    </section>

    <footer className="welcome-actions">
      <div><strong>Your choice stays in this browser.</strong><p className="hint">Reopen Welcome &amp; models any time to change it.</p></div>
      <div className="row"><button className="secondary" onClick={onContinue}>Set up later</button>
        <button className="primary" disabled={loading || !installed} onClick={onContinue}>Continue to Openjutsu →</button></div>
    </footer>
  </main>;
}
