import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { Store } from './db';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = process.env.DATA_FILE ?? path.join(root, 'data', 'db.json');
const port = Number(process.env.PORT ?? 3001);
const production = process.env.NODE_ENV === 'production';

const store = new Store(dataFile);
const app = createApp({ store, staticDir: production ? path.join(root, 'dist') : undefined });

app.listen(port, () => {
  console.log(`Everyse Factory Copilot API on http://localhost:${port}  (data: ${path.relative(root, dataFile)})`);
  if (production) console.log(`Open http://localhost:${port}`);
});
