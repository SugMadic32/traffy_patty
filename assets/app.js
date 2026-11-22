/* Traffy Fondue monitoring app. Reads assets/app_data.json (made by section 17 of the final notebook). */
(function () {
  "use strict";
  const AMBER = "#FFC23D", BLUE = "#4dabf7", GREEN = "#3CCB8A", RED = "#FF4747", ORANGE = "#FF8A3D", GREY = "#9AA3BD";
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = n => n == null || isNaN(n) ? "–" : Number(n).toLocaleString("en-US");
  const st = { type: "All", season: "All", band: "All", color: "count", sel: null };
  let A, map, dLayer, giLayer, dbLayer, markers = {};

  fetch("assets/app_data.json?v=" + (window.SITE_V || "1")).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => { A = d; init(); })
    .catch(() => {
      $("appStat").innerHTML = "<b>App data not found.</b> Run the final notebook and add <code>app_data.json</code> to the assets folder.";
    });

  /* ---------- counts from the cube: cube[type][season][band] ---------- */
  function count(d, type, season, band) {
    const ts = type === "All" ? A.types : [type];
    const si = season === "All" ? [0, 1, 2] : [A.seasons.indexOf(season)];
    const bi = band === "All" ? [0, 1, 2, 3] : [A.bands.indexOf(band)];
    let n = 0;
    ts.forEach(t => { const c = d.cube[t]; if (!c) return; si.forEach(s => bi.forEach(b => { n += c[s][b]; })); });
    return n;
  }
  const cur = d => count(d, st.type, st.season, st.band);
  const change = d => d.forecast == null || !d.lastWeek ? null : (d.forecast - d.lastWeek) / d.lastWeek;

  function init() {
    $("appStat").innerHTML = `Data <b>${esc(A.dataStart)}</b> to <b>${esc(A.dataEnd)}</b> · <b>${fmt(A.rows)}</b> complaints · ` +
      `<b>${fmt(A.modelFilled)}</b> empty types filled by our text model · updated ${esc(A.updated)}`;
    chips("fType", ["All"].concat(A.types), "type");
    chips("fSeason", ["All"].concat(A.seasons), "season");
    chips("fBand", ["All"].concat(A.bands), "band");
    document.querySelectorAll("#fColor button").forEach(b => b.addEventListener("click", () => {
      st.color = b.dataset.v; press("#fColor", b); paint();
    }));
    initMap();
    $("lGi").addEventListener("change", layers); $("lDb").addEventListener("change", layers);
    paint(); priority(); forecast(); rules(); reader();
  }
  function press(sel, el) { document.querySelectorAll(sel + " button").forEach(b => b.setAttribute("aria-pressed", b === el)); }
  function chips(id, vals, key) {
    const box = $(id);
    box.innerHTML = vals.map(v => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === st[key]}">${esc(v)}</button>`).join("");
    box.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      st[key] = b.dataset.v; press("#" + id, b); paint(); if (key === "type") { priority(); rules(); }
    }));
  }

  /* ---------- map ---------- */
  function initMap() {
    if (!window.L) { $("amap").innerHTML = '<div class="mapfail">The map library did not load. The list, priority, forecast and reader below still work.</div>'; return; }
    map = L.map("amap", { zoomControl: true, scrollWheelZoom: false, attributionControl: true }).setView([13.76, 100.58], 11);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 16, attribution: "Tiles &copy; Esri" }).addTo(map);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 16, opacity: .6 }).addTo(map);
    giLayer = L.layerGroup().addTo(map); dbLayer = L.layerGroup(); dLayer = L.layerGroup().addTo(map);
    A.districts.forEach(d => {
      if (d.lat == null) return;
      const m = L.circleMarker([d.lat, d.lon], { radius: 8, weight: 1.5, color: "#0E1324", fillOpacity: .85 })
        .on("click", () => select(d.name))
        .bindTooltip("", { className: "dtip", direction: "top", offset: [0, -6] });
      m.addTo(dLayer); markers[d.name] = m;
    });
    const pts = A.districts.filter(d => d.lat != null).map(d => [d.lat, d.lon]);
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
  }
  function ramp(t, kind) {
    t = Math.max(0, Math.min(1, t));
    if (kind === "change") { // -1..1 mapped to green..grey..red
      return t < .5 ? mix([60, 203, 138], [110, 120, 150], t * 2) : mix([110, 120, 150], [255, 71, 71], (t - .5) * 2);
    }
    if (kind === "priority") return t < .5 ? mix([60, 203, 138], [255, 194, 61], t * 2) : mix([255, 194, 61], [255, 71, 71], (t - .5) * 2);
    return mix([90, 70, 40], [255, 194, 61], Math.sqrt(t));
  }
  function mix(a, b, t) { return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`; }

  function layers() {
    if (!map) return;
    giLayer.clearLayers(); dbLayer.clearLayers();
    const want = st.type === "All" ? null : st.type;
    if ($("lGi").checked) {
      const cells = A.gistar.filter(g => !want || g.type === want);
      cells.forEach(g => {
        const h = .005;
        L.rectangle([[g.lat - h, g.lon - h], [g.lat + h, g.lon + h]], {
          weight: 0, fillColor: g.type === "Flooding" ? BLUE : ORANGE, fillOpacity: g.confidence === "99%" ? .45 : .22, interactive: true
        }).bindTooltip(`${esc(g.type)} hot cell · ${esc(g.district || "?")}<br>${g.complaints} complaints · z = ${g.z} (${g.confidence})`, { className: "dtip" })
          .addTo(giLayer);
      });
    }
    if ($("lDb").checked) {
      A.hotspots.filter(h => !want || h.type === want).forEach(h => {
        L.circleMarker([h.lat, h.lon], { radius: 3 + Math.sqrt(h.complaints) / 2, color: h.type === "Flooding" ? BLUE : ORANGE, weight: 2, fill: false })
          .bindTooltip(`${esc(h.type)} hotspot · ${esc(h.district)}<br>${h.complaints} complaints · median fix ${h.median_fix_days == null ? "n/a" : h.median_fix_days.toFixed(1) + " days"}`, { className: "dtip" })
          .addTo(dbLayer);
      });
      dbLayer.addTo(map);
    } else map.removeLayer(dbLayer);
  }

  /* ---------- paint map + ranking + summary ---------- */
  function paint() {
    const rows = A.districts.map(d => ({ d, n: cur(d) })).sort((a, b) => b.n - a.n);
    const max = Math.max(1, ...rows.map(r => r.n)), tot = rows.reduce((a, r) => a + r.n, 0);
    const pr = A.districts.map(d => d.priority).filter(v => v != null), pmin = Math.min(...pr), pmax = Math.max(...pr);
    rows.forEach(({ d, n }) => {
      const m = markers[d.name]; if (!m) return;
      let col, t;
      if (st.color === "priority") { t = d.priority == null ? 0 : (d.priority - pmin) / Math.max(1e-9, pmax - pmin); col = ramp(t, "priority"); }
      else if (st.color === "change") { const c = change(d); t = c == null ? .5 : .5 + Math.max(-.5, Math.min(.5, c)); col = ramp(t, "change"); }
      else { col = ramp(n / max, "count"); }
      m.setStyle({ fillColor: col, color: st.sel === d.name ? "#F1F2F5" : "#0E1324", weight: st.sel === d.name ? 3 : 1.5 });
      m.setRadius(5 + 22 * Math.sqrt(n / max));
      const c = change(d);
      m.setTooltipContent(`<b>${esc(d.name)}</b><br>${fmt(n)} ${label()}` +
        (d.priority != null ? `<br>Priority ${d.priority}` : "") +
        (d.forecast != null ? `<br>Next week ${fmt(d.forecast)} (last ${fmt(d.lastWeek)}${c == null ? "" : ", " + (c >= 0 ? "+" : "") + Math.round(c * 100) + "%"})` : ""));
    });
    if (st.sel && markers[st.sel]) markers[st.sel].bringToFront();
    legend();
    layers();
    $("sTotal").textContent = fmt(tot); $("sTotalLab").textContent = label();
    $("sTop").textContent = rows[0] && rows[0].n ? rows[0].d.name : "–";
    $("sTop5").textContent = tot ? Math.round(rows.slice(0, 5).reduce((a, r) => a + r.n, 0) / tot * 100) + "%" : "–";
    $("dRank").innerHTML = rows.slice(0, 50).map((r, i) =>
      `<li data-d="${esc(r.d.name)}" class="${st.sel === r.d.name ? "on" : ""}" tabindex="0"><span class="n">${i + 1}</span><span class="nm">${esc(r.d.name)}<i style="--w:${(r.n / max).toFixed(3)}"></i></span><span class="v">${fmt(r.n)}</span></li>`).join("");
    $("dRank").querySelectorAll("li").forEach(li => {
      li.addEventListener("click", () => select(li.dataset.d));
      li.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(li.dataset.d); } });
    });
    if (st.sel) detail();
  }
  function label() {
    const parts = [st.type === "All" ? "type labels" : st.type + " complaints"];
    if (st.season !== "All") parts.push(st.season.toLowerCase() + " season");
    if (st.band !== "All") parts.push(st.band.split(" ")[0].toLowerCase());
    return parts.join(", ");
  }
  function legend() {
    const L_ = $("mLegend");
    const g = st.color === "priority" ? `linear-gradient(90deg,${GREEN},${AMBER},${RED})`
      : st.color === "change" ? `linear-gradient(90deg,${GREEN},#6E7896,${RED})` : `linear-gradient(90deg,rgb(90,70,40),${AMBER})`;
    const ends = st.color === "priority" ? ["Lower priority", "Higher"] : st.color === "change" ? ["Fewer next week", "More"] : ["Fewer", "More complaints"];
    L_.innerHTML = `<span>Circle size = ${esc(label())}</span><div class="ramp" style="background:${g}"></div><div class="ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>` +
      `<span><i style="display:inline-block;width:10px;height:10px;background:${ORANGE};opacity:.6"></i> Road &nbsp;<i style="display:inline-block;width:10px;height:10px;background:${BLUE};opacity:.6"></i> Flooding hot cells (Gi*)</span>`;
  }

  /* ---------- district detail ---------- */
  function select(name) {
    st.sel = name; paint();
    if (map && markers[name]) map.panTo(markers[name].getLatLng(), { animate: true });
    $("detail").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  }
  function detail() {
    const d = A.districts.find(x => x.name === st.sel); if (!d) return;
    const n = cur(d), c = change(d);
    const mixRows = A.types.map(t => ({ t, n: count(d, t, st.season, st.band) })).sort((a, b) => b.n - a.n);
    const mmax = Math.max(1, ...mixRows.map(r => r.n)), msum = mixRows.reduce((a, r) => a + r.n, 0);
    const t = st.type, grid = A.seasons.map(s => A.bands.map(b => count(d, t, s, b)));
    const gmax = Math.max(1, ...grid.flat());
    $("detail").innerHTML = `<div class="dhead"><h3>${esc(d.name)}</h3><span>${fmt(d.total)} complaints in all data · ${esc(label())}: ${fmt(n)}</span></div>
      <div class="dstats">
        <div><b>${d.medianFix == null ? "–" : d.medianFix.toFixed(1)}</b><span>median fixing days</span></div>
        <div><b>${d.unfinished == null ? "–" : d.unfinished.toFixed(1) + "%"}</b><span>not finished</span></div>
        <div><b>${d.priority == null ? "–" : d.priority}</b><span>priority score (0–100)</span></div>
        <div><b>${fmt(d.lastWeek)}</b><span>complaints last week</span></div>
        <div><b class="${c == null ? "" : c > 0 ? "up" : "down"}">${fmt(d.forecast)}</b><span>forecast next week${c == null ? "" : " (" + (c >= 0 ? "+" : "") + Math.round(c * 100) + "%)"}</span></div>
      </div>
      <div class="dgrid">
        <div><h4>Problem mix</h4><p class="note">${esc(st.season === "All" ? "All seasons" : st.season + " season")}, ${esc(st.band === "All" ? "all hours" : st.band)}.</p>
          <div class="tmix">${mixRows.map(r => `<div class="${r.t === st.type ? "sel" : ""}"><span>${esc(r.t)}</span><i style="--w:${(r.n / mmax).toFixed(3)}"></i><em>${msum ? Math.round(r.n / msum * 100) : 0}%</em></div>`).join("")}</div></div>
        <div><h4>Season × time of day</h4><p class="note">${esc(t === "All" ? "All types" : t)}. Darker = more.</p>
          <div class="sbgrid"><span></span>${A.bands.map(b => `<span style="justify-content:center">${esc(b.split(" ")[0])}</span>`).join("")}
          ${A.seasons.map((s, si) => `<span>${esc(s)}</span>` + A.bands.map((b, bi) => { const v = grid[si][bi], k = v / gmax;
            return `<span class="c" title="${esc(s)}, ${esc(b)}: ${fmt(v)}" style="background:rgba(255,194,61,${(.08 + .92 * k).toFixed(2)});color:${k > .45 ? "#0E1324" : "#F1F2F5"}">${fmt(v)}</span>`; }).join("")).join("")}</div></div>
      </div>`;
  }

  /* ---------- priority list ---------- */
  function priority() {
    const all = A.priority || [];
    const rows = (st.type === "All" ? all : all.filter(r => r.type === st.type)).slice(0, 15);
    $("pBody").innerHTML = rows.length ? rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.district)}</td><td>${esc(r.type)}</td><td>${r["per month"]}</td><td>${r.median_fix_days == null ? "–" : r.median_fix_days}</td><td>${r["unfinished %"]}</td><td>${r["reopened %"]}</td><td><span class="pbar"><i style="--w:${(r.priority / 100).toFixed(3)}"></i><b>${r.priority}</b></span></td></tr>`).join("")
      : `<tr><td colspan="8">No ${esc(st.type)} pairs in the top 60. Pick another problem.</td></tr>`;
    $("pNote").textContent = st.type === "All" ? "Showing the top 15 of all district × problem pairs." : `Showing ${st.type} only (from the top 60 overall).`;
  }

  /* ---------- forecast ---------- */
  function forecast() {
    const F = A.forecast;
    if (!F || !window.Chart) { $("fcNote").textContent = "Forecast not in this run."; return; }
    const tb = F.table;
    new Chart($("fcChart"), {
      type: "bar", data: { labels: tb.map(r => r.Model), datasets: [{ data: tb.map(r => r["MAE mean"]), backgroundColor: tb.map(r => r.Model === F.model ? AMBER : "rgba(255,194,61,.35)"), borderRadius: 2, barPercentage: .7 }] },
      plugins: [{ id: "err", afterDatasetsDraw(ch) { const g = ch.ctx, x = ch.scales.x; g.save(); g.strokeStyle = "#F1F2F5"; g.lineWidth = 2;
        ch.getDatasetMeta(0).data.forEach((b, i) => { const sd = tb[i]["MAE std (over weeks)"], m = tb[i]["MAE mean"]; const a = x.getPixelForValue(m - sd), z = x.getPixelForValue(m + sd);
          g.beginPath(); g.moveTo(a, b.y); g.lineTo(z, b.y); g.moveTo(a, b.y - 5); g.lineTo(a, b.y + 5); g.moveTo(z, b.y - 5); g.lineTo(z, b.y + 5); g.stroke();
          g.fillStyle = "#F1F2F5"; g.font = "600 12px 'Chakra Petch',sans-serif"; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(`${m} ± ${sd}`, z + 8, b.y); }); g.restore(); } }],
      options: { indexAxis: "y", layout: { padding: { right: 80 } }, plugins: { legend: { display: false },
        tooltip: { callbacks: { label: c => { const r = tb[c.dataIndex]; return `MAE ${r["MAE mean"]} ± ${r["MAE std (over weeks)"]}, RMSE ${r.RMSE}, WAPE ${r["WAPE %"]}%`; } } } },
        scales: { x: { beginAtZero: true, title: { display: true, text: "MAE (complaints per district-week)" } }, y: { grid: { display: false }, ticks: { color: "#D5D9E4" } } } }
    });
    const best = tb.find(r => r.Model === F.model), naive = tb.find(r => r.Model.startsWith("Naive"));
    const gain = naive && best ? Math.round((1 - best["MAE mean"] / naive["MAE mean"]) * 100) : null;
    $("fcNote").innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/></svg><span><b>${esc(F.model)} wins</b>${gain != null && best !== naive ? `: about ${gain}% smaller error than "same as last week"` : ""}. The white whisker is ± 1 std over test weeks.</span>`;
    $("fcTitle").textContent = `Forecast for the week of ${F.week}`;
    const top = A.districts.filter(d => d.forecast != null).sort((a, b) => b.forecast - a.forecast).slice(0, 12);
    new Chart($("nwChart"), {
      data: { labels: top.map(d => d.name), datasets: [
        { type: "bar", label: "Forecast", data: top.map(d => d.forecast), backgroundColor: top.map(d => d.forecast > d.lastWeek ? "rgba(255,71,71,.75)" : "rgba(60,203,138,.75)"), borderRadius: 2, barPercentage: .7 },
        { type: "line", label: "Last week", data: top.map(d => d.lastWeek), borderColor: "#F1F2F5", pointBackgroundColor: "#F1F2F5", showLine: false, pointRadius: 5, pointStyle: "line", pointBorderWidth: 3 }] },
      options: { indexAxis: "y", plugins: { legend: { position: "top", align: "end" }, tooltip: { mode: "index", intersect: false } },
        scales: { x: { beginAtZero: true }, y: { grid: { display: false }, ticks: { color: "#D5D9E4" } } } }
    });
  }

  /* ---------- rules ---------- */
  function rules() {
    const all = A.rules || [];
    const want = st.type === "All" ? null : "type=" + st.type;
    let rs = want ? all.filter(r => r.then === want || r.if.split(" + ").includes(want)) : all;
    rs = rs.slice(0, 12);
    const lmax = Math.max(1.5, ...all.map(r => r.lift));
    const it = s => { const [k, v] = s.split("="); return `<span class="it">${esc(k)}: ${esc(v)}</span>`; };
    $("rulesBox").innerHTML = rs.length ? rs.map(r => `<div class="rule"><div class="ifs"><b>If</b>${r.if.split(" + ").map(it).join('<span>+</span>')}<b>then</b><span class="it then">${esc(r.then.split("=")[0])}: ${esc(r.then.split("=")[1])}</span></div>
      <div class="rm"><span>Lift <b>${r.lift}</b></span><span>Confidence <b>${Math.round(r.confidence * 100)}%</b></span><span>Support <b>${(r.support * 100).toFixed(1)}%</b></span><span class="lift"><i style="--w:${(r.lift / lmax).toFixed(3)}"></i></span></div></div>`).join("")
      : `<div class="empty">No strong rule for ${esc(st.type)}. Pick another problem or "All".</div>`;
  }

  /* ---------- reader ---------- */
  function reader() {
    const R = A.reader || [];
    if (!R.length) { $("rList").innerHTML = '<div class="empty">No translated complaints in this run. Run the notebook with the T4 GPU.</div>'; $("rSearch").disabled = true; return; }
    let ag = "all";
    document.querySelectorAll("#rAgree button").forEach(b => b.addEventListener("click", () => { ag = b.dataset.v; press("#rAgree", b); draw(); }));
    $("rSearch").addEventListener("input", draw);
    function draw() {
      const q = $("rSearch").value.trim().toLowerCase();
      const rs = R.filter(r => (ag === "all" || (ag === "yes") === r.a) && (!q || (r.t || "").toLowerCase().includes(q)));
      $("rCount").textContent = `${rs.length} of ${R.length} complaints`;
      const hl = s => { const e = esc(s); if (!q) return e; const i = e.toLowerCase().indexOf(esc(q)); return i < 0 ? e : e.slice(0, i) + "<mark>" + e.slice(i, i + esc(q).length) + "</mark>" + e.slice(i + esc(q).length); };
      $("rList").innerHTML = rs.slice(0, 40).map(r => `<div class="rc"><span class="ag ${r.a ? "y" : "n"}">${r.a ? "Model agrees" : "Model disagrees"}</span><p>${hl(r.t)}</p>
        <div class="tg"><span>District <b>${esc(r.d)}</b></span><span>Resident chose <b>${esc(r.u)}</b></span><span>Model reads <b>${esc(r.m)}</b></span></div></div>`).join("") || '<div class="empty">No match.</div>';
    }
    draw();
  }
})();
