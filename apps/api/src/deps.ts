import type { RunBroker } from "./events.js";
import type { RunQueue } from "./queue.js";
import type { LedgerService } from "./services/ledger.js";
import type { Store } from "./services/store.js";

export interface AppDeps {
  store: Store;
  queue: RunQueue;
  broker: RunBroker;
  ledger: LedgerService;
  dataDir: string;
}
