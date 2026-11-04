import fs from 'node:fs';
import path from 'node:path';
import { defaultAiState } from '../shared/ai';
import { emptyEngState } from '../shared/eng';
import { seedEng } from '../shared/engSeed';
import { DEFAULT_SETTINGS } from '../shared/constants';
import { localToday } from '../shared/dates';
import { generateDemoData } from '../shared/seed';
import type { DB } from '../shared/types';

/**
 * File-backed store: the whole dataset lives in one JSON document, written atomically (temp file + rename).
 * Adequate for a single-plant demo; the Store interface is the seam for swapping in Postgres later.
 */
export class Store {
  private data: DB;
  /** In-memory file bytes when running without a data directory (tests). */
  private memFiles = new Map<string, Buffer>();

  constructor(private file: string | null, initial?: DB) {
    if (initial) this.data = initial;
    else if (file && fs.existsSync(file)) this.data = JSON.parse(fs.readFileSync(file, 'utf8')) as DB;
    else this.data = generateDemoData(localToday());
    // Data files written before the AI assistant / Engineering module existed lack those sections.
    this.data.ai ??= defaultAiState();
    if (!this.data.eng || (this.data.meta.demoData && this.data.eng.drawings.length === 0)) this.seedEngineering(this.data.meta.anchorDate ?? localToday());
    if (!initial && file && !fs.existsSync(file)) this.persist();
  }

  get db(): DB {
    return this.data;
  }

  /** Apply a mutation to a copy and persist it. Throw inside `fn` to abort with no change. */
  update<T>(fn: (db: DB) => T): T {
    const draft = structuredClone(this.data);
    const result = fn(draft);
    this.data = draft;
    this.persist();
    return result;
  }

  replace(db: DB) {
    this.data = db;
    this.persist();
  }

  resetDemo(anchor = localToday()) {
    const db = generateDemoData(anchor);
    db.eng = emptyEngState();
    this.data = db;
    this.seedEngineering(anchor);
  }

  /** (Re)seed only the Engineering & QC scenario; nonconformances it raised are removed too. */
  seedEngineering(anchor = localToday()) {
    const { state, blobs } = seedEng(anchor);
    this.removeFilesExcept(new Set(Object.keys(blobs)));
    for (const [id, bytes] of Object.entries(blobs)) this.writeFile(id, Buffer.from(bytes));
    this.data.issues = (this.data.issues ?? []).filter((i) => !i.inspectionId);
    this.data.eng = state;
    this.persist();
  }

  writeFile(id: string, bytes: Buffer) {
    if (!this.file) {
      this.memFiles.set(id, bytes);
      return;
    }
    const dir = path.join(path.dirname(this.file), 'files');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, id), bytes);
  }

  /** Drop stored file bytes that are no longer referenced (used when the Engineering scenario is reset). */
  private removeFilesExcept(keep: Set<string>) {
    if (!this.file) {
      for (const id of [...this.memFiles.keys()]) if (!keep.has(id)) this.memFiles.delete(id);
      return;
    }
    const dir = path.join(path.dirname(this.file), 'files');
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) if (/^FILE-\d+$/.test(name) && !keep.has(name)) fs.unlinkSync(path.join(dir, name));
  }

  readFile(id: string): Buffer | null {
    if (!/^FILE-\d+$/.test(id)) return null;
    if (!this.file) return this.memFiles.get(id) ?? null;
    const p = path.join(path.dirname(this.file), 'files', id);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  }

  clearAll() {
    this.replace({
      version: 1,
      meta: { demoData: false },
      settings: structuredClone(this.data.settings ?? DEFAULT_SETTINGS),
      products: this.data.products.filter((p) => p.source !== 'demo'),
      orders: [],
      entries: [],
      issues: [],
      briefs: [],
      ai: { autonomy: this.data.ai.autonomy, actions: [] },
      eng: emptyEngState(),
    });
  }

  private persist() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

export function nextId(prefix: string, existing: string[], width = 4): string {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const id of existing) {
    const m = id.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(width, '0')}`;
}
