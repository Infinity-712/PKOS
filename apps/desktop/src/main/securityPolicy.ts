export const dashboardUrl = "http://127.0.0.1:5173";
export const agentServerUrl = "http://127.0.0.1:8790";
export const rendererDevUrl = "http://127.0.0.1:5174";
export const desktopAppScheme = "pkos-desktop";
export const desktopAppHost = "app";
export const desktopAppOrigin = `${desktopAppScheme}://${desktopAppHost}`;
export const desktopAppEntryUrl = `${desktopAppOrigin}/index.html`;

export function securityHeaders(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${agentServerUrl}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function isAllowedExternalUrl(url: string): boolean {
  return url === dashboardUrl;
}

export function isAllowedNavigationUrl(url: string, devUrl: string | null): boolean {
  if (url.startsWith(`${desktopAppOrigin}/`)) {
    return true;
  }
  return Boolean(devUrl && url.startsWith(devUrl));
}

export function normalizedDevUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  return value === rendererDevUrl ? value : null;
}

export function safeCspHeaders(): Record<string, string[]> {
  return {
    "Content-Security-Policy": [securityHeaders()],
  };
}
