import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Report } from '../../packages/core/src/model';

export class ReportStore {
  private db: DatabaseSync;
  constructor(path = resolve('.data/tracelab.sqlite')) {
    if (path !== ':memory:') mkdirSync(resolve(path, '..'), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);');
  }
  save(report: Report) {
    this.db.prepare('INSERT OR REPLACE INTO reports (id,name,mode,created_at,payload) VALUES (?,?,?,?,?)').run(report.id, report.dataset.creator.name, report.dataset.mode, report.createdAt, JSON.stringify(report));
  }
  get(id: string): Report | null {
    const row = this.db.prepare('SELECT payload FROM reports WHERE id=?').get(id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as Report : null;
  }
  list() { return this.db.prepare('SELECT id,name,mode,created_at AS createdAt FROM reports ORDER BY created_at DESC LIMIT 30').all(); }
  close() { this.db.close(); }
}
