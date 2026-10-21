import { build } from "esbuild";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export async function createUiPreview(port = 0) {
  const assets = new Map();
  for (const [name, root, main] of [["web", resolve(here, ".."), "src/main.tsx"], ["desktop", resolve(here, "../../desktop"), "src/renderer/main.tsx"]]) {
    const result = await build({ stdin: { contents: `import ${JSON.stringify(resolve(here, "uiFixtures.mjs").replaceAll("\\", "/"))}; import "./${main}";`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, outdir: "preview", format: "esm", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"', "import.meta.env.MODE": '"preview"' }, logLevel: "silent" });
    for (const output of result.outputFiles) assets.set(`/${name}.${output.path.endsWith(".css") ? "css" : "js"}`, output.contents);
  }
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (assets.has(path)) return response.writeHead(200, { "Content-Type": path.endsWith("css") ? "text/css" : "text/javascript" }).end(assets.get(path));
    if (path !== "/" && path !== "/desktop/" && path !== "/desktop") return response.writeHead(404).end("Not found");
    const name = path.startsWith("/desktop") ? "desktop" : "web";
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; font-src 'self'" }).end(`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PKOS Preview</title><link rel="stylesheet" href="/${name}.css"></head><body><div style="padding:5px 18px;background:#30383b;color:#cbd5d4;font:11px system-ui;text-align:center">设计预览 · 仅合成数据 · 无真实模型或写入 / Synthetic data only <a style="color:white;margin-left:14px" href="/">Web</a> <a style="color:white;margin-left:10px" href="/desktop/">Desktop</a></div><div id="root"></div><script type="module" src="/${name}.js"></script></body></html>`);
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", done); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, url } = await createUiPreview(Number(process.env.PKOS_PREVIEW_PORT ?? 5180));
  console.log(`PKOS_UI_PREVIEW ${url} ${url}/desktop/`);
  process.on("SIGTERM", () => server.close());
}
