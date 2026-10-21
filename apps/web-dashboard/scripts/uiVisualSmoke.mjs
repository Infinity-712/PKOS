import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createUiPreview } from "./uiPreview.mjs";

const { chromium } = await import(process.env.PKOS_PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PKOS_PLAYWRIGHT_MODULE)).href : "playwright");
const output = resolve(process.env.PKOS_SCREENSHOT_DIR ?? join(tmpdir(), "pkos-ui-screenshots"));
await mkdir(output, { recursive: true });
const { server, url } = await createUiPreview();
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const app of ["web", "desktop"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const pageErrors = [];
    const externalRequests = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => { if (!request.url().startsWith(url)) externalRequests.push(request.url()); });
    await page.goto(url + (app === "desktop" ? "/desktop/" : "/"));
    await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
    await page.waitForTimeout(350);
    const shot = async (name) => page.screenshot({ path: join(output, `${app}-${name}.png`), fullPage: true });
    await shot("zh-wide");
    const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${app}: document overflow at ${page.viewportSize().width}px`);
    if (app === "desktop") {
      await page.locator(".message-bubble").first().waitFor();
      assert((await page.locator(".message-stream").innerText()).includes("今天想把节奏放慢一点"));
      const draft = page.locator(".composer textarea");
      await draft.fill("保留我的输入 / Keep this draft");
      await page.getByRole("button", { name: "EN", exact: true }).click();
      assert.equal(await draft.inputValue(), "保留我的输入 / Keep this draft");
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      await page.locator('[data-nav="capture"]').click();
      await page.locator('[data-nav="agent"]').click();
      await page.locator(".message-bubble").first().waitFor();
      assert((await page.locator(".message-stream").innerText()).includes("今天想把节奏放慢一点"));
      await page.locator(".session-row").nth(1).click();
      await page.waitForFunction(() => document.querySelector(".message-stream")?.textContent.includes("读书的时候"));
      assert(!(await page.locator(".message-stream").innerText()).includes("今天想把节奏放慢一点"));
      await draft.fill("A new thought");
      await draft.press("Shift+Enter");
      assert((await draft.inputValue()).includes("\n"));
      const countBefore = await page.evaluate(() => window.__previewRequests.filter((request) => request.path === "/api/chat/send").length);
      await draft.press("Enter");
      await draft.press("Enter");
      await page.waitForTimeout(1200);
      assert.equal(await page.evaluate(() => window.__previewRequests.filter((request) => request.path === "/api/chat/send").length), countBefore + 1);
      assert((await page.locator(".message-stream").innerText()).includes("本地预览回复"));
      await page.getByRole("button", { name: "中文", exact: true }).click();
      await page.locator(".session-row").first().click();
      console.log("BILINGUAL_DESKTOP_CHAT_SMOKE_OK");
    } else {
      await page.getByRole("button", { name: "EN", exact: true }).click();
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      assert.equal(await page.locator(".page-title h1").innerText(), "Overview");
      await page.reload();
      await page.waitForFunction(() => document.documentElement.lang === "en");
      assert.equal(await page.locator(".page-title h1").innerText(), "Overview");
      console.log("BILINGUAL_WEB_RELOAD_SMOKE_OK");
      await page.getByRole("button", { name: "中文", exact: true }).click();
      await page.locator('[data-nav="actions"]').click();
      assert.notEqual(await page.locator('select option[value="running"]').innerText(), "running", "Chinese action filter must localize status labels");
    }
    const tabs = app === "web" ? ["overview", "objects", "review", "tasks", "reminders", "capture", "state", "inboxReview", "actions", "audit"] : ["agent", "capture", "status"];
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const locale of ["zh-CN", "en"]) {
        await page.getByRole("button", { name: locale === "en" ? "EN" : "中文", exact: true }).click();
        for (const tab of tabs) {
          await page.locator(`[data-nav="${tab}"]`).click();
          await page.waitForTimeout(90);
          if (app === "web" && tab === "objects") { await page.locator(".object-list-item").first().click(); await page.waitForTimeout(100); }
          if (app === "web" && tab === "actions") { await page.locator("tbody tr").first().click(); await page.locator(".resolution-form").waitFor(); }
          if (app === "web" && tab === "tasks") {
            await page.locator(".task-due-trigger button").first().click();
            await noOverflow();
            const picker = page.locator(".task-due-popover").first();
            const bounds = await picker.boundingBox();
            assert(bounds.x >= 0 && bounds.x + bounds.width <= width, "Date picker exceeds viewport");
            await shot(`${locale}-calendar-${width}`);
            await picker.getByRole("button", { name: locale === "en" ? "Close" : "关闭", exact: true }).click();
          }
          await noOverflow();
          if ((width === 1440 || width === 390) && ["overview", "objects", "review", "agent", "capture"].includes(tab)) await shot(`${locale}-${tab}-${width}`);
        }
      }
    }
    assert.deepEqual(await page.evaluate(() => window.__previewUnexpected), [], "Unexpected mock request");
    assert.deepEqual(pageErrors, [], `${app}: runtime exceptions`);
    assert.deepEqual(externalRequests, [], "Preview contacted an external or production endpoint");
    if (app === "desktop") {
      const ratios = await page.evaluate(() => {
        function luminance(color) { const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((n) => n / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4); return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]; }
        return ["badge warn", "badge bad", "notice"].map((className) => { const node = document.createElement("span"); node.className = className; node.textContent = "Safety"; document.body.append(node); const style = getComputedStyle(node); const a = luminance(style.color); const b = luminance(style.backgroundColor); node.remove(); return { className, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }; });
      });
      assert(ratios.every(({ ratio }) => ratio >= 4.5), `Safety text contrast: ${JSON.stringify(ratios)}`);
    }
    assert.deepEqual(await page.evaluate(() => Object.keys(window.localStorage)), ["pkos.ui.locale"], "Business data was cached");
    await context.close();
  }
  console.log(`BILINGUAL_RESPONSIVE_UI_SMOKE_OK screenshots=${output}`);
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
