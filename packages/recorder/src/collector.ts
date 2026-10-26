import type { Strategy, TargetRef } from "@flowforge/dsl";

export interface ElementFingerprint {
  tag: string;
  type?: string;
  role?: string;
  name?: string;
  id?: string;
  testid?: string;
  placeholder?: string;
  ariaLabel?: string;
  labelText?: string;
  text?: string;
  value?: string;
  checked?: boolean;
  classes?: string[];
  css?: string;
  xpath?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  frameUrl?: string;
}

export type RawEvent =
  | {
      kind: "click";
      t: number;
      fp: ElementFingerprint;
    }
  | {
      kind: "input" | "change";
      t: number;
      fp: ElementFingerprint;
      value?: string;
      checked?: boolean;
      redacted?: boolean;
    }
  | {
      kind: "key";
      t: number;
      key: string;
      fp?: ElementFingerprint;
    }
  | {
      kind: "overlay-open";
      t: number;
      role: string;
      title?: string;
    }
  | {
      kind: "overlay-close";
      t: number;
      role: string;
    }
  | {
      kind: "navigate";
      ts: string;
      url: string;
      source: "playwright";
    }
  | {
      kind: "request";
      ts: string;
      method: string;
      url: string;
      status?: number;
      source: "playwright";
    };

/**
 * 注入到所有 frame 的采集脚本。以字符串形式注入，避免构建工具改写函数源码。
 */
export const COLLECTOR_SCRIPT = `(() => {
  if (window.__ffCollectorInstalled) return;
  window.__ffCollectorInstalled = true;

  const push = (event) => {
    try { window.__ffPush && window.__ffPush(event); } catch (error) {}
  };
  const now = () => performance.now();
  const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();

  const isSecret = (el) => {
    if (!el) return false;
    if (el.getAttribute && el.getAttribute("data-ff-secret") !== null) return true;
    if (el.tagName === "INPUT" && el.type === "password") return true;
    return false;
  };

  const labelText = (el) => {
    if (!el || !el.labels) return "";
    return normalize(Array.from(el.labels).map((label) => label.innerText).join(" "));
  };

  const accessibleName = (el) => {
    if (!el) return "";
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria) return normalize(aria);
    const labelledBy = el.getAttribute && el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(" ")
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => node.innerText)
        .join(" ");
      if (normalize(text)) return normalize(text);
    }
    const ownLabel = labelText(el);
    if (ownLabel) return ownLabel;
    const placeholder = el.getAttribute && el.getAttribute("placeholder");
    if (placeholder) return normalize(placeholder);
    const value = el.innerText || el.value || "";
    return normalize(value).slice(0, 80);
  };

  const cssPath = (el) => {
    if (!el || el.nodeType !== 1) return "";
    const parts = [];
    let current = el;
    let depth = 0;
    while (current && current.nodeType === 1 && depth < 5) {
      let part = current.tagName.toLowerCase();
      if (current.id && /^[a-zA-Z][\\w-]*$/.test(current.id)) {
        part += "#" + current.id;
        parts.unshift(part);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
      }
      parts.unshift(part);
      current = current.parentElement;
      depth += 1;
    }
    return parts.join(" > ");
  };

  const xpath = (el) => {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return "//*[@id='" + el.id + "']";
    const parts = [];
    let current = el;
    while (current && current.nodeType === 1) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) {
        parts.unshift("/" + tag);
        break;
      }
      const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
      const index = siblings.indexOf(current) + 1;
      parts.unshift("/" + tag + "[" + index + "]");
      current = parent;
    }
    return parts.join("");
  };

  const fingerprint = (el) => {
    if (!el || el.nodeType !== 1) return null;
    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || undefined,
      role: el.getAttribute("role") || undefined,
      name: el.getAttribute("name") || undefined,
      id: el.id || undefined,
      testid: el.getAttribute("data-testid") || undefined,
      placeholder: el.getAttribute("placeholder") || undefined,
      ariaLabel: el.getAttribute("aria-label") || undefined,
      labelText: labelText(el) || undefined,
      text: normalize(el.innerText || "").slice(0, 80) || undefined,
      value: isSecret(el) ? undefined : (el.value || undefined),
      checked: typeof el.checked === "boolean" ? el.checked : undefined,
      classes: el.classList ? Array.from(el.classList).slice(0, 6) : [],
      css: cssPath(el),
      xpath: xpath(el),
      bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      frameUrl: location.href,
    };
  };

  const actionable = (target) =>
    target && target.closest
      ? target.closest('button,[role=button],a,input,select,textarea,li,[role=option],[role=row],[role=tab],[role=checkbox]')
      : null;

  const overlayRole = (node) => {
    if (!node || node.nodeType !== 1) return "";
    const role = node.getAttribute && node.getAttribute("role");
    if (role && ["dialog", "alertdialog", "menu", "listbox", "drawer"].includes(role)) return role;
    if (node.getAttribute && node.getAttribute("aria-modal") === "true") return "dialog";
    const cls = String(node.className || "").toLowerCase();
    if (/modal|dialog|drawer|popup|dropdown|overlay|menu/.test(cls)) return "dialog";
    const style = window.getComputedStyle(node);
    if (style.position === "fixed" && Number(style.zIndex || 0) >= 10) return "dialog";
    return "";
  };

  document.addEventListener("click", (event) => {
    const el = actionable(event.target) || event.target;
    const fp = fingerprint(el);
    if (fp) push({ kind: "click", t: now(), fp });
  }, true);

  const recordValue = (event, kind) => {
    const el = event.target;
    if (!el || el.nodeType !== 1) return;
    const secret = isSecret(el);
    const fp = fingerprint(el);
    if (!fp) return;
    push({
      kind,
      t: now(),
      fp,
      value: secret ? undefined : (el.value || undefined),
      checked: typeof el.checked === "boolean" ? el.checked : undefined,
      redacted: secret || undefined,
    });
  };
  document.addEventListener("input", (event) => recordValue(event, "input"), true);
  document.addEventListener("change", (event) => recordValue(event, "change"), true);

  document.addEventListener("keydown", (event) => {
    if (!["Enter", "Escape", "Tab"].includes(event.key)) return;
    push({ kind: "key", t: now(), key: event.key, fp: fingerprint(event.target) || undefined });
  }, true);

  const openOverlays = new Set();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!node || node.nodeType !== 1) continue;
        const role = overlayRole(node);
        if (role) {
          openOverlays.add(node);
          push({ kind: "overlay-open", t: now(), role, title: normalize(node.innerText || "").slice(0, 80) });
        }
        for (const child of node.querySelectorAll ? node.querySelectorAll('[role=dialog],[role=menu],[role=listbox],[aria-modal=true]') : []) {
          const childRole = overlayRole(child);
          if (childRole) {
            openOverlays.add(child);
            push({ kind: "overlay-open", t: now(), role: childRole, title: normalize(child.innerText || "").slice(0, 80) });
          }
        }
      }
      if (mutation.type === "attributes" && mutation.target) {
        const el = mutation.target;
        if (el.hidden || el.style.display === "none" || el.getAttribute("aria-hidden") === "true") {
          if (openOverlays.has(el)) {
            openOverlays.delete(el);
            push({ kind: "overlay-close", t: now(), role: overlayRole(el) || "dialog" });
          }
        } else if (overlayRole(el) && !el.hidden) {
          if (!openOverlays.has(el)) {
            openOverlays.add(el);
            push({ kind: "overlay-open", t: now(), role: overlayRole(el), title: normalize(el.innerText || "").slice(0, 80) });
          }
        }
      }
      for (const node of mutation.removedNodes) {
        if (node && node.nodeType === 1 && openOverlays.has(node)) {
          openOverlays.delete(node);
          push({ kind: "overlay-close", t: now(), role: overlayRole(node) || "dialog" });
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style", "aria-hidden", "class"] });
})();`;

export const PICK_SCRIPT = `(() => {
  if (window.__ffPicking) return;
  window.__ffPicking = true;

  const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const labelText = (el) => {
    if (!el || !el.labels) return "";
    return normalize(Array.from(el.labels).map((label) => label.innerText).join(" "));
  };
  const accessibleName = (el) => {
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria) return normalize(aria);
    const ownLabel = labelText(el);
    if (ownLabel) return ownLabel;
    const placeholder = el.getAttribute && el.getAttribute("placeholder");
    if (placeholder) return normalize(placeholder);
    return normalize(el.innerText || el.value || "").slice(0, 80);
  };
  const cssPath = (el) => {
    if (!el) return "";
    const parts = [];
    let current = el;
    let depth = 0;
    while (current && current.nodeType === 1 && depth < 5) {
      let part = current.tagName.toLowerCase();
      if (current.id && /^[a-zA-Z][\\w-]*$/.test(current.id)) {
        part += "#" + current.id;
        parts.unshift(part);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
      }
      parts.unshift(part);
      current = current.parentElement;
      depth += 1;
    }
    return parts.join(" > ");
  };
  const xpath = (el) => {
    if (!el) return "";
    if (el.id) return "//*[@id='" + el.id + "']";
    const parts = [];
    let current = el;
    while (current && current.nodeType === 1) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) { parts.unshift("/" + tag); break; }
      const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
      parts.unshift("/" + tag + "[" + (siblings.indexOf(current) + 1) + "]");
      current = parent;
    }
    return parts.join("");
  };
  const fingerprint = (el) => {
    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || undefined,
      role: el.getAttribute("role") || undefined,
      name: el.getAttribute("name") || undefined,
      id: el.id || undefined,
      testid: el.getAttribute("data-testid") || undefined,
      placeholder: el.getAttribute("placeholder") || undefined,
      ariaLabel: el.getAttribute("aria-label") || undefined,
      labelText: labelText(el) || undefined,
      text: normalize(el.innerText || "").slice(0, 80) || undefined,
      css: cssPath(el),
      xpath: xpath(el),
      bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      frameUrl: location.href,
    };
  };
  const actionable = (target) =>
    target && target.closest
      ? target.closest('button,[role=button],a,input,select,textarea,li,[role=option],[role=row],[role=tab],[role=checkbox]')
      : null;
  const cleanup = () => {
    window.__ffPicking = false;
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    document.documentElement.style.cursor = "";
  };
  const onClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const el = actionable(event.target) || event.target;
    const fp = fingerprint(el);
    window.__ffPick && window.__ffPick({ ok: true, fp });
    cleanup();
  };
  const onKey = (event) => {
    if (event.key !== "Escape") return;
    window.__ffPick && window.__ffPick({ ok: false, reason: "canceled" });
    cleanup();
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  document.documentElement.style.cursor = "crosshair";
})();`;

export function fingerprintToTarget(fp: ElementFingerprint): TargetRef {
  const strategies: Strategy[] = [];
  if (fp.testid) strategies.push({ type: "testid", value: fp.testid });
  const accessible = fp.ariaLabel || fp.labelText || fp.placeholder || fp.text;
  if (fp.role && accessible) {
    strategies.push({ type: "role", role: fp.role, name: accessible, exact: true });
  }
  if (fp.labelText) strategies.push({ type: "label", value: fp.labelText, exact: true });
  if (fp.placeholder) strategies.push({ type: "placeholder", value: fp.placeholder });
  if (fp.text && fp.text.length <= 60) {
    strategies.push({ type: "text", value: fp.text, exact: true });
  }
  if (fp.name) strategies.push({ type: "name", value: fp.name });
  if (fp.css) strategies.push({ type: "css", value: fp.css });
  if (fp.xpath) strategies.push({ type: "xpath", value: fp.xpath });
  if (strategies.length === 0) {
    strategies.push({ type: "css", value: fp.tag });
  }
  return {
    label: accessible || fp.name || fp.tag,
    strategies,
    fingerprint: {
      tag: fp.tag,
      role: fp.role,
      visibleText: fp.text,
      anchorText: fp.labelText,
      testid: fp.testid,
      name: fp.name,
      placeholder: fp.placeholder,
    },
    strict: true,
  };
}
