/* Shared script for all sub-pages: progress bar, file viewer, chart defaults */
(function(){
  const meter=document.getElementById("meter");
  if(meter) addEventListener("scroll",()=>{const d=document.documentElement;meter.style.width=(scrollY/Math.max(1,d.scrollHeight-innerHeight))*100+"%"},{passive:true});
  // file viewer markup (same as the home page)
  if(!document.getElementById("viewer")) document.body.insertAdjacentHTML("beforeend",`<div class="viewer" id="viewer" hidden>
  <div class="v-back" data-close></div>
  <div class="v-panel" role="dialog" aria-modal="true" aria-labelledby="vTitle">
    <header class="v-head">
      <div class="v-name"><small id="vKind">PDF</small><b id="vTitle">File</b></div>
      <div class="v-acts">
        <a class="v-btn" id="vOpen" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg><span>New tab</span></a>
        <a class="v-btn" id="vDown" download><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg><span>Download</span></a>
        <button class="v-x" type="button" data-close aria-label="Close the file viewer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
    </header>
    <div class="v-body" id="vBody"></div>
  </div>
</div>`);
  // reveal-on-scroll for funnels and other animated blocks
  const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("go");io.unobserve(e.target)}}),{threshold:.2});
  document.querySelectorAll(".funnel,[data-reveal]").forEach(el=>io.observe(el));
  // Chart.js theme
  if(window.Chart){
    Chart.defaults.color="#9AA3BD";Chart.defaults.borderColor="rgba(255,255,255,.08)";
    Chart.defaults.font.family="'IBM Plex Sans',system-ui,sans-serif";Chart.defaults.font.size=12;
    Chart.defaults.plugins.legend.labels.boxWidth=12;Chart.defaults.maintainAspectRatio=false;
    Chart.defaults.plugins.tooltip.backgroundColor="rgba(14,19,36,.95)";Chart.defaults.plugins.tooltip.borderColor="#2A3354";Chart.defaults.plugins.tooltip.borderWidth=1;
  }
})();
/* ---------- file viewer ---------- */
(function(){
  const V=document.getElementById("viewer"),body=document.getElementById("vBody"),title=document.getElementById("vTitle"),kind=document.getElementById("vKind"),
        openA=document.getElementById("vOpen"),downA=document.getElementById("vDown");
  let lastFocus=null;
  const PREVIEWS={"proposal-m2.pdf":["previews/proposal-m2-1.jpg"],"proposal.pdf":["previews/proposal-1.jpg","previews/proposal-2.jpg"]};
  function parseCSV(t){const rows=[];let row=[],f="",q=false;
    for(let i=0;i<t.length;i++){const c=t[i];
      if(q){if(c==='"'){if(t[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
      else if(c==='"')q=true;else if(c===","){row.push(f);f=""}
      else if(c==="\n"||c==="\r"){if(c==="\r"&&t[i+1]==="\n")i++;row.push(f);f="";if(row.length>1||row[0]!=="")rows.push(row);row=[]}
      else f+=c}
    if(f!==""||row.length){row.push(f);rows.push(row)}return rows}
  const esc=x=>String(x).replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
  function show(){lastFocus=document.activeElement;V.hidden=false;document.body.classList.add("v-lock");V.querySelector(".v-x").focus()}
  function close(){V.hidden=true;body.innerHTML="";document.body.classList.remove("v-lock");lastFocus&&lastFocus.focus()}
  function open(a){
    const href=a.getAttribute("href"),name=a.querySelector("b")?.textContent||a.textContent.trim()||href,ext=href.split("?")[0].split(".").pop().toLowerCase(),remote=/^https?:/i.test(href);
    title.textContent=name;openA.href=href;downA.href=href;body.innerHTML="";
    if(remote){
      kind.textContent="Dataset, external link";
      body.innerHTML=`<div class="v-msg"><h4>Too big to preview here</h4><p>The full Traffy Fondue file has over one million rows, so it opens as a download from the official Traffy server.</p><p>To look at the data now, open the 20-row sample instead.</p><button class="btn" type="button" id="vSample"><span>Preview the 20-row sample</span></button></div>`;
      show();document.getElementById("vSample").addEventListener("click",()=>{const s=document.querySelector('.file[href="sample_20_rows.csv"]');if(s)open(s)});return}
    if(ext==="pdf"){
      kind.textContent="PDF document";
      const pages=PREVIEWS[href];
      body.innerHTML=pages?`<div class="v-pages">${pages.map((p,i)=>`<img src="${esc(p)}" alt="${esc(name)}, page ${i+1}" loading="lazy">`).join("")}</div>`
                          :`<iframe src="${esc(href)}#view=FitH" title="${esc(name)}"></iframe>`;
      show();return}
    if(ext==="csv"){
      kind.textContent="CSV data";body.innerHTML='<div class="v-msg"><p>Loading the table...</p></div>';show();
      fetch(href).then(r=>{if(!r.ok)throw 0;return r.text()}).then(t=>{
        const rows=parseCSV(t.replace(/^\ufeff/,""));if(!rows.length)throw 0;
        const head=rows[0],data=rows.slice(1);
        body.innerHTML=`<div class="v-info">${data.length} rows, ${head.length} columns. Scroll sideways to see every column, and hover a cell to read it in full.</div>
          <table class="v-table"><thead><tr><th>#</th>${head.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead>
          <tbody>${data.map((r,i)=>`<tr><td>${i+1}</td>${head.map((_,j)=>`<td title="${esc(r[j]??"")}">${esc(r[j]??"")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      }).catch(()=>{body.innerHTML='<div class="v-msg"><h4>Preview not available here</h4><p>The table preview works once the page is online (for example on GitHub Pages). For now, use Download or New tab.</p></div>'});
      return}
    if(["png","jpg","jpeg","webp"].includes(ext)){kind.textContent="Chart";body.innerHTML=`<div class="v-pages"><img class="v-img" src="${esc(href)}" alt="${esc(name)}"></div>`;show();return}
    if(ext==="html"){kind.textContent="Interactive map";body.innerHTML=`<iframe src="${esc(href)}" title="${esc(name)}" style="background:#fff"></iframe>`;show();return}
    if(ext==="txt"){kind.textContent="Text";body.innerHTML='<div class="v-msg"><p>Loading...</p></div>';show();
      fetch(href).then(r=>{if(!r.ok)throw 0;return r.text()}).then(t=>{body.innerHTML=`<pre class="v-pre">${esc(t)}</pre>`}).catch(()=>{body.innerHTML='<div class="v-msg"><h4>Preview not available here</h4><p>Use Download or New tab.</p></div>'});return}
    if(ext==="ipynb"){kind.textContent="Colab notebook";body.innerHTML=`<div class="v-msg"><h4>Milestone 3 notebook</h4><p>This is the Python code that cleaned the data and produced every result on this page.</p><p>Download it, then open it in Google Colab (File, Upload notebook) and choose Run all.</p></div>`;show();return}
    window.open(href,"_blank","noopener");
  }
  document.querySelectorAll("a.file, a.fig, #mapBtn, #giBtn").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();open(a)}));
  window.openFile=open;
  V.querySelectorAll("[data-close]").forEach(el=>el.addEventListener("click",close));
  addEventListener("keydown",e=>{if(!V.hidden&&e.key==="Escape"){e.preventDefault();e.stopPropagation();close()}},true);
  // keep keyboard focus inside the viewer
  V.addEventListener("keydown",e=>{if(e.key!=="Tab")return;const f=[...V.querySelectorAll("a[href],button,iframe")].filter(x=>x.offsetParent!==null);if(!f.length)return;
    const first=f[0],last=f[f.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}});
})();

/* ---------- v2 helpers: section bar, count-up, lazy charts ---------- */
(function(){
  const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
  // sticky section bar built from the page's own section headings
  const secs=[...document.querySelectorAll("main.page > section")].filter(s=>s.querySelector(".head h2"));
  const hero=document.querySelector(".phero");
  if(hero&&secs.length>=3){
    const nav=document.createElement("nav");nav.className="secnav";nav.setAttribute("aria-label","On this page");
    nav.innerHTML='<div class="wrap">'+secs.map((s,i)=>{if(!s.id)s.id="s"+(i+1);const n=s.querySelector(".plate")?.textContent||String(i+1).padStart(2,"0");
      return `<a href="#${s.id}"><i>${n}</i>${s.querySelector(".head h2").textContent}</a>`}).join("")+"</div>";
    hero.after(nav);
    const links=[...nav.querySelectorAll("a")];
    const spy=()=>{let cur=0;secs.forEach((s,i)=>{if(s.getBoundingClientRect().top<160)cur=i});
      links.forEach((a,i)=>a.classList.toggle("on",i===cur));
      const on=links[cur];if(on){const w=nav.firstChild;const l=on.offsetLeft-w.offsetLeft;if(l<w.scrollLeft||l+on.offsetWidth>w.scrollLeft+w.clientWidth)w.scrollTo({left:l-20,behavior:"smooth"})}};
    addEventListener("scroll",spy,{passive:true});spy();
  }
  // count-up numbers in KPI tiles
  function countUp(el){
    const raw=el.textContent.trim(),m=raw.match(/^([^0-9]*)([0-9][0-9,]*\.?[0-9]*)(.*)$/);if(!m||reduce)return;
    const pre=m[1],num=parseFloat(m[2].replace(/,/g,"")),post=m[3],dec=(m[2].split(".")[1]||"").length,comma=m[2].includes(",");
    const t0=performance.now(),dur=1300;
    const fmt=v=>pre+(comma?v.toLocaleString("en-US",{minimumFractionDigits:dec,maximumFractionDigits:dec}):v.toFixed(dec))+post;
    el.textContent=fmt(0);
    (function step(t){const p=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-p,3);el.textContent=fmt(num*e);if(p<1)requestAnimationFrame(step);else el.textContent=raw})(t0);
  }
  const io=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;const el=e.target;io.unobserve(el);
    el.classList.add("go");el.querySelectorAll(".kpi > b").forEach(countUp);
    if(el.__init){el.__init();el.__init=null}}),{threshold:.15});
  document.querySelectorAll(".kpis,.kbar,.vs,.dots,.ring,[data-reveal]").forEach(el=>io.observe(el));
  // charts start when they scroll into view, so the animation is seen
  window.whenSeen=(el,fn)=>{if(typeof el==="string")el=document.getElementById(el);if(!el)return;el.__init=fn;io.observe(el)};
  // value labels at the end of bars: options.plugins.vlabels = {fmt:v=>..., color}
  if(window.Chart){
    Chart.register({id:"vlabels",afterDatasetsDraw(ch,_,o){if(!o||!o.fmt)return;const g=ch.ctx;g.save();
      g.font="600 12px 'Chakra Petch',sans-serif";g.fillStyle=o.color||"#F1F2F5";
      ch.data.datasets.forEach((ds,di)=>{const meta=ch.getDatasetMeta(di);if(meta.hidden||(o.only!==undefined&&o.only!==di))return;
        meta.data.forEach((b,i)=>{const v=ds.data[i];if(v==null)return;const t=o.fmt(v,i,di);const hz=ch.options.indexAxis==="y";
          if(hz){g.textAlign="left";g.textBaseline="middle";g.fillText(t,b.x+6,b.y)}else{g.textAlign="center";g.textBaseline="bottom";g.fillText(t,b.x,b.y-4)}})});
      g.restore()}});
    Chart.defaults.animation.duration=1100;Chart.defaults.animation.easing="easeOutQuart";
  }
})();
