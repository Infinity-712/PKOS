import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { childEnvironment } from './environment.mjs';
import { build, mobileRoot } from './build.mjs';

// Imports of server code and browser launch both happen in a secret-free child.
if (!process.argv.includes('--worker')) {
  build(true);
  const result = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--worker'], {
    cwd: mobileRoot, stdio: 'inherit', shell: false, timeout: 120_000,
    env: { ...childEnvironment(), ...(process.env.MOBILE_BROWSER_PATH ? { MOBILE_BROWSER_PATH: process.env.MOBILE_BROWSER_PATH } : {}) },
  });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
} else {
  const { startMobileCompatServer } = await import(pathToFileURL(resolve(mobileRoot, '../agent-server/src/scripts/mobileCompatServer.ts')).href);
  const root = resolve(mobileRoot, 'dist');
  const web = createServer((req, res) => {
    const path = resolve(root, '.' + new URL(req.url ?? '/', 'http://127.0.0.1').pathname.replace(/\/$/, '/index.html'));
    if (!path.startsWith(root + sep) || !existsSync(path)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' })[extname(path)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(readFileSync(path));
  });
  let fixture;
  let browser;
  const output = resolve(mobileRoot, 'test-results');
  mkdirSync(output, { recursive: true });
  try {
    await new Promise((ok, no) => { web.once('error', no); web.listen(5185, '127.0.0.1', ok); });
    fixture = await startMobileCompatServer({ port: 18790, browserOrigin: 'http://127.0.0.1:5185' });
    let executablePath = process.env.MOBILE_BROWSER_PATH ?? chromium.executablePath();
    if (!existsSync(executablePath)) {
      const cache = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
      const installed = existsSync(cache) ? readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
      executablePath = installed.map(name => join(cache, name, 'chrome-win64/chrome.exe')).find(path => existsSync(path));
    }
    if (!executablePath) throw new Error('BROWSER_TEST_BLOCKED: install Playwright Chromium or set MOBILE_BROWSER_PATH');
    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const pageErrors = [];
    const violations = [];
    let posts = 0;
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/chat/send')) posts++; });
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', event => window.__cspViolations.push(event.violatedDirective));
    });
    const wait = async (fn, argument) => {
      try { return await page.waitForFunction(fn, argument, { timeout: 15_000 }); }
      catch (error) {
        console.error(JSON.stringify({ pageErrors, text: (await page.locator('body').innerText()).slice(0, 1600), csp: await page.evaluate(() => window.__cspViolations) }));
        await page.screenshot({ path: join(output, 'failure.png') });
        throw error;
      }
    };
    const send = async (text, scenario = 'normal') => {
      await page.getByLabel('模拟场景', { exact: true }).selectOption(scenario);
      await page.getByLabel('消息', { exact: true }).fill(text);
      await page.getByTestId('send').click();
    };
    const finished = async () => wait(() => document.querySelector('[data-testid="stream-status"]')?.textContent === '已完成');
    await page.goto('http://127.0.0.1:5185');
    await wait(() => document.querySelector('[data-testid="connection-status"]')?.textContent.includes('已连接'));
    assert.ok((await page.locator('body').innerText()).includes('兼容性测试 / 使用合成数据 / 不调用真实模型'));
    await page.screenshot({ path: join(output, 'connection-393.png') });
    await page.getByRole('button', { name: '切换为英文' }).click();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    await page.getByRole('button', { name: 'Switch to Chinese' }).click();
    await page.getByTestId('nav-chat').click();
    await page.getByLabel('合成会话').selectOption({ label: 'A: synthetic reading' });
    await wait(() => document.querySelector('[data-testid="messages"]')?.textContent.includes('READING_ONLY'));
    assert.ok(!(await page.getByTestId('messages').innerText()).includes('WRITING_ONLY'));
    const input = page.getByLabel('消息', { exact: true });
    await input.fill('中文输入');
    await input.dispatchEvent('compositionstart');
    assert.equal(await page.getByTestId('send').isDisabled(), true);
    await input.press('Enter');
    assert.equal(posts, 0);
    assert.ok((await input.inputValue()).includes('\n'));
    await input.dispatchEvent('compositionend');
    await page.getByTestId('send').evaluate(button => { button.click(); button.click(); });
    await wait(() => document.querySelector('[data-testid="messages"]')?.textContent.includes('第一段'));
    const intermediate = await page.getByTestId('messages').innerText();
    assert.ok(!intermediate.includes('PKOS_MOBILE_STREAM_OK'), 'stream must be visible before completion');
    assert.equal(posts, 1);
    await finished();
    assert.match(await page.getByTestId('messages').innerText(), /emoji 🙂/);
    assert.equal(await input.inputValue(), '', 'double tap must not restore the sent draft');
    await page.screenshot({ path: join(output, 'chat-393.png') });
    await page.getByLabel('合成会话').selectOption({ label: 'B: synthetic writing' });
    await wait(() => document.querySelector('[data-testid="messages"]')?.textContent.includes('WRITING_ONLY'));
    assert.ok(!(await page.getByTestId('messages').innerText()).includes('READING_ONLY'));
    assert.ok(!(await page.getByTestId('messages').innerText()).includes('PKOS_MOBILE_STREAM_OK'));
    await page.getByLabel('合成会话').selectOption({ label: 'A: synthetic reading' });
    await wait(() => document.querySelector('[data-testid="messages"]')?.textContent.includes('PKOS_MOBILE_STREAM_OK'));
    await page.getByTestId('nav-history').click();
    await wait(() => document.querySelector('[data-testid="history-page"]')?.textContent.includes('PKOS_MOBILE_STREAM_OK'));
    assert.equal(await page.locator('[data-message-id^="local:"]').count(), 0);
    await page.reload();
    await wait(() => document.querySelector('[data-testid="connection-status"]')?.textContent.includes('已连接'));
    await page.getByTestId('nav-chat').click();
    await wait(() => document.querySelector('[data-testid="messages"]')?.textContent.includes('PKOS_MOBILE_STREAM_OK'));
    assert.equal(posts, 1, 'reconstruction never sends a chat');

    // Long synthetic input makes the transcript scrollable without seeding browser-local history.
    await send(Array(22).fill('用于滚动验收的合成文本').join('\n'), 'slow');
    await wait(() => document.querySelector('[data-testid="stream-status"]')?.textContent === '正在回复');
    await page.getByTestId('messages').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
    await wait(() => document.querySelectorAll('.message.assistant').length >= 3);
    assert.equal(await page.getByTestId('messages').evaluate(element => element.scrollTop), 0, 'stream must not steal reading position');
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await wait(() => document.querySelector('[data-testid="stream-status"]')?.textContent === '服务器已确认取消');

    await send('合成流内失败', 'failed');
    await wait(() => document.querySelector('[data-testid="stream-status"]')?.textContent === '未完成');
    await send('合成尾行截断', 'truncated');
    await wait(() => document.querySelector('[data-testid="stream-status"]')?.textContent === '结果待核对');
    assert.ok((await page.locator('body').innerText()).includes('本版尚不支持中途续传'));
    const afterBroken = posts;
    await page.reload();
    await wait(() => document.querySelector('[data-testid="connection-status"]')?.textContent.includes('已连接'));
    await page.getByTestId('nav-chat').click();
    assert.equal(posts, afterBroken, 'broken stream restore must never re-POST');
    await send('合成连接中断', 'disconnect');
    await wait(() => document.querySelector('[data-testid="stream-status"]')?.textContent === '结果待核对');
    const beforeOffline = posts;
    await context.setOffline(true);
    await page.getByTestId('nav-connection').click();
    await page.getByRole('button', { name: '重新核验连接' }).click();
    await wait(() => document.querySelector('[data-testid="connection-status"]')?.textContent.includes('连接失败'));
    await context.setOffline(false);
    await page.getByRole('button', { name: '重新核验连接' }).click();
    await wait(() => document.querySelector('[data-testid="connection-status"]')?.textContent.includes('已连接'));
    assert.equal(posts, beforeOffline);

    const storage = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, JSON.parse(localStorage.getItem(key))])));
    assert.equal(Object.keys(storage).length, 1);
    const value = Object.values(storage)[0];
    assert.ok(Object.keys(value).every(key => ['language', 'baseUrl', 'fixtureId', 'lastSessionId', 'pending'].includes(key)));
    assert.ok(!JSON.stringify(storage).includes('中文输入'));
    assert.equal(await page.evaluate(() => sessionStorage.length), 0);
    const oldFixture = fixture.fixtureId;
    await fixture.close();
    fixture = await startMobileCompatServer({ port: 18790, browserOrigin: 'http://127.0.0.1:5185' });
    assert.notEqual(fixture.fixtureId, oldFixture);
    await page.getByRole('button', { name: '重新核验连接' }).click();
    await wait(() => document.body.textContent.includes('已切换测试数据集'));
    assert.equal(posts, beforeOffline);
    await page.getByTestId('nav-chat').click();
    assert.ok(!(await page.getByTestId('messages').innerText()).includes('合成尾行截断'));

    let unblock;
    let announce;
    const blocked = new Promise(resolve => { unblock = resolve; });
    const intercepted = new Promise(resolve => { announce = resolve; });
    await page.route('**/__mobile_compat__/info', async route => { announce(); await blocked; await route.abort('failed'); });
    await input.fill('A 的旧草稿');
    await page.getByTestId('send').click();
    await intercepted;
    await page.getByLabel('合成会话').selectOption({ label: 'B: synthetic writing' });
    await input.fill('B 的新草稿');
    unblock();
    await wait(() => Boolean(document.querySelector('[data-testid="send"]')));
    assert.equal(await input.inputValue(), 'B 的新草稿', 'late verification failure cannot overwrite another session draft');
    await page.unroute('**/__mobile_compat__/info');
    for (const [width, height] of [[360, 740], [852, 393], [1100, 800]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const box = await page.getByTestId('send').boundingBox();
      await page.screenshot({ path: join(output, `chat-${width}.png`) });
      assert.ok(box && box.y >= 0 && box.y + box.height <= height, `composer must remain visible: ${JSON.stringify({ width, height, box })}`);
    }
    violations.push(...await page.evaluate(() => window.__cspViolations));
    assert.deepEqual(violations, []);
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ result: 'MOBILE_BROWSER_SMOKE_OK', browser: browser.version(), browserOnly: true, realDeviceVerified: false, posts, screenshots: output }));
  } finally {
    await browser?.close();
    web.closeAllConnections();
    await new Promise(ok => web.close(ok));
    await fixture?.close();
  }
}
