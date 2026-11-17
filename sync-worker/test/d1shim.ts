import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WRITE_RE = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i;

/** node:sqlite 위에 만든 D1 호환 shim. 쓰기 문장 수를 센다. */
export class D1Shim {
  readonly sqlite = new DatabaseSync(':memory:');
  /** 실행된 쓰기 문장(INSERT/UPDATE/DELETE…) 누적 수 */
  writes = 0;
  /** true 면 prepare 가 던진다(D1 장애 모사) */
  fail = false;

  constructor() {
    this.sqlite.exec(readFileSync(fileURLToPath(new URL('../schema.sql', import.meta.url)), 'utf8'));
  }

  prepare(sql: string): Stmt {
    if (this.fail) throw new Error('D1 down');
    return new Stmt(this, sql, []);
  }

  async batch(stmts: Stmt[]): Promise<unknown[]> {
    if (this.fail) throw new Error('D1 down');
    this.sqlite.exec('BEGIN');
    try {
      const out = stmts.map((s) => (/^\s*SELECT/i.test(s.sql) ? s.execAll() : s.execRun()));
      this.sqlite.exec('COMMIT');
      return out;
    } catch (e) {
      this.sqlite.exec('ROLLBACK');
      throw e;
    }
  }

  /** 테스트용: 모든 테이블 내용을 문자열로 덤프 */
  dump(): string {
    const out: unknown[] = [];
    for (const t of ['spaces', 'items']) out.push(this.sqlite.prepare(`SELECT * FROM ${t}`).all());
    return JSON.stringify(out);
  }
}

export class Stmt {
  constructor(private db: D1Shim, readonly sql: string, private params: unknown[]) {}

  bind(...values: unknown[]): Stmt {
    return new Stmt(this.db, this.sql, values);
  }
  private p() {
    return this.params.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)) as never[];
  }
  execAll() {
    return { results: this.db.sqlite.prepare(this.sql).all(...this.p()).map((r) => ({ ...r })), success: true };
  }
  execRun() {
    if (WRITE_RE.test(this.sql)) this.db.writes++;
    const r = this.db.sqlite.prepare(this.sql).run(...this.p());
    return { success: true, meta: { changes: Number(r.changes) } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.db.sqlite.prepare(this.sql).get(...this.p());
    return row ? ({ ...row } as T) : null;
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return this.execAll() as unknown as { results: T[] };
  }
  async run(): Promise<unknown> {
    return this.execRun();
  }
}
