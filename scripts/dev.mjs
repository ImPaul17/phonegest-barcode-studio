import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const children = new Set();
let stopping = false;

function launch(script, args, environment = {}, executable = process.execPath) {
  const childEnvironment = { ...process.env, ...environment };
  if (executable !== process.execPath) delete childEnvironment.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, executable === process.execPath ? [path.join(root, script), ...args] : args, {
    cwd: root,
    env: childEnvironment,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.add(child);
  child.on('exit', (code) => { children.delete(child); stop(code || 0); });
  child.on('error', (error) => { console.error(error.message); stop(1); });
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
launch('node_modules/vite/bin/vite.js', ['--host', '127.0.0.1', '--port', '5173', '--strictPort']);
try {
  let connected = false;
  for (let attempt = 0; attempt < 100 && !stopping; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:5173', { signal: AbortSignal.timeout(500) });
      if (response.ok) { connected = true; break; }
    } catch { /* Vite is still starting. */ }
    await delay(100);
  }
  if (!connected) throw new Error('No se ha podido iniciar el servidor local de desarrollo.');
  if (!stopping) launch(null, ['.'], { ELECTRON_RENDERER_URL: 'http://127.0.0.1:5173' }, require('electron'));
} catch (error) { console.error(error.message); stop(1); }
