import { zipSync } from 'fflate';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
const files = {};
for (const name of await readdir('dist'))
  if (!name.endsWith('.map'))
    files[name] = new Uint8Array(await readFile(`dist/${name}`));
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/pointnote-0.1.0.zip', zipSync(files));
console.log('Packaged artifacts/pointnote-0.1.0.zip');
