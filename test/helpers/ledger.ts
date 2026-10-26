import type { Ledger } from "@flowforge/engine";

export class MemoryLedger implements Ledger {
  private readonly values = new Set<string>();
  private readonly sequences = new Map<string, number>();

  async reserve(systemId: string, scope: string, value: string): Promise<boolean> {
    const key = `${systemId}|${scope}|${value}`;
    if (this.values.has(key)) return false;
    this.values.add(key);
    return true;
  }

  async nextSequence(systemId: string, scope: string): Promise<number> {
    const key = `${systemId}|${scope}`;
    const next = (this.sequences.get(key) ?? 0) + 1;
    this.sequences.set(key, next);
    return next;
  }

  has(systemId: string, scope: string, value: string): boolean {
    return this.values.has(`${systemId}|${scope}|${value}`);
  }

  sequence(systemId: string, scope: string): number {
    return this.sequences.get(`${systemId}|${scope}`) ?? 0;
  }
}
