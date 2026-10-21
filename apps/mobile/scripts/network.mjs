export function testPort(value = '18790') {
  if (!/^[0-9]+$/.test(String(value))) throw new Error('Invalid compatibility port');
  const port = Number(value);
  if (port < 1024 || port > 65535 || port === 8790) throw new Error('Use a separate test port (1024..65535, never 8790)');
  return port;
}

export function capacitorConfig(debug = false) {
  return {
    appId: 'dev.pkos.mobile.compat',
    appName: 'PKOS Mobile 测试',
    webDir: debug ? 'dist' : 'dist-release',
    server: { hostname: 'localhost', androidScheme: debug ? 'http' : 'https', cleartext: false, allowNavigation: [] },
    android: { allowMixedContent: false, webContentsDebuggingEnabled: debug },
    plugins: { CapacitorHttp: { enabled: false } },
  };
}

export function contentSecurityPolicy(debug = false, port = 18790) {
  return `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ${debug ? `http://127.0.0.1:${testPort(port)}` : "'none'"}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'`;
}
