import { net, protocol } from "electron";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { desktopAppHost, desktopAppScheme } from "./securityPolicy.js";
import { logStartupEvent } from "./startupDiagnostics.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const rendererRoot = resolve(currentDir, "../renderer");
let handlerInstalled = false;

export function registerDesktopAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: desktopAppScheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
      },
    },
  ]);
}

export function installDesktopAppSchemeHandler(): void {
  if (handlerInstalled) {
    return;
  }
  handlerInstalled = true;
  protocol.handle(desktopAppScheme, async (request) => serveRendererAsset(request.url));
  logStartupEvent("desktop_app_scheme_handler_installed", {
    scheme: desktopAppScheme,
    host: desktopAppHost,
  });
}

async function serveRendererAsset(requestUrl: string): Promise<Response> {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return textResponse("bad request", 400);
  }
  if (url.protocol !== `${desktopAppScheme}:` || url.host !== desktopAppHost) {
    return textResponse("not found", 404);
  }

  const resolved = resolveRendererAsset(url.pathname);
  if (!resolved.allowed) {
    return textResponse("forbidden", 403);
  }
  if (!existsSync(resolved.path)) {
    return textResponse("not found", 404);
  }

  return net.fetch(pathToFileURL(resolved.path).toString());
}

function resolveRendererAsset(pathname: string): { allowed: true; path: string } | { allowed: false } {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname || "/");
  } catch {
    return { allowed: false };
  }

  const normalized = decoded === "/" ? "/index.html" : decoded;
  if (!normalized.startsWith("/") || normalized.includes("\\") || normalized.includes("\0")) {
    return { allowed: false };
  }
  if (normalized.split("/").some((segment) => segment === ".." || /^[a-zA-Z]:$/.test(segment))) {
    return { allowed: false };
  }

  const assetPath = resolve(rendererRoot, normalized.slice(1));
  const relativePath = relative(rendererRoot, assetPath);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return { allowed: false };
  }
  return { allowed: true, path: assetPath };
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
