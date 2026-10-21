import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { childEnvironment } from './environment.mjs';
import { testPort } from './network.mjs';

export const mobileRoot = fileURLToPath(new URL('../', import.meta.url));
export function build(debug = true) {
  const result = spawnSync(process.execPath, [resolve(mobileRoot, 'node_modules/vite/bin/vite.js'), 'build'], {
    cwd: mobileRoot, stdio: 'inherit', shell: false,
    env: { ...childEnvironment(), PKOS_MOBILE_DEBUG: debug ? '1' : '0', PKOS_MOBILE_PORT: String(testPort(process.env.PKOS_MOBILE_PORT ?? '18790')) },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Mobile web build failed');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build(process.argv.includes('--release') ? false : true);
