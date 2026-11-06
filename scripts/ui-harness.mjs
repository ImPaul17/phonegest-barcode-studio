import { app } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
app.setPath('userData', process.env.PHONEGEST_TEST_DATA || path.join(os.tmpdir(), `phonegest-ui-${process.pid}`));
const packageInfo = JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
app.getVersion = () => packageInfo.version;
await import('../electron/main.mjs');
