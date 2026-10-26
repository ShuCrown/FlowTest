export interface FixtureServerHandle {
  server: import("node:http").Server;
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
}

export function startFixtureServer(options?: { port?: number }): Promise<FixtureServerHandle>;
