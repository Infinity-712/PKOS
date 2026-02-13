async function loadJSON(path){const r=await fetch(path); if(!r.ok) throw new Error(path); return r.json();}
function esc(v){return String(v??'').replace(/[&<>]/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]));}
function nav(){return `<nav><a href="index.html">Overview</a><a href="objects.html">Objects</a><a href="review.html">Review</a><a href="digests.html">Digests</a></nav>`}

async function pageIndex(){
  const data = await loadJSON('../_pkos/index.json');
  const byType = {}; const byStatus = {};
  for(const o of data){byType[o.type]=(byType[o.type]||0)+1; byStatus[o.status]=(byStatus[o.status]||0)+1;}
  document.getElementById('app').innerHTML = `${nav()}<div class="card"><b>Read-only dashboard.</b> Exported data only; copy actions to VS Code/CLI.</div>`+
    `<div class="grid">${Object.entries(byType).map(([k,v])=>`<div class="card"><div>${k}</div><h2>${v}</h2></div>`).join('')}</div>`+
    `<div class="grid">${Object.entries(byStatus).map(([k,v])=>`<div class="card"><div>${k}</div><h2>${v}</h2></div>`).join('')}</div>`;
}

async function pageObjects(){
  const data = await loadJSON('../_pkos/index.json');
  const app=document.getElementById('app');
  app.innerHTML = `${nav()}<div class="card warn">只读：Create 仅生成模板文本（复制/下载），不会写回仓库。</div>
  <div class="card">Type <select id="fType"><option value="">all</option><option>fact</option><option>skill</option><option>claim</option><option>creative</option></select>
  Status <input id="fStatus" placeholder="status"> Tags <input id="fTags" placeholder="tag">
  <button id="apply">Apply</button></div>
  <div class="card"><table><thead><tr><th>id</th><th>type</th><th>status</th><th>title</th><th>tags</th><th>path</th></tr></thead><tbody id="rows"></tbody></table></div>
  <div class="card"><h3>Create Template (copy only)</h3>
  <select id="cType"><option>fact</option><option>skill</option><option>claim</option><option>creative</option></select>
  <button id="gen">Generate</button> <button id="copy">Copy</button>
  <pre id="tpl" class="small"></pre></div>`;

  const templates={
    fact:`id: fact.new\ntype: fact\nstatus: raw\ntitle: \"\"\nsummary: \"\"\nsource: []\nanchors: []\ncreated_at: \"\"\nupdated_at: \"\"\n`,
    skill:`id: skill.new\ntype: skill\nstatus: raw\ntitle: \"\"\nsummary: \"\"\nsource: []\nanchors: []\ncreated_at: \"\"\nupdated_at: \"\"\n`,
    claim:`id: claim.new\ntype: claim\nstatus: raw\ntitle: \"\"\nsummary: \"\"\nsource: []\nanchors: []\ncreated_at: \"\"\nupdated_at: \"\"\n`,
    creative:`id: creative.new\ntype: creative\nstatus: draft\ntitle: \"\"\nsummary: \"\"\ncreated_at: \"\"\nupdated_at: \"\"\ntags: []\n`
  }
  function render(){
    const t=document.getElementById('fType').value.trim(); const s=document.getElementById('fStatus').value.trim().toLowerCase(); const g=document.getElementById('fTags').value.trim().toLowerCase();
    const rows=data.filter(o=>(!t||o.type===t)&&(!s||String(o.status).toLowerCase().includes(s))&&(!g||(o.tags||[]).join(',').toLowerCase().includes(g)))
      .map(o=>`<tr><td>${esc(o.id)}</td><td>${esc(o.type)}</td><td>${esc(o.status)}</td><td>${esc(o.title)}</td><td>${esc((o.tags||[]).join(','))}</td><td>${esc(o.path)}</td></tr>`).join('');
    document.getElementById('rows').innerHTML=rows;
  }
  document.getElementById('apply').onclick=render; render();
  document.getElementById('gen').onclick=()=>{const t=document.getElementById('cType').value; document.getElementById('tpl').textContent=templates[t]}
  document.getElementById('copy').onclick=()=>navigator.clipboard.writeText(document.getElementById('tpl').textContent||'');
  document.getElementById('gen').click();
}

async function pageReview(){
  const data = await loadJSON('../_pkos/queues.json');
  const app=document.getElementById('app');
  const toRows=(arr)=>arr.map(x=>`<tr><td>${esc(x.id)}</td><td>${esc(x.title)}</td><td>${esc(x.due_at)}</td><td>${esc(x.path)}</td><td>${[1,2,3,4,5].map(n=>`<button data-id="${esc(x.id)}" data-r="${n}">${n}</button>`).join(' ')}</td></tr>`).join('');
  app.innerHTML=`${nav()}<div class="card warn">只读：评分按钮仅生成可复制片段，不会写回 objects/review/logs。</div>
  <div class="card"><h3>Daily</h3><table><tr><th>id</th><th>title</th><th>due_at</th><th>path</th><th>score</th></tr>${toRows(data.daily||[])}</table></div>
  <div class="card"><h3>Weekly</h3><table><tr><th>id</th><th>title</th><th>due_at</th><th>path</th><th>score</th></tr>${toRows(data.weekly||[])}</table></div>
  <div class="card"><h3>Generated snippet</h3><pre id="snip" class="small"></pre></div>`;
  app.querySelectorAll('button[data-id]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.id, r=b.dataset.r;
    const cmd=`# copy & run later\npython -m tools.pkos review-log append --id ${id} --score ${r}`;
    const log=`{\"id\":\"${id}\",\"score\":${r},\"at\":\"<UTC_ISO>\"}`;
    document.getElementById('snip').textContent=cmd+"\n\n# or log line\n"+log;
  });
}

async function pageDigests(){
  const data = await loadJSON('../_pkos/digests.json');
  const rows=[...data].sort((a,b)=>String(b.week).localeCompare(String(a.week)))
    .map(d=>`<tr><td>${esc(d.week)}</td><td>${esc(d.title)}</td><td>${esc(d.entry_count)}</td><td>${esc((d.references||[]).join(','))}</td><td>${esc(d.path)}</td></tr>`).join('');
  document.getElementById('app').innerHTML=`${nav()}<div class="card"><table><tr><th>week</th><th>title</th><th>entries</th><th>references</th><th>path</th></tr>${rows}</table></div>`;
}
