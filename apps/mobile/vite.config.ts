import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { contentSecurityPolicy, testPort } from './scripts/network.mjs';

export default defineConfig(() => {
  const debug = process.env.PKOS_MOBILE_DEBUG === '1';
  const port = testPort(process.env.PKOS_MOBILE_PORT ?? '18790');
  return {
    base: './',
    plugins: [react(), { name: 'compat-csp', transformIndexHtml: (html: string) => html.replace('__PKOS_CSP__', contentSecurityPolicy(debug, port)) }],
    define: { __COMPAT_PORT__: JSON.stringify(port), __COMPAT_DEBUG__: JSON.stringify(debug) },
    build: { target: 'es2020', outDir: debug ? 'dist' : 'dist-release' },
    server: { host: '127.0.0.1', port: 5185, strictPort: true, hmr: false },
  };
});
