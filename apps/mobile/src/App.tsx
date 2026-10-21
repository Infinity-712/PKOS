import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { Cable, Check, ChevronDown, History, Languages, MessageCircle, RefreshCw, Send, ShieldCheck, Square, WifiOff } from 'lucide-react';
import { formatDateTime } from '@pkos/agent-client';
import { COMPAT_SCENARIOS, type CompatScenario } from './compatClient.js';
import { probeCapabilities } from './diagnostics.js';
import { manageNativeListeners } from './lifecycle.js';
import { canSubmit, type MobileStore, type ViewStatus } from './store.js';

type Page = 'connection' | 'chat' | 'history';
const labels = {
  zh: { connection: '连接', chat: '模拟聊天', history: '合成历史', ready: '已连接', connecting: '核验中', disconnected: '未连接', error: '连接失败', suspended: '已暂停', idle: '就绪', loading: '正在读取', sending: '正在发送', streaming: '正在回复', completed: '已完成', failed: '未完成', aborted: '服务器已确认取消', unknown: '结果待核对', normal: '正常中文流', slow: '慢速流', truncated: '不完整尾行', disconnect: '连接中断' },
  en: { connection: 'Connection', chat: 'Mock chat', history: 'History', ready: 'Connected', connecting: 'Verifying', disconnected: 'Disconnected', error: 'Connection failed', suspended: 'Suspended', idle: 'Ready', loading: 'Loading', sending: 'Sending', streaming: 'Replying', completed: 'Completed', failed: 'Failed', aborted: 'Server confirmed cancellation', unknown: 'Result unverified', normal: 'Chinese stream', slow: 'Slow stream', truncated: 'Truncated line', disconnect: 'Disconnect' },
};

export function App({ store }: { store: MobileStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [page, setPage] = useState<Page>('connection');
  const [address, setAddress] = useState(`http://127.0.0.1:${__COMPAT_PORT__}`);
  const [draft, setDraft] = useState('');
  const [composing, setComposing] = useState(false);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [scenario, setScenario] = useState<CompatScenario>('normal');
  const [addressError, setAddressError] = useState(false);
  const [newContent, setNewContent] = useState(false);
  const composeRef = useRef(false);
  const sendGate = useRef(false);
  const draftRevision = useRef(0);
  const pageRef = useRef(page);
  const keyboardOpen = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const zh = state.locale === 'zh';
  const t = labels[state.locale];
  const choose = (cn: string, en: string) => zh ? cn : en;
  const capabilities = probeCapabilities();
  const supported = capabilities.every(item => item.supported);
  const view = state.selectedId ? state.views[state.selectedId] : undefined;
  const messages = view?.messages ?? [];
  const busy = sending || view?.status === 'sending' || view?.status === 'streaming';
  const session = state.sessions.find(item => item.id === state.selectedId);
  pageRef.current = page;

  useEffect(() => {
    document.documentElement.lang = zh ? 'zh-CN' : 'en';
  }, [zh]);
  useEffect(() => {
    if (supported && __COMPAT_DEBUG__) void store.connect();
    const visibility = () => { if (document.hidden) store.suspend(); else if (supported && __COMPAT_DEBUG__) void store.resume(); };
    const resize = () => { document.documentElement.style.setProperty('--app-height', `${window.visualViewport?.height ?? window.innerHeight}px`); };
    resize();
    document.addEventListener('visibilitychange', visibility);
    window.visualViewport?.addEventListener('resize', resize);
    window.addEventListener('resize', resize);
    let release = () => {};
    if (Capacitor.isNativePlatform()) release = manageNativeListeners([
      NativeApp.addListener('appStateChange', ({ isActive }) => { if (isActive && supported && __COMPAT_DEBUG__) void store.resume(); else store.suspend(); }),
      NativeApp.addListener('backButton', () => {
        if (keyboardOpen.current || document.activeElement === textarea.current) {
          textarea.current?.blur(); void Keyboard.hide().catch(() => undefined);
        } else if (pageRef.current !== 'connection') setPage('connection');
        else void NativeApp.minimizeApp();
      }),
      Keyboard.addListener('keyboardDidShow', () => { keyboardOpen.current = true; resize(); }),
      Keyboard.addListener('keyboardDidHide', () => { keyboardOpen.current = false; resize(); }),
    ]);
    return () => {
      release(); store.suspend();
      document.removeEventListener('visibilitychange', visibility);
      window.visualViewport?.removeEventListener('resize', resize);
      window.removeEventListener('resize', resize);
    };
  }, [store, supported]);
  useEffect(() => { draftRevision.current++; setDraft(''); composeRef.current = false; setComposing(false); stick.current = true; setNewContent(false); }, [state.selectedId, state.fixture?.fixtureId]);
  useEffect(() => {
    const element = scroller.current;
    if (!element || page !== 'chat') return;
    if (stick.current) { element.scrollTop = element.scrollHeight; setNewContent(false); }
    else setNewContent(true);
  }, [messages, page]);

  function navigate(next: Page) {
    setPage(next);
    if (next === 'history' && state.selectedId) void store.selectSession(state.selectedId);
  }
  function reconnect() {
    const correct = address.replace(/\/$/, '') === `http://127.0.0.1:${__COMPAT_PORT__}`;
    setAddressError(!correct);
    if (correct && supported && __COMPAT_DEBUG__) void store.connect(address);
  }
  async function send() {
    if (sendGate.current || !canSubmit(draft, composeRef.current, busy) || state.connection !== 'ready' || state.pending) return;
    sendGate.current = true;
    setSending(true);
    const text = draft;
    const revision = ++draftRevision.current;
    const origin = { sessionId: state.selectedId, fixtureId: state.fixture?.fixtureId };
    setDraft('');
    try {
      const result = await store.send(text, scenario);
      const current = store.getSnapshot();
      if ((result === 'blocked' || result === 'busy') && draftRevision.current === revision
        && current.selectedId === origin.sessionId && current.fixture?.fixtureId === origin.fixtureId) setDraft(text);
    } finally { sendGate.current = false; setSending(false); }
  }
  async function stop() { setStopping(true); try { await store.stop(); } finally { setStopping(false); } }
  const statusName = (status: ViewStatus) => t[status];

  return <div className="mobile-shell">
    <header className="app-header">
      <div className="brand"><span className="brand-mark" aria-hidden="true"><MessageCircle size={21} /></span><div><strong>PKOS Mobile</strong><span>{choose('测试工作台', 'Compatibility lab')}</span></div></div>
      <button className="icon-button language" onClick={() => store.setLanguage(zh ? 'en' : 'zh')} title={choose('切换为英文', 'Switch to Chinese')} aria-label={choose('切换为英文', 'Switch to Chinese')}><Languages size={19} /><span>{zh ? 'EN' : '中'}</span></button>
    </header>
    <div className="test-banner"><ShieldCheck size={16} /><span>{choose('兼容性测试 / 使用合成数据 / 不调用真实模型', 'Compatibility test / Synthetic data / No real models')}</span></div>
    {!supported && <div role="alert" className="notice error">{choose('WebView 缺少必要能力：', 'Missing WebView capabilities: ')}{capabilities.filter(item => !item.supported).map(item => item.name).join(', ')}</div>}
    {!__COMPAT_DEBUG__ && <div role="alert" className="notice">{choose('此构建未启用测试网络。', 'Test networking is disabled in this build.')}</div>}
    {state.fixtureChanged && <div role="status" className="notice">{choose('已切换测试数据集，旧视图与未决指针已清除。', 'Test dataset changed. Previous views and pending pointers cleared.')}</div>}

    {page === 'connection' && <main className="page connection-page" data-testid="connection-page">
      <div className="page-title"><span className="eyebrow">01 / CONNECTION</span><h1>{choose('连接测试环境', 'Test connection')}</h1></div>
      <div className={`connection-status ${state.connection}`} data-testid="connection-status"><span className="status-dot" />{t[state.connection]}<span className="mode-label">SYNTHETIC</span></div>
      <label className="field">{choose('测试服务地址', 'Test server address')}<input type="url" inputMode="url" spellCheck={false} autoCapitalize="none" value={address} onChange={event => setAddress(event.target.value)} aria-label={choose('测试服务地址', 'Test server address')} /></label>
      <button className="primary full" onClick={reconnect} disabled={state.connection === 'connecting' || !supported || !__COMPAT_DEBUG__}><RefreshCw size={17} />{choose('重新核验连接', 'Verify connection')}</button>
      {(state.error || addressError) && <div role="alert" className="notice error"><WifiOff size={17} /><div>{addressError ? choose(`本构建仅允许测试端口 ${__COMPAT_PORT__}。`, `This build only permits test port ${__COMPAT_PORT__}.`) : choose('未通过测试实例校验，请检查隔离服务与 USB 连接。', 'Test identity check failed. Check the isolated server and USB connection.')}<code>{state.error}</code></div></div>}
      <section className="details-section"><h2>{choose('服务身份', 'Service identity')}</h2><dl>
        <dt>{choose('服务', 'Service')}</dt><dd>{state.runtime?.service.name ?? '—'}</dd>
        <dt>{choose('数据集', 'Fixture')}</dt><dd className="mono">{state.fixture?.fixtureId ?? '—'}</dd>
        <dt>{choose('版本 / 模式', 'Version / mode')}</dt><dd>{state.fixture ? `${state.fixture.fixtureVersion} / ${state.fixture.mode}` : '—'}</dd>
        <dt>Provider</dt><dd>{state.provider?.selection.providerDisplayName ?? '—'}</dd>
        <dt>{choose('数据外发', 'Data egress')}</dt><dd>{state.provider?.dataEgress === 'none' ? choose('无', 'None') : '—'}</dd>
        <dt>Origin</dt><dd className="mono">{location.origin}</dd>
        <dt>{choose('运行环境', 'Environment')}</dt><dd>{Capacitor.isNativePlatform() ? 'Android WebView' : choose('浏览器预览，非真机验收', 'Browser preview, not device verification')}</dd>
      </dl></section>
      <section className="details-section"><h2>{choose('兼容性诊断', 'Compatibility checks')}</h2><ul className="capabilities">{capabilities.map(item => <li key={item.name}><span>{item.name}</span>{item.supported ? <Check size={16} aria-label="OK" /> : <span>UNSUPPORTED</span>}</li>)}</ul><details><summary>User Agent</summary><p className="user-agent">{navigator.userAgent}</p></details></section>
    </main>}

    {(page === 'chat' || page === 'history') && <main className={`page ${page}-page`} data-testid={page === 'chat' ? 'chat-page' : 'history-page'}>
      <div className="conversation-header"><div><span className="eyebrow">{page === 'chat' ? '02 / MOCK CHAT' : '03 / SAVED HISTORY'}</span><h1>{page === 'chat' ? choose('聊一小段', 'A little conversation') : choose('已保存的对话', 'Saved conversations')}</h1></div>
        <button className="icon-button" title={choose('重新读取服务端历史', 'Reload server history')} aria-label={choose('重新读取服务端历史', 'Reload server history')} disabled={state.connection !== 'ready' || busy} onClick={() => { if (state.selectedId) void store.selectSession(state.selectedId); }}><RefreshCw size={18} /></button>
      </div>
      <div className="session-picker"><select aria-label={choose('合成会话', 'Synthetic session')} value={state.selectedId ?? ''} disabled={state.connection !== 'ready'} onChange={event => { void store.selectSession(event.target.value); }}><option value="" disabled>{choose('等待测试连接', 'Waiting for connection')}</option>{state.sessions.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><ChevronDown size={16} /></div>
      <div className="session-meta"><span>{state.connection === 'ready' ? 'Mock / Dry-run' : t[state.connection]}</span><span>{session ? formatDateTime(session.updated_at) : '—'} CST</span></div>
      <div className="messages" ref={scroller} data-testid="messages" onScroll={event => { const element = event.currentTarget; stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48; if (stick.current) setNewContent(false); }}>
        {(page === 'history' ? messages.filter(message => !message.id.startsWith('local:')) : messages).map(message => <article key={message.id} className={`message ${message.role}`} data-message-id={message.id} data-role={message.role}><div className="message-meta"><strong>{message.role === 'user' ? choose('你', 'You') : 'PKOS Mock'}</strong><span>{message.status === 'completed' ? formatDateTime(message.createdAt) : statusName(message.status)}</span></div><p>{message.content}</p></article>)}
        {messages.length === 0 && <div className="empty-view"><MessageCircle size={30} /><h2>{choose('等待合成历史', 'Awaiting synthetic history')}</h2></div>}
      </div>
      {newContent && page === 'chat' && <button className="new-content" onClick={() => { stick.current = true; if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; setNewContent(false); }}>{choose('查看新回复', 'New reply')}<ChevronDown size={15} /></button>}
      {(view?.status === 'unknown' || (state.pending && !busy)) && <div role="status" className="notice warning">{choose('结果待核对；本版尚不支持中途续传。', 'Result unverified; this version does not support stream resumption.')}</div>}
      {view?.status === 'failed' && <div role="alert" className="notice error">{choose('本次未完成，请核对服务端历史。', 'Not completed. Check saved server history.')}</div>}
      {page === 'chat' && <div className="composer">
        <div className="composer-top"><label>{choose('模拟场景', 'Scenario')}<select value={scenario} disabled={busy || Boolean(state.pending)} onChange={event => setScenario(event.target.value as CompatScenario)} aria-label={choose('模拟场景', 'Scenario')}>{COMPAT_SCENARIOS.map(value => <option key={value} value={value}>{value === 'failed' ? choose('流内失败', 'Stream failure') : t[value]}</option>)}</select></label><span data-testid="stream-status" className="stream-status">{statusName(view?.status ?? 'idle')}</span></div>
        <textarea ref={textarea} aria-label={choose('消息', 'Message')} placeholder={choose('写一句中文，试试流式回复…', 'Try a message…')} value={draft} rows={2} maxLength={4000} onChange={event => { draftRevision.current++; setDraft(event.target.value); }} onCompositionStart={() => { composeRef.current = true; setComposing(true); }} onCompositionEnd={() => { composeRef.current = false; setComposing(false); }} />
        <div className="composer-actions"><span>{choose('仅合成测试', 'Synthetic test only')}</span>{busy ? <button className="secondary" disabled={stopping} onClick={() => { void stop(); }}><Square size={15} />{choose(stopping ? '正在核对取消…' : '停止', stopping ? 'Checking cancellation…' : 'Stop')}</button> : <button className="primary" data-testid="send" disabled={!canSubmit(draft, composing, busy) || state.connection !== 'ready' || Boolean(state.pending)} onClick={() => { void send(); }}><Send size={17} />{choose('发送', 'Send')}</button>}</div>
      </div>}
    </main>}
    <nav className="bottom-nav" aria-label={choose('页面', 'Pages')}>{([{ id: 'connection', icon: Cable }, { id: 'chat', icon: MessageCircle }, { id: 'history', icon: History }] as const).map(({ id, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} data-testid={`nav-${id}`} onClick={() => navigate(id)}><Icon size={21} /><span>{t[id]}</span></button>)}</nav>
  </div>;
}
