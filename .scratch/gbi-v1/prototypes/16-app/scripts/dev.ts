/* `pnpm dev`: the REST server on 127.0.0.1:8716 and Vite on 127.0.0.1:8717 (proxying /api). One script instead of a `concurrently` dependency. */
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const run = (cmd: string, args: string[]) => spawn(cmd, args, { cwd: root, stdio: 'inherit' });
const children = [run(process.execPath, ['src/server/index.ts']), run(join(root, 'node_modules/.bin/vite'), [])];
const stop = (): void => { for (const c of children) c.kill('SIGTERM'); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
children.forEach(c => c.on('exit', () => { stop(); setTimeout(() => process.exit(0), 300); }));
console.log('\nPrototype 16: open http://127.0.0.1:8717  (API on 127.0.0.1:8716)\n');
