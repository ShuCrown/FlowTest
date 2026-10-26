import type { WSContext } from "hono/ws";

export interface BroadcastEvent {
  runId: string;
  seq: number;
  ts: string;
  type: string;
  nodeId?: string | null;
  level?: string | null;
  payload?: unknown;
}

/**
 * 运行事件广播：按 runId 订阅，100ms 合批，无订阅者时直接丢弃。
 */
export class RunBroker {
  private readonly subscribers = new Map<string, Set<WSContext>>();
  private readonly buffers = new Map<string, BroadcastEvent[]>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  subscribe(runId: string, socket: WSContext): void {
    const set = this.subscribers.get(runId) ?? new Set<WSContext>();
    set.add(socket);
    this.subscribers.set(runId, set);
  }

  unsubscribe(runId: string, socket: WSContext): void {
    const set = this.subscribers.get(runId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.subscribers.delete(runId);
  }

  publish(event: BroadcastEvent): void {
    const set = this.subscribers.get(event.runId);
    if (!set || set.size === 0) return;
    const buffer = this.buffers.get(event.runId) ?? [];
    buffer.push(event);
    this.buffers.set(event.runId, buffer);
    if (!this.timers.has(event.runId)) {
      const timer = setTimeout(() => this.flush(event.runId), 100);
      timer.unref?.();
      this.timers.set(event.runId, timer);
    }
  }

  private flush(runId: string): void {
    this.timers.delete(runId);
    const buffer = this.buffers.get(runId);
    this.buffers.delete(runId);
    const set = this.subscribers.get(runId);
    if (!buffer || !set) return;
    const text = buffer.map((event) => JSON.stringify(event)).join("\n");
    for (const socket of set) {
      try {
        socket.send(text);
      } catch {
        this.unsubscribe(runId, socket);
      }
    }
  }

  closeAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const set of this.subscribers.values()) {
      for (const socket of set) {
        try {
          socket.close();
        } catch {
          // 忽略关闭失败
        }
      }
    }
    this.subscribers.clear();
    this.buffers.clear();
  }
}
