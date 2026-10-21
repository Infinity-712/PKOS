import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mobileRoot } from './build.mjs';
import { childEnvironment } from './environment.mjs';

const serverRoot = resolve(mobileRoot, '../agent-server');
const child = spawn(process.execPath, ['--import', 'tsx', 'src/scripts/mobileCompatServer.ts', ...process.argv.slice(2)], {
  cwd: serverRoot, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], shell: false, env: childEnvironment(),
});
const stop = () => { if (child.connected) child.send({ type: 'mobile-compat-stop' }, () => {}); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.once('error', () => { console.error('Unable to start the isolated compatibility server'); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 0; });
