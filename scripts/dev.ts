import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

const children: ChildProcess[] = [];

function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}): ChildProcess {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on("exit", (code) => {
    if (code && code !== 0) {
      process.stderr.write(`[dev] 子进程退出 code=${code}\n`);
    }
  });
  return child;
}

process.stdout.write("FlowForge dev: API http://127.0.0.1:8787\n");
run(process.execPath, ["--import", "tsx", "apps/api/src/index.ts"], {
  PORT: process.env.PORT ?? "8787",
});

if (existsSync("apps/web/package.json")) {
  process.stdout.write("FlowForge dev: Web http://127.0.0.1:5173\n");
  run("pnpm", ["--filter", "@flowforge/web", "dev"]);
} else {
  process.stdout.write("FlowForge dev: apps/web 尚未创建，跳过前端开发服务器\n");
}

const shutdown = (): void => {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
