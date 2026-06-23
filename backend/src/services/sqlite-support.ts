import type Database from 'better-sqlite3';

export interface Row {
  [column: string]: unknown;
}

export function queryOptionalRow<T extends Row>(
  db: Database.Database,
  sql: string,
  params: unknown[] = [],
): T | null {
  const row = db.prepare(sql).get(...params) as T | undefined;
  return row ?? null;
}

export function queryRequiredRow<T extends Row>(
  db: Database.Database,
  sql: string,
  params: unknown[] = [],
): T {
  const row = queryOptionalRow<T>(db, sql, params);
  if (row === null) {
    throw new Error('Expected query to return a row.');
  }
  return row;
}

export function queryRows<T extends Row>(
  db: Database.Database,
  sql: string,
  params: unknown[] = [],
): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function withTransaction<T>(
  db: Database.Database,
  callback: () => T,
): T {
  const transaction = db.transaction(() => {
    return callback();
  });
  return transaction();
}

export function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
