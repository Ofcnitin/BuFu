// Minimal hand-written stand-in for @cloudflare/workers-types — see README.md.
// NOT the genuine package. Do not use for anything but this offline check.

interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta: Record<string, unknown>;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1Result>;
}

interface ScheduledEvent {
  cron: string;
  type: 'scheduled';
  scheduledTime: number;
}

// Workers' global `crypto` covers WebCrypto plus randomUUID(); WebWorker lib
// already provides most of Crypto, this only fills the gap.
interface Crypto {
  randomUUID(): string;
}
