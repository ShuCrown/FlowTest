export const TEMPLATE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

const ALLOWED_ROOT = new Set(["vars", "run", "seq", "sys", "env"]);

export interface TemplateScope {
  vars: Record<string, unknown>;
  run: { id: string; shortId: string; startedAt: string };
  seq: Record<string, number>;
  sys: Record<string, string>;
  env: Record<string, string | undefined>;
}

export function listTemplateRefs(template: string): string[] {
  const refs: string[] = [];
  for (const match of template.matchAll(TEMPLATE_PATTERN)) {
    if (match[1]) refs.push(match[1].trim());
  }
  return refs;
}

export function validateTemplate(template: string): string[] {
  const errors: string[] = [];
  for (const ref of listTemplateRefs(template)) {
    const [root, ...rest] = ref.split(".");
    if (!root || !ALLOWED_ROOT.has(root)) {
      errors.push(`模板命名空间非法: {{${ref}}}`);
      continue;
    }
    if (root === "vars" && !rest[0]) errors.push(`vars 模板缺少变量名: {{${ref}}}`);
    if (root === "seq" && !rest[0]) errors.push(`seq 模板缺少序列名: {{${ref}}}`);
    if (root === "env" && !rest[0]) errors.push(`env 模板缺少环境变量名: {{${ref}}}`);
    if (root === "sys" && !rest[0]) errors.push(`sys 模板缺少字段名: {{${ref}}}`);
    if (root === "sys" && rest.some((part) => part !== "baseUrl")) {
      errors.push(`sys 模板只允许 baseUrl: {{${ref}}}`);
    }
    if (root === "run" && !["id", "shortId", "startedAt"].includes(rest.join("."))) {
      errors.push(`run 模板只允许 id / shortId / startedAt: {{${ref}}}`);
    }
    if (root === "vars" && rest.length > 1) {
      errors.push(`vars 模板不支持多级路径: {{${ref}}}`);
    }
  }
  return errors;
}

export function renderTemplate(template: string, scope: TemplateScope): string {
  return template.replace(TEMPLATE_PATTERN, (_all, rawRef: string) => {
    const ref = rawRef.trim();
    const [root, ...rest] = ref.split(".");
    let value: unknown;
    switch (root) {
      case "vars":
        value = scope.vars[rest.join(".")];
        break;
      case "run":
        value = (scope.run as unknown as Record<string, unknown>)[rest.join(".")];
        break;
      case "seq":
        value = scope.seq[rest.join(".")];
        break;
      case "sys":
        value = scope.sys[rest.join(".")];
        break;
      case "env":
        value = scope.env[rest.join(".")];
        break;
      default:
        value = undefined;
    }
    if (value === undefined || value === null) return "";
    return String(value);
  });
}

export function collectTemplates(value: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      if (node.includes("{{")) found.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      Object.values(node).forEach(walk);
    }
  };
  walk(value);
  return found;
}
