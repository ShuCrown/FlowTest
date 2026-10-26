import type Database from "better-sqlite3";
import type { Ledger } from "@flowforge/engine";

export interface LedgerService extends Ledger {
  cleanup(days: number): number;
}

export function createLedger(sqlite: Database.Database): LedgerService {
  const insert = sqlite.prepare(
    `INSERT OR IGNORE INTO value_ledger(system_id, scope, value, run_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const next = sqlite.prepare(
    `INSERT INTO sequences(system_id, scope, next_value) VALUES (?, ?, 1)
     ON CONFLICT(system_id, scope) DO UPDATE SET next_value = next_value + 1
     RETURNING next_value`,
  );
  const cleanupStmt = sqlite.prepare(
    `DELETE FROM value_ledger WHERE created_at < datetime('now', ?)`,
  );

  return {
    async reserve(systemId, scope, value, runId) {
      const result = insert.run(systemId, scope, value, runId, new Date().toISOString());
      return result.changes > 0;
    },
    async nextSequence(systemId, scope) {
      const row = next.get(systemId, scope) as { next_value: number };
      return row.next_value;
    },
    cleanup(days) {
      const result = cleanupStmt.run(`-${Math.max(1, days)} days`);
      return result.changes;
    },
  };
}
