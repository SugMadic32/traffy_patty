/* Complaint translator page: NLLB-200 in a Web Worker + our Linear SVM text model (assets/text_model.json). */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LANGS = [
    ["tha_Thai", "Thai"], ["eng_Latn", "English"], ["mya_Mymr", "Burmese"], ["shn_Mymr", "Shan"],
    ["zho_Hans", "Chinese (Simplified)"], ["zho_Hant", "Chinese (Traditional)"], ["jpn_Jpan", "Japanese"], ["kor_Hang", "Korean"],
    ["lao_Laoo", "Lao"], ["khm_Khmr", "Khmer"], ["vie_Latn", "Vietnamese"], ["zsm_Latn", "Malay"], ["ind_Latn", "Indonesian"],
    ["tgl_Latn", "Filipino (Tagalog)"], ["hin_Deva", "Hindi"], ["ben_Beng", "Bengali"], ["npi_Deva", "Nepali"], ["tam_Taml", "Tamil"],
    ["urd_Arab", "Urdu"], ["arb_Arab", "Arabic"], ["pes_Arab", "Persian"], ["tur_Latn", "Turkish"], ["rus_Cyrl", "Russian"],
    ["ukr_Cyrl", "Ukrainian"], ["fra_Latn", "French"], ["deu_Latn", "German"], ["spa_Latn", "Spanish"], ["por_Latn", "Portuguese"],
    ["ita_Latn", "Italian"], ["nld_Latn", "Dutch"]
  ];
  const NAME = Object.fromEntries(LANGS);
  const EX = [
    ["Thai · street light", "tha_Thai", "ไฟส่องสว่างในซอยดับมาหลายวันแล้ว ตอนกลางคืนมืดมาก เดินผ่านแล้วรู้สึกไม่ปลอดภัย ช่วยมาซ่อมด้วยครับ"],
    ["Thai · road", "tha_Thai", "ถนนหน้าตลาดเป็นหลุมใหญ่ รถมอเตอร์ไซค์ล้มบ่อยมาก ช่วยซ่อมด่วนค่ะ"],
    ["Thai · flooding", "tha_Thai", "ฝนตกแล้วน้ำท่วมขังในซอย ท่อระบายน้ำอุดตัน น้ำขังนานสองวัน"],
    ["Burmese · road", "mya_Mymr", "လမ်းပေါ်မှာ ကျင်းကြီးတစ်ခု ရှိနေပါတယ်။ ညဘက်မှာ ဆိုင်ကယ်တွေ လဲကျနေပါတယ်။ ပြင်ပေးပါ။"],
    ["English · sidewalk", "eng_Latn", "The footpath near the BTS station is broken and people trip over it at night."]
  ];

  /* ---------- detect the language by its script ---------- */
  function detect(t) {
    const s = t.replace(/[\s\d\p{P}\p{S}]/gu, "");
    if (!s) return null;
    const tests = [[/[฀-๿]/g, "tha_Thai"], [/[က-႟]/g, "mya_Mymr"], [/[຀-໿]/g, "lao_Laoo"],
      [/[ក-៿]/g, "khm_Khmr"], [/[぀-ヿ]/g, "jpn_Jpan"], [/[가-힯]/g, "kor_Hang"],
      [/[一-鿿]/g, "zho_Hans"], [/[؀-ۿ]/g, "arb_Arab"], [/[ऀ-ॿ]/g, "hin_Deva"],
      [/[ঀ-৿]/g, "ben_Beng"], [/[஀-௿]/g, "tam_Taml"], [/[Ѐ-ӿ]/g, "rus_Cyrl"]];
    let best = null, n = 0;
    for (const [re, code] of tests) { const m = (s.match(re) || []).length; if (m > n) { n = m; best = code; } }
    if (best === "jpn_Jpan" || (best === "zho_Hans" && /[぀-ヿ]/.test(s))) return "jpn_Jpan";
    if (best && n / s.length > .3) return best;
    return /[a-z]/i.test(s) ? "eng_Latn" : null;
  }

  /* ---------- split long text into pieces the model can handle ---------- */
  const MAXC = 220;
  function split(text) {
    const parts = [];   // [piece, joiner]
    text.split(/\n/).forEach((para, pi, arr) => {
      const end = pi < arr.length - 1 ? "\n" : "";
      if (!para.trim()) { parts.push(["", end]); return; }
      const sents = para.match(/[^.!?。！？။]+[.!?。！？။]*\s*/g) || [para];
      let buf = "";
      const flush = j => { if (buf) { parts.push([buf.trim(), j]); buf = ""; } };
      sents.forEach(se => {
        if ((buf + se).length <= MAXC) { buf += se; return; }
        flush(" ");
        if (se.length <= MAXC) { buf = se; return; }
        se.split(/(\s+)/).forEach(w => { if ((buf + w).length > MAXC) flush(" "); buf += w; });
      });
      flush(end);
      if (parts.length && end) parts[parts.length - 1][1] = end;
    });
    return parts;
  }
  const join = (parts, out) => parts.map((p, i) => (p[0] ? out[i] : "") + p[1]).join("").replace(/ +\n/g, "\n").trim();

  /* ---------- worker ---------- */
  let worker = null, ready = false, reqId = 0;
  const waiting = new Map(), files = {};
  function getWorker() {
    if (worker) return worker;
    try { worker = new Worker("assets/translate-worker.js", { type: "module" }); }
    catch (e) { setStat("err", "This browser cannot run the translator", "Please use a recent Chrome, Edge, Firefox or Safari."); return null; }
    worker.onerror = () => setStat("err", "The translator could not start", "Check your internet connection (the model loads from Hugging Face) and reload the page.");
    worker.onmessage = ({ data: d }) => {
      if (d.kind === "progress") {
        if (d.status === "progress" && d.file) { files[d.file] = [d.loaded, d.total]; }
        const v = Object.values(files), L = v.reduce((a, x) => a + x[0], 0), T = v.reduce((a, x) => a + x[1], 0);
        if (T) { $("mBar").hidden = false; $("mFill").style.width = (L / T * 100).toFixed(1) + "%";
          setStat("", "Downloading the translation model…", `${(L / 1e6).toFixed(0)} of ${(T / 1e6).toFixed(0)} MB · only the first time`); }
        if (d.status === "ready" || d.status === "done") {}
      } else if (d.kind === "ready") {
        ready = true; $("mBar").hidden = true;
        setStat("ready", "Translation model ready", "Saved in your browser. Next time it opens without downloading.");
        $("loadBtn").hidden = true;
      } else if (d.kind === "error" && d.id == null) {
        setStat("err", "Could not load the model", d.message + " · check your connection and try again."); $("loadBtn").hidden = false; $("loadBtn").disabled = false;
      } else {
        const w = waiting.get(d.id); if (!w) return;
        if (d.kind === "partial") w.onPart && w.onPart(d.done, d.total);
        else { waiting.delete(d.id); d.kind === "result" ? w.ok(d.text) : d.kind === "stopped" ? w.ok(null) : w.no(new Error(d.message)); }
      }
    };
    return worker;
  }
  function setStat(cls, title, sub) { const b = $("mStat"); b.className = "mstat card " + cls; $("mTitle").textContent = title; $("mSub").textContent = sub; }
  function loadModel() { const w = getWorker(); if (!w) return; $("loadBtn").disabled = true; if (!ready) setStat("", "Starting the translator…", "Getting the model files ready."); w.postMessage({ kind: "load" }); }
  function translateChunks(chunks, src, tgt, onPart) {
    const w = getWorker(); if (!w) throw new Error("this browser cannot run the translator");
    const id = ++reqId;
    return { id, p: new Promise((ok, no) => { waiting.set(id, { ok, no, onPart }); w.postMessage({ kind: "translate", id, chunks, src, tgt }); }) };
  }
  async function translateText(text, src, tgt, onPart) {
    if (src === tgt) return text;
    const parts = split(text), r = translateChunks(parts.map(p => p[0]), src, tgt, onPart);
    const out = await r.p; return out ? join(parts, out) : null;
  }

  /* ---------- our text model ---------- */
  let tm = null, tmTried = false;
  async function textModel() {
    if (tm || tmTried) return tm; tmTried = true;
    try { const r = await fetch("assets/text_model.json"); if (!r.ok) throw 0; tm = new window.TextModel(await r.json()); }
    catch (e) { tm = null; }
    return tm;
  }
  function showTypes(res, how) {
    const box = $("ptBox");
    if (!res) { box.innerHTML = '<p class="note">The problem-type model is not on this site yet (it comes from the final notebook run).</p>'; return; }
    const top = res.slice(0, 6), mx = Math.max(1, ...top.map(r => Math.abs(r.score))), yes = res.filter(r => r.yes);
    box.innerHTML = `<p class="note">${how}${yes.length ? ` · <b style="color:var(--text)">${yes.map(r => esc(r.type)).join(", ")}</b>` : " · no clear type (all scores below 0)"}</p>` +
      top.map(r => `<div class="pt ${r.yes ? "yes" : ""}"><span>${esc(r.type)}</span><i style="--w:${Math.max(.03, (r.score + mx) / (2 * mx)).toFixed(3)}"></i><em>${r.yes ? "yes" : "no"} · ${r.score.toFixed(2)}</em></div>`).join("") +
      '<p class="note">Score above 0 = the model says yes. Further from 0 = more sure.</p>';
  }

  /* ---------- one complaint ---------- */
  function fillSelect(sel, withDetect, val) {
    sel.innerHTML = (withDetect ? '<option value="auto">Detect language</option>' : "") + LANGS.map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join("");
    sel.value = val;
  }
  function srcCode() { return $("srcLang").value === "auto" ? detect($("srcText").value) : $("srcLang").value; }
  function updateDetect() {
    const t = $("srcText").value; $("charNote").textContent = t.length.toLocaleString("en-US") + " characters";
    if ($("srcLang").value === "auto") { const d = detect(t); $("detNote").textContent = t.trim() ? (d ? "Detected: " + NAME[d] : "Could not detect, pick the language") : ""; }
    else $("detNote").textContent = "";
  }
  async function go() {
    const text = $("srcText").value.trim(), src = srcCode(), tgt = $("tgtLang").value;
    if (!text) { $("outText").innerHTML = '<span class="note">Type or paste a complaint first.</span>'; return; }
    if (!src) { $("outText").innerHTML = '<span class="note">Pick the "From" language.</span>'; return; }
    $("outLang").textContent = NAME[tgt];
    const t0 = performance.now(); $("goBtn").disabled = true;
    if (!ready) loadModel();
    $("outText").innerHTML = `<span class="note">${ready ? "Translating…" : "Loading the model first, then translating…"}</span>`;
    let out = null;
    try {
      out = await translateText(text, src, tgt, (d, n) => { $("outText").innerHTML = `<span class="note">Translating piece ${d} of ${n}…</span>`; });
      $("outText").textContent = out;
      $("timeNote").textContent = src === tgt ? "Same language, nothing to translate." : `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${NAME[src]} → ${NAME[tgt]}`;
    } catch (e) { $("outText").innerHTML = `<span class="note">Translation failed: ${esc(e.message)}</span>`; }
    $("goBtn").disabled = false;
    // problem type from the Thai text
    const m = await textModel(); if (!m) { showTypes(null); return; }
    if (src === "tha_Thai") showTypes(m.predict(text), "Read from your Thai text");
    else if (tgt === "tha_Thai" && out) showTypes(m.predict(out), "Read from the Thai translation");
    else {
      $("ptBox").innerHTML = '<p class="note">Translating to Thai for the model…</p>';
      try { const th = await translateText(text, src, "tha_Thai"); showTypes(m.predict(th), "Read from a Thai translation of your text"); }
      catch (e) { $("ptBox").innerHTML = '<p class="note">Could not make the Thai version for the model.</p>'; }
    }
  }

  /* ---------- CSV (handles quotes, commas and new lines inside quotes) ---------- */
  function parseCSV(text) {
    const rows = []; let row = [], f = "", q = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(x => x !== ""));
  }
  const csvCell = v => { v = v == null ? "" : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  let csv = null, outRows = null, curBatch = null;
  function onFile(file) {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      const rows = parseCSV(String(rd.result));
      if (rows.length < 2) { $("csvNote").textContent = "This file has no rows."; return; }
      csv = { head: rows[0], rows: rows.slice(1) }; outRows = null; $("bDl").disabled = true;
      $("csvNote").textContent = `${file.name}: ${csv.rows.length.toLocaleString("en-US")} rows, ${csv.head.length} columns`;
      $("colSel").innerHTML = csv.head.map((h, i) => `<option value="${i}">${esc(h)}</option>`).join("");
      const guess = csv.head.findIndex(h => /comment|text|message|complaint/i.test(h)); if (guess >= 0) $("colSel").value = guess;
      $("bMax").value = Math.min(50, csv.rows.length); $("bMax").max = csv.rows.length;
      $("bOpts").hidden = false; preview(csv.head, csv.rows.slice(0, 10));
    };
    rd.readAsText(file, "utf-8");
  }
  function preview(head, rows) {
    $("bTblWrap").hidden = false;
    $("bHead").innerHTML = "<tr>" + head.map(h => `<th>${esc(h)}</th>`).join("") + "</tr>";
    $("bBody").innerHTML = rows.map(r => "<tr>" + head.map((_, i) => `<td>${esc(r[i])}</td>`).join("") + "</tr>").join("");
  }
  async function runBatch() {
    if (!csv) return;
    const col = +$("colSel").value, src = $("bSrc").value, tgt = $("bTgt").value, n = Math.max(1, Math.min(+$("bMax").value || 1, csv.rows.length));
    if (!ready) loadModel();
    const m = await textModel();
    const newCol = csv.head[col] + "_" + NAME[tgt].split(" ")[0].toLowerCase();
    const head = csv.head.concat([newCol]).concat(m ? ["problem_types_model"] : []);
    outRows = []; $("bGo").disabled = true; $("bStop").hidden = false; $("bBar").hidden = false; curBatch = { stop: false };
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      if (curBatch.stop) break;
      const r = csv.rows[i], text = (r[col] || "").trim();
      const s = src === "auto" ? (detect(text) || "tha_Thai") : src;
      let tr = "";
      try { tr = text ? await translateText(text, s, tgt) : ""; } catch (e) { tr = "[error: " + e.message + "]"; }
      let types = [];
      if (m && text) { const th = s === "tha_Thai" ? text : tgt === "tha_Thai" ? tr : null; if (th) types = m.predict(th).filter(x => x.yes).map(x => x.type); }
      outRows.push(r.slice(0, csv.head.length).concat([tr]).concat(m ? [types.join(", ")] : []));
      const el = (performance.now() - t0) / 1000, left = el / (i + 1) * (n - i - 1);
      $("bFill").style.width = ((i + 1) / n * 100).toFixed(1) + "%";
      $("bNote").textContent = `${i + 1} of ${n} rows · about ${left < 90 ? Math.ceil(left) + " s" : Math.ceil(left / 60) + " min"} left`;
      if (i < 20 || i === n - 1) preview(head, outRows.slice(0, 20));
    }
    $("bNote").textContent = `${outRows.length} rows translated${curBatch.stop ? " (stopped)" : ""}. Showing the first 20.${m ? "" : " Problem types need the model file from the final notebook."}`;
    $("bGo").disabled = false; $("bStop").hidden = true; $("bDl").disabled = !outRows.length;
    $("bDl").onclick = () => {
      const body = [head].concat(outRows).map(r => r.map(csvCell).join(",")).join("\r\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }));
      a.download = "translated_" + NAME[tgt].split(" ")[0].toLowerCase() + ".csv"; document.body.appendChild(a); a.click(); a.remove();
    };
  }

  /* ---------- wire up ---------- */
  fillSelect($("srcLang"), true, "auto"); fillSelect($("tgtLang"), false, "eng_Latn");
  fillSelect($("bSrc"), true, "auto"); fillSelect($("bTgt"), false, "eng_Latn");
  $("exChips").innerHTML = EX.map((e, i) => `<button type="button" data-i="${i}" aria-pressed="false">${esc(e[0])}</button>`).join("");
  $("exChips").querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    const e = EX[+b.dataset.i]; $("srcText").value = e[2]; $("srcLang").value = "auto";
    $("tgtLang").value = e[1] === "eng_Latn" ? "tha_Thai" : "eng_Latn"; updateDetect();
  }));
  $("srcText").addEventListener("input", updateDetect); $("srcLang").addEventListener("change", updateDetect);
  $("srcText").addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") go(); });
  $("swapBtn").addEventListener("click", () => {
    const s = srcCode() || "tha_Thai", t = $("tgtLang").value, out = $("outText").textContent;
    $("srcLang").value = t; $("tgtLang").value = s;
    if (out && !$("outText").querySelector(".note")) { $("srcText").value = out; $("outText").innerHTML = '<span class="note">The translation shows here.</span>'; }
    updateDetect();
  });
  $("copyBtn").addEventListener("click", async () => {
    if ($("outText").querySelector(".note")) return;
    try { await navigator.clipboard.writeText($("outText").textContent); $("copyBtn").title = "Copied"; setTimeout(() => $("copyBtn").title = "Copy", 1500); } catch (e) {}
  });
  $("loadBtn").addEventListener("click", loadModel);
  $("goBtn").addEventListener("click", go);
  $("csvIn").addEventListener("change", e => onFile(e.target.files[0]));
  $("bGo").addEventListener("click", runBatch);
  $("bStop").addEventListener("click", () => { if (curBatch) curBatch.stop = true; });
  // the model is already in this browser's cache? then start it quietly
  if ("caches" in window) caches.keys().then(k => { if (k.some(n => /transformers/i.test(n))) loadModel(); }).catch(() => {});
  textModel().then(m => { if (!m) showTypes(null); else $("ptBox").innerHTML = '<p class="note">Translate a complaint to see its problem type.</p>'; });
})();
