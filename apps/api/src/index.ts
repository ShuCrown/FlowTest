import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDatabase, type FlowForgeDatabase } from "./db/client.js";
import { RunBroker } from "./events.js";
import { RunQueue } from "./queue.js";
import { createLedger, type LedgerService } from "./services/ledger.js";
import { Store } from "./services/store.js";

export interface Runtime {
  database: FlowForgeDatabase;
  store: Store;
  ledger: LedgerService;
  broker: RunBroker;
  queue: RunQueue;
  app: ReturnType<typeof createApp>["app"];
  injectWebSocket: ReturnType<typeof createApp>["injectWebSocket"];
}

export function createRuntime(options: { dataDir?: string } = {}): Runtime {
  const database = createDatabase({ dataDir: options.dataDir });
  const store = new Store(database);
  const ledger = createLedger(database.sqlite);
  const broker = new RunBroker();
  const queue = new RunQueue({
    store,
    broker,
    ledger,
    dataDir: database.dataDir,
  });
  const { app, injectWebSocket } = createApp({
    store,
    queue,
    broker,
    ledger,
    dataDir: database.dataDir,
  });
  return { database, store, ledger, broker, queue, app, injectWebSocket };
}

export async function startServer(options: { port?: number; dataDir?: string } = {}): Promise<{
  runtime: Runtime;
  server: import("node:http").Server;
  url: string;
  close: () => Promise<void>;
}> {
  const runtime = createRuntime({ dataDir: options.dataDir });
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  const server = serve({
    fetch: runtime.app.fetch,
    port,
    hostname: "127.0.0.1",
  }) as unknown as import("node:http").Server;
  runtime.injectWebSocket(server);
  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", () => resolve());
      server.once("error", (error) => reject(error));
    });
  }
  const actualPort = (server.address() as import("node:net").AddressInfo).port;
  const close = async (): Promise<void> => {
    await runtime.queue.shutdown();
    runtime.broker.closeAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    runtime.database.sqlite.close();
  };
  return { runtime, server, url: `http://127.0.0.1:${actualPort}`, close };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { url, close } = await startServer();
  console.log(`FlowForge API listening on ${url}`);
  const shutdown = (): void => {
    void close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
