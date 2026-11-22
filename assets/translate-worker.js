/* Runs NLLB-200 (Meta, 200 languages) inside the browser with transformers.js. No server: text never leaves the device. */
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";
env.allowLocalModels = false;
const MODEL = "Xenova/nllb-200-distilled-600M";
let loading = null, stopId = null;

function load() {
  if (!loading) {
    loading = pipeline("translation", MODEL, {
      dtype: "q8",
      progress_callback: p => postMessage({ kind: "progress", status: p.status, file: p.file || "", loaded: p.loaded || 0, total: p.total || 0, progress: p.progress || 0 })
    }).then(t => { postMessage({ kind: "ready" }); return t; })
      .catch(e => { loading = null; postMessage({ kind: "error", message: String((e && e.message) || e) }); throw e; });
  }
  return loading;
}

self.onmessage = async ({ data }) => {
  if (data.kind === "load") { load().catch(() => {}); return; }
  if (data.kind === "stop") { stopId = data.id; return; }
  if (data.kind === "translate") {
    try {
      const tr = await load(), out = [];
      for (let i = 0; i < data.chunks.length; i++) {
        if (stopId === data.id) { postMessage({ kind: "stopped", id: data.id }); return; }
        const c = data.chunks[i];
        if (!c.trim()) { out.push(c); continue; }
        const r = await tr(c, { src_lang: data.src, tgt_lang: data.tgt, max_new_tokens: 400 });
        out.push(r[0].translation_text);
        postMessage({ kind: "partial", id: data.id, done: i + 1, total: data.chunks.length });
      }
      postMessage({ kind: "result", id: data.id, text: out });
    } catch (e) {
      postMessage({ kind: "error", id: data.id, message: String((e && e.message) || e) });
    }
  }
};
