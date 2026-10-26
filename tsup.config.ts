import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "apps/api/src/index.ts",
      cli: "apps/api/src/cli.ts",
    },
    outDir: "apps/api/dist",
    format: ["esm"],
    target: "node24",
    platform: "node",
    bundle: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: false,
    external: [
      "better-sqlite3",
      "playwright",
      "ws",
      "@hono/node-server",
      "@hono/node-ws",
    ],
    noExternal: ["@flowforge/dsl", "@flowforge/engine"],
  },
  {
    entry: { "worker-entry": "packages/engine/src/worker-entry.ts" },
    outDir: "packages/engine/dist",
    format: ["esm"],
    target: "node24",
    platform: "node",
    bundle: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: false,
    external: ["playwright", "@faker-js/faker"],
    noExternal: ["@flowforge/dsl"],
  },
]);
