const PKOS_DATA_BASE = new URLSearchParams(location.search).get('data') || '../_pkos';
const LANG_KEY = 'pkos-lang';
const THEME_KEY = 'pkos-theme';
const RATINGS_KEY = 'pkos-review-ratings';
const PREVIEW_FIELDS = ['content', 'body', 'text', 'notes', 'definition'];
const CLAIM_HINT_FIELDS = ['claim_statement', 'assumptions', 'counter_arguments', 'scope', 'invalidation_conditions'];

const DIAG = { base: PKOS_DATA_BASE, resources: [] };
const STATE = {
  lang: 'zh',
  theme: 'light',
  ratings: {},
  previewCache: new Map(),
};

const I18N = {
  zh: {
    navOverview: '总览', navObjects: '对象', navReview: '复习', navDigests: '周报',
    heroHint: '只读 GUI：仅生成可复制片段，不会直接写回权威文件。',
    diagnostics: '诊断信息', resourceUpdates: '每次加载后会更新资源状态。',
    dataLoadFailed: '数据加载失败', page: '页面', failedUrl: '失败地址', error: '错误',
    tryRun: '可尝试运行：', thenServe: '然后在仓库根目录启动：',
    noObjects: '暂无对象数据。', noObjectsHint: '请运行 export-site-data 或使用 demo 数据。',
    indexTitle: 'PKOS 私有看板', objectsTitle: '对象清单', reviewTitle: '复习队列', digestsTitle: '周报索引',
    byType: '按类型', byStatus: '按状态',
    filterType: '类型', filterStatus: '状态', filterTags: '标签', all: '全部', apply: '应用筛选',
    createPanelTitle: 'Create（仅复制/下载）', createHint: '仅生成模板文本，不会写入仓库。',
    generate: '生成', copy: '复制', download: '下载',
    noMatched: '无匹配对象', noQueue: '暂无队列项',
    id: 'ID', type: '类型', status: '状态', title: '标题', tags: '标签', path: '路径',
    dueAt: '到期时间', score: '评分', actions: '操作', preview: '预览',
    daily: 'Daily（事实+技能）', weekly: 'Weekly（主张）',
    reviewReadonly: '只读：评分只生成命令/日志片段，请在 VS Code/CLI 手动执行写回。',
    builderTitle: '命令生成器（聚合）', builderHint: '单一可复制输出；同对象重复评分会覆盖旧值。',
    copyAll: '一键复制', clear: '清空',
    commandDraft: '# TODO: 待后续 CLI 支持\npkos review-log append --batch-jsonl <<\'JSONL\'',
    commandEnd: 'JSONL',
    logSnippet: '# 日志片段（可粘贴）',
    noRatingsYet: '尚未评分，点击上方 1~5 分按钮开始聚合。',
    joinedQueue: '已加入评分队列', ratingUpdated: '已更新评分（覆盖旧值）',
    copied: '已复制到剪贴板', copyFailed: '复制失败，请手动复制',
    cleared: '已清空评分聚合器',
    previewLoadFailed: '预览加载失败：未找到对象正文，已回退摘要。',
    previewNoBody: '无正文字段，当前展示摘要。建议在对象中补充 content/body/text/notes。',
    previewModalTitle: '知识预览', close: '关闭',
    summary: '摘要', content: '正文',
    updatedAt: '更新时间', references: '引用', entries: '条目数',
    noDigests: '暂无周报数据',
    langToggle: 'EN', themeToggle: '深/浅',
    loadObjectFailed: '对象详情加载失败',
  },
  en: {
    navOverview: 'Overview', navObjects: 'Objects', navReview: 'Review', navDigests: 'Digests',
    heroHint: 'Read-only GUI: generate copyable snippets only; no direct writes to authority files.',
    diagnostics: 'Diagnostics', resourceUpdates: 'Resource status updates appear after each load.',
    dataLoadFailed: 'Data load failed', page: 'Page', failedUrl: 'Failed URL', error: 'Error',
    tryRun: 'Try running:', thenServe: 'Then serve from repository root:',
    noObjects: 'No objects found.', noObjectsHint: 'Run export-site-data or use demo data.',
    indexTitle: 'PKOS Private Dashboard', objectsTitle: 'Objects', reviewTitle: 'Review Queues', digestsTitle: 'Digests',
    byType: 'By Type', byStatus: 'By Status',
    filterType: 'Type', filterStatus: 'Status', filterTags: 'Tags', all: 'all', apply: 'Apply',
    createPanelTitle: 'Create (copy/download only)', createHint: 'Generates template text only; does not write repository files.',
    generate: 'Generate', copy: 'Copy', download: 'Download',
    noMatched: 'No matched objects', noQueue: 'No queue items',
    id: 'id', type: 'type', status: 'status', title: 'title', tags: 'tags', path: 'path',
    dueAt: 'due_at', score: 'score', actions: 'actions', preview: 'Preview',
    daily: 'Daily (Fact + Skill)', weekly: 'Weekly (Claim)',
    reviewReadonly: 'Read-only: scores only generate command/log snippets. Execute writes in VS Code/CLI manually.',
    builderTitle: 'Command Builder (aggregated)', builderHint: 'Single copyable output; rescoring the same object overwrites previous value.',
    copyAll: 'Copy All', clear: 'Clear',
    commandDraft: '# TODO: wait for future CLI support\npkos review-log append --batch-jsonl <<\'JSONL\'',
    commandEnd: 'JSONL',
    logSnippet: '# Log snippet (paste-ready)',
    noRatingsYet: 'No ratings yet. Click 1~5 score buttons above to aggregate.',
    joinedQueue: 'Added to rating queue', ratingUpdated: 'Rating updated (previous value overwritten)',
    copied: 'Copied to clipboard', copyFailed: 'Copy failed, please copy manually',
    cleared: 'Rating aggregator cleared',
    previewLoadFailed: 'Preview failed: no body found; fallback summary shown.',
    previewNoBody: 'No body field found; showing summary fallback. Consider adding content/body/text/notes.',
    previewModalTitle: 'Knowledge Preview', close: 'Close',
    summary: 'Summary', content: 'Content',
    updatedAt: 'Updated at', references: 'References', entries: 'Entries',
    noDigests: 'No digests found',
    langToggle: '中', themeToggle: 'Dark/Light',
    loadObjectFailed: 'Failed to load object details',
  }
};

function esc(v){ return String(v ?? '').replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s])); }
function t(key){ return I18N[STATE.lang]?.[key] || I18N.en[key] || key; }
function dataUrl(file){ const u = `${PKOS_DATA_BASE}/${file}`; return u.replace(/([^:])\/{2,}/g, '$1/'); }
function toast(message, kind='info'){
  const c = document.getElementById('toastContainer');
  if(!c) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  c.appendChild(el);
  setTimeout(()=>{ el.classList.add('hide'); setTimeout(()=>el.remove(), 250); }, 2000);
}

function initLang(){
  const saved = localStorage.getItem(LANG_KEY);
  if(saved === 'zh' || saved === 'en'){ STATE.lang = saved; return; }
  STATE.lang = String(navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  STATE.theme = (saved === 'dark' || saved === 'light') ? saved : ((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
  document.documentElement.dataset.theme = STATE.theme;
}

function loadRatings(){
  try{ STATE.ratings = JSON.parse(localStorage.getItem(RATINGS_KEY) || '{}') || {}; }
  catch{ STATE.ratings = {}; }
}
function persistRatings(){ localStorage.setItem(RATINGS_KEY, JSON.stringify(STATE.ratings)); }

function nav(){
  return `<nav class="top-nav">
    <a href="index.html">${esc(t('navOverview'))}</a>
    <a href="objects.html">${esc(t('navObjects'))}</a>
    <a href="review.html">${esc(t('navReview'))}</a>
    <a href="digests.html">${esc(t('navDigests'))}</a>
    <div class="nav-actions">
      <button id="langToggle" class="ghost" aria-label="language">${esc(t('langToggle'))}</button>
      <button id="themeToggle" class="ghost" aria-label="theme">${esc(t('themeToggle'))}</button>
    </div>
  </nav>`;
}

function shell(title){
  return `${nav()}<section class="hero"><h1>${esc(title)}</h1><p class="small">${esc(t('heroHint'))}</p></section>
  <div id="alerts"></div><div id="content"></div>${diagnosticsPanel()}
  <div id="toastContainer" class="toast-container" aria-live="polite"></div>
  <dialog id="previewModal" class="modal"></dialog>`;
}

function setHeaderTitle(v){ const el=document.getElementById('title'); if(el) el.textContent=v; document.title=v; }

function diagnosticsPanel(){
  return `<details class="card diag"><summary>${esc(t('diagnostics'))}</summary>
    <div class="small"><b>PKOS_DATA_BASE:</b> <code>${esc(PKOS_DATA_BASE)}</code></div>
    <div class="small">${esc(t('resourceUpdates'))}</div>
    <ul id="diagList" class="small"></ul>
  </details>`;
}

function setAlert(html){ const el=document.getElementById('alerts'); if(el) el.innerHTML=html; }
function updateDiagnostics(){
  const el=document.getElementById('diagList'); if(!el) return;
  el.innerHTML = DIAG.resources.map(r=>`<li><code>${esc(r.url)}</code> — ${esc(r.status)}${r.note?` (${esc(r.note)})`:''}</li>`).join('');
}
function recordDiag(url,status,note=''){ const i=DIAG.resources.findIndex(x=>x.url===url); const item={url,status,note}; if(i>=0) DIAG.resources[i]=item; else DIAG.resources.push(item); updateDiagnostics(); }

async function loadJSON(file){
  const url = dataUrl(file);
  try{
    const r = await fetch(url, {cache:'no-store'});
    if(!r.ok){ recordDiag(url,'fail',`${r.status}`); throw new Error(`${r.status}`); }
    const j = await r.json();
    recordDiag(url,'ok',`items=${Array.isArray(j)?j.length:Object.keys(j||{}).length}`);
    return j;
  }catch(err){ throw {url, err}; }
}

function renderLoadError(ctx, detail){
  setAlert(`<div class="card error"><h3>${esc(t('dataLoadFailed'))}</h3>
  <p><b>${esc(t('page'))}:</b> ${esc(ctx)}</p>
  <p><b>${esc(t('failedUrl'))}:</b> <code>${esc(detail.url)}</code></p>
  <p><b>${esc(t('error'))}:</b> ${esc(String(detail.err))}</p>
  <p>${esc(t('tryRun'))}</p><pre>python -m tools.pkos export-site-data</pre>
  <p class="small">${esc(t('thenServe'))}</p><pre>python -m http.server 8000</pre></div>`);
  toast(t('dataLoadFailed'), 'error');
}

function emptyState(msg, hint=''){ return `<div class="card empty"><p>${esc(msg)}</p>${hint?`<p class="small">${esc(hint)}</p>`:''}</div>`; }

function wireGlobalToggles(){
  const langBtn = document.getElementById('langToggle');
  if(langBtn){ langBtn.onclick = ()=>{ STATE.lang = STATE.lang === 'zh' ? 'en' : 'zh'; localStorage.setItem(LANG_KEY, STATE.lang); location.reload(); }; }
  const themeBtn = document.getElementById('themeToggle');
  if(themeBtn){ themeBtn.onclick = ()=>{ STATE.theme = STATE.theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = STATE.theme; localStorage.setItem(THEME_KEY, STATE.theme); }; }
}

function downloadText(filename, text){ const blob = new Blob([text], {type:'text/plain;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); URL.revokeObjectURL(a.href); }

function simplifyMarkdown(text){
  const lines = String(text || '').split('\n');
  const frag = document.createDocumentFragment();
  let list = null;
  for(const line of lines){
    if(/^\s*[-*]\s+/.test(line)){
      if(!list){ list = document.createElement('ul'); frag.appendChild(list); }
      const li = document.createElement('li');
      li.textContent = line.replace(/^\s*[-*]\s+/, '');
      list.appendChild(li);
      continue;
    }
    list = null;
    const p = document.createElement('p');
    p.textContent = line;
    frag.appendChild(p);
  }
  return frag;
}

function parseSimpleYAML(yaml){
  const out = {};
  let key = null;
  let listKey = null;
  const lines = String(yaml||'').split(/\r?\n/);
  for(const raw of lines){
    if(!raw || /^\s*#/.test(raw)) continue;
    const top = raw.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if(top){
      key = top[1]; listKey = null;
      const val = top[2] || '';
      if(val === '') out[key] = '';
      else if(val === '[]') out[key] = [];
      else out[key] = val.replace(/^"|"$/g, '');
      continue;
    }
    const item = raw.match(/^\s*-\s*(.*)$/);
    if(item && key){
      if(!Array.isArray(out[key])) out[key] = [];
      out[key].push(item[1].replace(/^"|"$/g, ''));
      listKey = key;
      continue;
    }
    if(/^\s{2,}[A-Za-z0-9_]+:/.test(raw)){
      const m = raw.trim().match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if(m){
        const k = `${key}.${m[1]}`;
        out[k] = m[2].replace(/^"|"$/g, '');
      }
      continue;
    }
    if((key || listKey) && raw.startsWith('  ')){
      const k = listKey || key;
      if(typeof out[k] === 'string') out[k] += `\n${raw.trim()}`;
    }
  }
  return out;
}

function extractPreviewContent(meta, obj = {}){
  for(const field of PREVIEW_FIELDS){
    if(obj[field]) return {body:String(obj[field]), fallback:false};
  }
  const claimBlocks = [];
  for(const f of CLAIM_HINT_FIELDS){
    if(obj[f]){
      const value = Array.isArray(obj[f]) ? obj[f].map(x=>`- ${x}`).join('\n') : String(obj[f]);
      claimBlocks.push(`${f}:\n${value}`);
    }
  }
  if(claimBlocks.length){ return {body:claimBlocks.join('\n\n'), fallback:true}; }
  if(meta?.summary){ return {body:String(meta.summary), fallback:true}; }
  return {body:'', fallback:true};
}

async function loadObjectByPath(path){
  if(!path) throw new Error('missing path');
  if(STATE.previewCache.has(path)) return STATE.previewCache.get(path);
  const r = await fetch(`../${path}`.replace(/\/+/g, '/'), {cache:'no-store'});
  if(!r.ok) throw new Error(`${r.status}`);
  const text = await r.text();
  const parsed = parseSimpleYAML(text);
  STATE.previewCache.set(path, parsed);
  return parsed;
}

async function openPreview(item){
  const dlg = document.getElementById('previewModal');
  if(!dlg) return;
  let parsed = {};
  let fallbackMessage = '';
  try{ parsed = await loadObjectByPath(item.path); }
  catch{ toast(t('loadObjectFailed'), 'error'); fallbackMessage = t('previewLoadFailed'); }

  const detail = {
    title: parsed.title || item.title || item.id,
    type: parsed.type || item.type || '-',
    status: parsed.status || '-',
    tags: Array.isArray(parsed.tags) ? parsed.tags : (item.tags || []),
    updated_at: parsed.updated_at || '-',
    summary: parsed.summary || item.title || '',
  };
  const content = extractPreviewContent(detail, parsed);
  if(content.fallback && !fallbackMessage) fallbackMessage = t('previewNoBody');

  dlg.innerHTML = `<form method="dialog" class="modal-inner">
    <header class="modal-head"><h3>${esc(t('previewModalTitle'))}</h3><button class="ghost">${esc(t('close'))}</button></header>
    <div class="meta-grid">
      <div><b>${esc(t('title'))}</b><span>${esc(detail.title)}</span></div>
      <div><b>${esc(t('type'))}</b><span>${esc(detail.type)}</span></div>
      <div><b>${esc(t('status'))}</b><span>${esc(detail.status)}</span></div>
      <div><b>${esc(t('updatedAt'))}</b><span>${esc(detail.updated_at)}</span></div>
      <div><b>${esc(t('tags'))}</b><span>${esc((detail.tags||[]).join(', '))}</span></div>
    </div>
    <section class="card soft"><h4>${esc(t('summary'))}</h4><p>${esc(detail.summary || '-')}</p></section>
    <section class="card soft"><h4>${esc(t('content'))}</h4><div id="previewBody" class="preview-body"></div></section>
    ${fallbackMessage?`<p class="small warn">${esc(fallbackMessage)}</p>`:''}
  </form>`;
  const body = dlg.querySelector('#previewBody');
  body.replaceChildren(simplifyMarkdown(content.body || detail.summary || '-'));
  dlg.showModal();
}

function renderBuilder(){
  const ids = Object.keys(STATE.ratings).sort();
  const box = document.getElementById('builderOutput');
  if(!box) return;
  if(!ids.length){ box.textContent = t('noRatingsYet'); return; }
  const lines = ids.map(id => JSON.stringify({ id, score: STATE.ratings[id].score, ts: STATE.ratings[id].updated_at }));
  const command = [t('commandDraft'), ...lines, t('commandEnd'), '', t('logSnippet'), ...lines].join('\n');
  box.textContent = command;
}

function setRating(item, score){
  const existed = Boolean(STATE.ratings[item.id]);
  STATE.ratings[item.id] = {
    score,
    path: item.path,
    title: item.title,
    due_at: item.due_at,
    updated_at: new Date().toISOString(),
  };
  persistRatings();
  renderBuilder();
  toast(`${existed ? t('ratingUpdated') : t('joinedQueue')}: ${item.id} = ${score}`, 'success');
}

function scoreButtons(item){
  const selected = STATE.ratings[item.id]?.score;
  return [1,2,3,4,5].map(n=>`<button class="score ${selected===n?'selected':''}" data-id="${esc(item.id)}" data-score="${n}" aria-label="score ${n}">${n}</button>`).join('');
}

async function pageIndex(){
  setHeaderTitle(t('indexTitle'));
  document.getElementById('app').innerHTML = shell(t('indexTitle'));
  wireGlobalToggles();
  try{
    const data = await loadJSON('index.json');
    const byType={}, byStatus={};
    for(const o of data){ byType[o.type]=(byType[o.type]||0)+1; byStatus[o.status]=(byStatus[o.status]||0)+1; }
    document.getElementById('content').innerHTML =
      `<h3>${esc(t('byType'))}</h3><div class="grid">${Object.entries(byType).map(([k,v])=>`<article class="card stat"><span>${esc(k)}</span><strong>${v}</strong></article>`).join('')}</div>`+
      `<h3>${esc(t('byStatus'))}</h3><div class="grid">${Object.entries(byStatus).map(([k,v])=>`<article class="card stat"><span>${esc(k)}</span><strong>${v}</strong></article>`).join('')}</div>`;
    if(!data.length) document.getElementById('content').innerHTML += emptyState(t('noObjects'), t('noObjectsHint'));
  }catch(detail){ renderLoadError('index', detail); }
}

async function pageObjects(){
  setHeaderTitle(t('objectsTitle'));
  document.getElementById('app').innerHTML = shell(t('objectsTitle'));
  wireGlobalToggles();
  try{
    const data = await loadJSON('index.json');
    document.getElementById('content').innerHTML = `<section class="card filters">
      <label>${esc(t('filterType'))}<select id="fType"><option value="">${esc(t('all'))}</option><option>fact</option><option>skill</option><option>claim</option><option>creative</option></select></label>
      <label>${esc(t('filterStatus'))}<input id="fStatus" placeholder="status"></label>
      <label>${esc(t('filterTags'))}<input id="fTags" placeholder="tag"></label>
      <button id="apply">${esc(t('apply'))}</button>
    </section>
    <section class="card"><table><thead><tr><th>${esc(t('id'))}</th><th>${esc(t('type'))}</th><th>${esc(t('status'))}</th><th>${esc(t('title'))}</th><th>${esc(t('tags'))}</th><th>${esc(t('path'))}</th></tr></thead><tbody id="rows"></tbody></table></section>
    <aside class="card create-panel"><h3>${esc(t('createPanelTitle'))}</h3><p class="small">${esc(t('createHint'))}</p>
      <select id="cType"><option>fact</option><option>skill</option><option>claim</option><option>creative</option></select>
      <div class="row"><button id="gen">${esc(t('generate'))}</button><button id="copy">${esc(t('copy'))}</button><button id="down">${esc(t('download'))}</button></div><pre id="tpl" class="small"></pre>
    </aside>`;

    const templates = {
      fact:`id: fact.new\ntype: fact\nstatus: raw\ntitle: \"\"\nsummary: \"\"\nsource: []\nanchors: []\ncreated_at: \"\"\nupdated_at: \"\"\n`,
      skill:`id: skill.new\ntype: skill\nstatus: raw\ntitle: \"\"\nsummary: \"\"\nsource: []\nanchors: []\ncreated_at: \"\"\nupdated_at: \"\"\n`,
      claim:`id: claim.new\ntype: claim\nstatus: raw\ntitle: \"\"\nsummary: \"\"\nsource: []\nanchors: []\ncreated_at: \"\"\nupdated_at: \"\"\n`,
      creative:`id: creative.new\ntype: creative\nstatus: draft\ntitle: \"\"\nsummary: \"\"\ncreated_at: \"\"\nupdated_at: \"\"\ntags: []\n`
    };

    function render(){
      const tt=document.getElementById('fType').value.trim();
      const st=document.getElementById('fStatus').value.trim().toLowerCase();
      const tg=document.getElementById('fTags').value.trim().toLowerCase();
      const rows = data.filter(o=>(!tt||o.type===tt)&&(!st||String(o.status).toLowerCase().includes(st))&&(!tg||(o.tags||[]).join(',').toLowerCase().includes(tg)))
        .map(o=>`<tr><td>${esc(o.id)}</td><td><span class="chip">${esc(o.type)}</span></td><td>${esc(o.status)}</td><td>${esc(o.title)}</td><td>${esc((o.tags||[]).join(','))}</td><td class="small">${esc(o.path)}</td></tr>`).join('');
      document.getElementById('rows').innerHTML = rows || `<tr><td colspan="6">${esc(t('noMatched'))}</td></tr>`;
    }
    document.getElementById('apply').onclick = render;
    document.getElementById('gen').onclick = ()=>{ const tp=document.getElementById('cType').value; document.getElementById('tpl').textContent = templates[tp]; toast(t('generate'), 'info'); };
    document.getElementById('copy').onclick = async ()=>{ try{ await navigator.clipboard.writeText(document.getElementById('tpl').textContent || ''); toast(t('copied'), 'success'); }catch{ toast(t('copyFailed'),'error'); } };
    document.getElementById('down').onclick = ()=>{ const tp=document.getElementById('cType').value; downloadText(`${tp}_template.yaml`, document.getElementById('tpl').textContent||''); toast(t('download'),'success'); };
    render(); document.getElementById('gen').click();
    if(!data.length) document.getElementById('content').innerHTML = emptyState(t('noObjects'), t('noObjectsHint'));
  }catch(detail){ renderLoadError('objects', detail); }
}

function toReviewRows(arr){
  return arr.map(x=>`<tr data-id="${esc(x.id)}"><td>${esc(x.id)}</td><td>${esc(x.title)}</td><td>${esc(x.due_at)}</td><td class="small">${esc(x.path)}</td>
    <td><div class="scores">${scoreButtons(x)}</div></td><td><button class="preview-btn" data-preview="${esc(x.id)}">${esc(t('preview'))}</button></td></tr>`).join('') || `<tr><td colspan="6">${esc(t('noQueue'))}</td></tr>`;
}

async function pageReview(){
  setHeaderTitle(t('reviewTitle'));
  document.getElementById('app').innerHTML = shell(t('reviewTitle'));
  wireGlobalToggles();
  loadRatings();
  try{
    const data = await loadJSON('queues.json');
    const items = [...(data.daily||[]), ...(data.weekly||[])];
    const byId = Object.fromEntries(items.map(i=>[i.id, i]));
    document.getElementById('content').innerHTML = `<div class="card warn">${esc(t('reviewReadonly'))}</div>
    <div class="card"><h3>${esc(t('daily'))}</h3><table><thead><tr><th>${esc(t('id'))}</th><th>${esc(t('title'))}</th><th>${esc(t('dueAt'))}</th><th>${esc(t('path'))}</th><th>${esc(t('score'))}</th><th>${esc(t('actions'))}</th></tr></thead><tbody>${toReviewRows(data.daily||[])}</tbody></table></div>
    <div class="card"><h3>${esc(t('weekly'))}</h3><table><thead><tr><th>${esc(t('id'))}</th><th>${esc(t('title'))}</th><th>${esc(t('dueAt'))}</th><th>${esc(t('path'))}</th><th>${esc(t('score'))}</th><th>${esc(t('actions'))}</th></tr></thead><tbody>${toReviewRows(data.weekly||[])}</tbody></table></div>
    <div class="card"><h3>${esc(t('builderTitle'))}</h3><p class="small">${esc(t('builderHint'))}</p>
      <div class="row"><button id="copyAll">${esc(t('copyAll'))}</button><button id="clearAll">${esc(t('clear'))}</button></div>
      <pre id="builderOutput" class="small"></pre>
    </div>`;

    document.querySelectorAll('.score').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const row = btn.closest('tr');
        const id = row?.dataset.id;
        const item = byId[id];
        if(!item) return;
        setRating(item, Number(btn.dataset.score));
        row.querySelectorAll('.score').forEach(b=>b.classList.toggle('selected', b===btn));
      });
    });

    document.querySelectorAll('.preview-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.dataset.preview;
        const item = byId[id];
        if(item) openPreview(item);
      });
    });

    document.getElementById('copyAll').onclick = async ()=>{
      try{ await navigator.clipboard.writeText(document.getElementById('builderOutput').textContent || ''); toast(t('copied'),'success'); }
      catch{ toast(t('copyFailed'),'error'); }
    };
    document.getElementById('clearAll').onclick = ()=>{ STATE.ratings = {}; persistRatings(); renderBuilder(); toast(t('cleared'),'info'); document.querySelectorAll('.score.selected').forEach(x=>x.classList.remove('selected')); };

    renderBuilder();
  }catch(detail){ renderLoadError('review', detail); }
}

async function pageDigests(){
  setHeaderTitle(t('digestsTitle'));
  document.getElementById('app').innerHTML = shell(t('digestsTitle'));
  wireGlobalToggles();
  try{
    const data = await loadJSON('digests.json');
    const rows = [...data].sort((a,b)=>String(b.week).localeCompare(String(a.week)))
      .map(d=>`<tr><td>${esc(d.week)}</td><td>${esc(d.title)}</td><td>${esc(d.entry_count)}</td><td class="small">${esc((d.references||[]).join(','))}</td><td class="small">${esc(d.path)}</td></tr>`).join('') || `<tr><td colspan="5">${esc(t('noDigests'))}</td></tr>`;
    document.getElementById('content').innerHTML = `<div class="card"><table><thead><tr><th>week</th><th>${esc(t('title'))}</th><th>${esc(t('entries'))}</th><th>${esc(t('references'))}</th><th>${esc(t('path'))}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }catch(detail){ renderLoadError('digests', detail); }
}

initLang();
initTheme();
