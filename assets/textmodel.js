/* Our Linear SVM text model in the browser. Same steps as scikit-learn:
   lowercase -> char_wb n-grams (2-4) -> sublinear TF x IDF -> L2 normalise -> w.x + b per type. */
(function (root) {
  function TextModel(m) {
    this.m = m; this.index = new Map();
    for (let i = 0; i < m.ngrams.length; i++) this.index.set(m.ngrams[i], i);
  }
  TextModel.prototype.features = function (text) {
    const [lo, hi] = this.m.ngram, counts = new Map();
    const words = String(text).toLowerCase().replace(/\s\s+/g, " ").split(/\s+/).filter(Boolean);
    for (const w0 of words) {
      const w = Array.from(" " + w0 + " "), L = w.length;
      for (let n = lo; n <= hi; n++) {
        let off = 0;
        const add = g => { const i = this.index.get(g); if (i !== undefined) counts.set(i, (counts.get(i) || 0) + 1); };
        add(w.slice(off, off + n).join(""));
        while (off + n < L) { off++; add(w.slice(off, off + n).join("")); }
        if (off === 0) break;              // short word: counted once (as scikit-learn does)
      }
    }
    let norm = 0; const f = [];
    counts.forEach((c, i) => { const v = (1 + Math.log(c)) * this.m.idf[i]; f.push([i, v]); norm += v * v; });
    norm = Math.sqrt(norm) || 1;
    return f.map(([i, v]) => [i, v / norm]);
  };
  TextModel.prototype.predict = function (text) {
    const f = this.features(text), out = [];
    this.m.labels.forEach((lab, j) => {
      const w = this.m.coef[j]; let s = this.m.b[j];
      for (const [i, v] of f) s += w[i] * v;
      out.push({ type: lab, score: s, yes: s > 0 });
    });
    return out.sort((a, b) => b.score - a.score);
  };
  root.TextModel = TextModel;
  if (typeof module !== "undefined") module.exports = TextModel;
})(typeof window !== "undefined" ? window : globalThis);
