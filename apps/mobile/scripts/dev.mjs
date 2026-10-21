import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { childEnvironment } from './environment.mjs';
import { build, mobileRoot } from './build.mjs';
import { testPort } from './network.mjs';

// Preview the exact bundled CSP. Vite's dev preamble needs inline script allowances.
build(true);
const child = spawn(process.execPath, [resolve(mobileRoot, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '5185', '--strictPort'], {
  cwd: mobileRoot, stdio: 'inherit', shell: false,
  env: { ...childEnvironment(), PKOS_MOBILE_DEBUG: '1', PKOS_MOBILE_PORT: String(testPort(process.env.PKOS_MOBILE_PORT ?? '18790')) },
});
process.once('SIGINT', () => child.kill());
process.once('SIGTERM', () => child.kill());
child.once('error', () => { console.error('Unable to start mobile preview'); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 0; });
