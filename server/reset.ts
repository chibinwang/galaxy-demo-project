import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './db';

// Regenerates the synthetic demo dataset, anchored to today (or DEMO_DATE=YYYY-MM-DD).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = new Store(process.env.DATA_FILE ?? path.join(root, 'data', 'db.json'));
store.resetDemo(process.env.DEMO_DATE);
const db = store.db;
console.log(`Demo data reset: ${db.orders.length} orders, ${db.entries.length} entries, ${db.issues.length} issues (anchor ${db.meta.anchorDate}).`);
