const PKOS_DATA_BASE = new URLSearchParams(location.search).get('data') || '../_pkos';
const DIAG = {
  base: PKOS_DATA_BASE,
  resources: [],
};

function esc(v){return String(v??'').replace(/[&<>]/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]));}
function dataUrl(file){return `${PKOS_DATA_BASE}/${file}`.replace(/\/+/g,'/');}
function nav(){return `<nav class="top-nav"><a href="index.html">Overview</a><a href="objects.html">Objects</a><a href="review.html">Review</a><a href="digests.html">Digests</a><button id="themeToggle" class="ghost" aria-label="toggle theme">🌓</button></nav>`}

function shell(title){
  return `${nav()}<section class="hero"><h1>${esc(title)}</h1><p class="small">Read-only GUI. Use copy snippets in VS Code/CLI; browser never writes authority files.</p></section><div id="alerts"></div><div id="content"></div>${diagnosticsPanel()}`;
}

function diagnosticsPanel(){
  return `<details class="card diag"><summary>Diagnostics</summary>
  <div class="small"><b>PKOS_DATA_BASE:</b> <code>${esc(PKOS_DATA_BASE)}</code></div>
  <div class="small">Resource status updates appear after each load.</div>
  <ul id="diagList" class="small"></ul>
  </details>`;
}

function setAlert(html){
  const el=document.getElementById('alerts'); if(el) el.innerHTML=html;
}

function updateDiagnostics(){
  const el=document.getElementById('diagList'); if(!el) return;
  el.innerHTML = DIAG.resources.map(r=>`<li><code>${esc(r.url)}</code> — ${esc(r.status)}${r.note?` (${esc(r.note)})`:''}</li>`).join('');
}

function recordDiag(url,status,note=''){
  const i = DIAG.resources.findIndex(x=>x.url===url);
  const item={url,status,note};
  if(i>=0) DIAG.resources[i]=item; else DIAG.resources.push(item);
  updateDiagnostics();
}

async function loadJSON(file){
  const url = dataUrl(file);
  try{
    const r = await fetch(url, {cache:'no-store'});
    if(!r.ok){
      recordDiag(url,'fail',`${r.status}`);
      throw new Error(`${r.status}`);
    }
    const j = await r.json();
    recordDiag(url,'ok',`items=${Array.isArray(j)?j.length:Object.keys(j||{}).length}`);
    return j;
  }catch(err){
    throw {url, err};
  }
}

function renderLoadError(ctx, detail){
  const html = `<div class="card error"><h3>Data load failed</h3>
  <p><b>Page:</b> ${esc(ctx)}</p>
  <p><b>Missing/failed URL:</b> <code>${esc(detail.url)}</code></p>
  <p><b>Error:</b> ${esc(String(detail.err))}</p>
  <p>Try running:</p>
  <pre>python -m tools.pkos export-site-data</pre>
  <p class="small">Then start server from repo root:</p>
  <pre>python -m http.server 8000</pre>
  </div>`;
  setAlert(html);
}

function emptyState(msg, hint=''){
  return `<div class="card empty"><p>${esc(msg)}</p>${hint?`<p class="small">${esc(hint)}</p>`:''}</div>`;
}

function wireThemeToggle(){
  const btn=document.getElementById('themeToggle');
  if(!btn) return;
  const saved=localStorage.getItem('pkos-theme');
  if(saved) document.documentElement.dataset.theme=saved;
  btn.onclick=()=>{
    const next=(document.documentElement.dataset.theme==='light')?'dark':'light';
    document.documentElement.dataset.theme=next;
    localStorage.setItem('pkos-theme', next);
  };
}

async function pageIndex(){
  document.getElementById('app').innerHTML=shell('PKOS Private Dashboard');
  wireThemeToggle();
  try{
    const data = await loadJSON('index.json');
    const byType = {}, byStatus = {};
    for(const o of data){byType[o.type]=(byType[o.type]||0)+1; byStatus[o.status]=(byStatus[o.status]||0)+1;}
    document.getElementById('content').innerHTML =
      `<div class="grid">${Object.entries(byType).map(([k,v])=>`<article class="card stat"><span>${esc(k)}</span><strong>${v}</strong></article>`).join('')}</div>`+
      `<div class="grid">${Object.entries(byStatus).map(([k,v])=>`<article class="card stat"><span>${esc(k)}</span><strong>${v}</strong></article>`).join('')}</div>`;
    if(!data.length) document.getElementById('content').innerHTML += emptyState('No objects found.','Run export-site-data with a populated objects dir (or demo dataset).');
  }catch(detail){renderLoadError('index', detail);}  
}

function downloadText(filename, text){
  const blob = new Blob([text], {type:'text/plain;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  URL.revokeObjectURL(a.href);
}

async function pageObjects(){
  document.getElementById('app').innerHTML=shell('Objects');
  wireThemeToggle();
  try{
    const data = await loadJSON('index.json');
    document.getElementById('content').innerHTML = `<section class="card filters">
      <label>Type <select id="fType"><option value="">all</option><option>fact</option><option>skill</option><option>claim</option><option>creative</option></select></label>
      <label>Status <input id="fStatus" placeholder="status"></label>
      <label>Tags <input id="fTags" placeholder="tag"></label>
      <button id="apply">Apply</button>
    </section>
    <section class="card"><table><thead><tr><th>id</th><th>type</th><th>status</th><th>title</th><th>tags</th><th>path</th></tr></thead><tbody id="rows"></tbody></table></section>
    <aside class="card create-panel"><h3>Create (copy/download only)</h3>
      <p class="small">This does not write repository files.</p>
      <select id="cType"><option>fact</option><option>skill</option><option>claim</option><option>creative</option></select>
      <div class="row"><button id="gen">Generate</button><button id="copy">Copy</button><button id="down">Download</button></div>
      <pre id="tpl" class="small"></pre>
    </aside>`;

    const templates={
      fact:`id: fact.new\ntype: fact\nstatus: raw\ntitle: \"\"\nsummary: \"\"\nsource: []\nanchors: []\ncreated_at: \"\"\nupdated_at: \"\"\n`,
      skill:`id: skill.new\ntype: skill\nstatus: raw\ntitle: \"\"\nsummary: \"\"\nsource: []\nanchors: []\ncreated_at: \"\"\nupdated_at: \"\"\n`,
      claim:`id: claim.new\ntype: claim\nstatus: raw\ntitle: \"\"\nsummary: \"\"\nsource: []\nanchors: []\ncreated_at: \"\"\nupdated_at: \"\"\n`,
      creative:`id: creative.new\ntype: creative\nstatus: draft\ntitle: \"\"\nsummary: \"\"\ncreated_at: \"\"\nupdated_at: \"\"\ntags: []\n`
    };

    function render(){
      const t=document.getElementById('fType').value.trim();
      const s=document.getElementById('fStatus').value.trim().toLowerCase();
      const g=document.getElementById('fTags').value.trim().toLowerCase();
      const rows=data.filter(o=>(!t||o.type===t)&&(!s||String(o.status).toLowerCase().includes(s))&&(!g||(o.tags||[]).join(',').toLowerCase().includes(g)))
      .map(o=>`<tr><td>${esc(o.id)}</td><td><span class="chip">${esc(o.type)}</span></td><td>${esc(o.status)}</td><td>${esc(o.title)}</td><td>${esc((o.tags||[]).join(','))}</td><td class="small">${esc(o.path)}</td></tr>`).join('');
      document.getElementById('rows').innerHTML = rows || `<tr><td colspan="6">No matched objects.</td></tr>`;
    }

    document.getElementById('apply').onclick=render;
    document.getElementById('gen').onclick=()=>{const t=document.getElementById('cType').value; document.getElementById('tpl').textContent=templates[t];};
    document.getElementById('copy').onclick=()=>navigator.clipboard.writeText(document.getElementById('tpl').textContent||'');
    document.getElementById('down').onclick=()=>{const t=document.getElementById('cType').value; downloadText(`${t}_template.yaml`, document.getElementById('tpl').textContent||'');};
    render(); document.getElementById('gen').click();

    if(!data.length) document.getElementById('content').innerHTML = emptyState('No objects found.','Run export-site-data with demo/objects or real objects.');
  }catch(detail){renderLoadError('objects', detail);}  
}

async function pageReview(){
  document.getElementById('app').innerHTML=shell('Review Queues');
  wireThemeToggle();
  try{
    const data = await loadJSON('queues.json');
    const toRows=(arr)=>arr.map(x=>`<tr><td>${esc(x.id)}</td><td>${esc(x.title)}</td><td>${esc(x.due_at)}</td><td class="small">${esc(x.path)}</td><td>${[1,2,3,4,5].map(n=>`<button class="score" data-id="${esc(x.id)}" data-r="${n}" aria-label="score ${n}">${n}</button>`).join('')}</td></tr>`).join('') || `<tr><td colspan="5">No queue items.</td></tr>`;
    document.getElementById('content').innerHTML=`<div class="card warn">Read-only: scoring buttons only generate copyable snippets.</div>
    <div class="card"><h3>Daily</h3><table><tr><th>id</th><th>title</th><th>due_at</th><th>path</th><th>score</th></tr>${toRows(data.daily||[])}</table></div>
    <div class="card"><h3>Weekly</h3><table><tr><th>id</th><th>title</th><th>due_at</th><th>path</th><th>score</th></tr>${toRows(data.weekly||[])}</table></div>
    <div class="card"><h3>Generated snippet (copy-only)</h3><pre id="snip" class="small"></pre></div>`;

    document.querySelectorAll('button[data-id]').forEach(b=>{
      b.addEventListener('click', ()=>{
        const id=b.dataset.id, r=b.dataset.r;
        const cmd=`python -m tools.pkos review-log append --id ${id} --score ${r}`;
        const log=`{\"id\":\"${id}\",\"score\":${r},\"at\":\"<UTC_ISO>\"}`;
        document.getElementById('snip').textContent=`# command\n${cmd}\n\n# log line\n${log}`;
      });
      b.addEventListener('keydown', (e)=>{if(e.key==='Enter' || e.key===' '){e.preventDefault();b.click();}});
    });
  }catch(detail){renderLoadError('review', detail);} 
}

async function pageDigests(){
  document.getElementById('app').innerHTML=shell('Digests');
  wireThemeToggle();
  try{
    const data = await loadJSON('digests.json');
    const rows=[...data].sort((a,b)=>String(b.week).localeCompare(String(a.week)))
      .map(d=>`<tr><td>${esc(d.week)}</td><td>${esc(d.title)}</td><td>${esc(d.entry_count)}</td><td class="small">${esc((d.references||[]).join(','))}</td><td class="small">${esc(d.path)}</td></tr>`).join('')
      || `<tr><td colspan="5">No digests found.</td></tr>`;
    document.getElementById('content').innerHTML=`<div class="card"><table><tr><th>week</th><th>title</th><th>entries</th><th>references</th><th>path</th></tr>${rows}</table></div>`;
  }catch(detail){renderLoadError('digests', detail);} 
}
