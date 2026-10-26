/**
 * Playwright 会把函数源码序列化到页面执行。tsx/esbuild 的 keepNames 会注入
 * `__name` 辅助函数，导致浏览器侧 ReferenceError。这里用 `new Function`
 * 生成干净的函数源码，避免构建工具改写。
 */

export const domStablePageFn = new Function(
  "args",
  `return new Promise(function (resolve) {
    var quietTimer, hardTimer;
    function done(value) {
      observer.disconnect();
      if (quietTimer) clearTimeout(quietTimer);
      if (hardTimer) clearTimeout(hardTimer);
      resolve(value);
    }
    var observer = new MutationObserver(function () {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(function () { done(true); }, args.quietMs);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    quietTimer = setTimeout(function () { done(true); }, args.quietMs);
    hardTimer = setTimeout(function () { done(false); }, args.maxMs);
  });`,
) as (args: { quietMs: number; maxMs: number }) => Promise<boolean>;

export const domStableElementFn = new Function(
  "element",
  "args",
  `return new Promise(function (resolve) {
    var quietTimer, hardTimer;
    function done(value) {
      observer.disconnect();
      if (quietTimer) clearTimeout(quietTimer);
      if (hardTimer) clearTimeout(hardTimer);
      resolve(value);
    }
    var observer = new MutationObserver(function () {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(function () { done(true); }, args.quietMs);
    });
    observer.observe(element, { childList: true, subtree: true, attributes: true, characterData: true });
    quietTimer = setTimeout(function () { done(true); }, args.quietMs);
    hardTimer = setTimeout(function () { done(false); }, args.maxMs);
  });`,
) as (element: Element, args: { quietMs: number; maxMs: number }) => Promise<boolean>;

export interface SimilarElementInfo {
  tag: string;
  role: string;
  name: string;
  text: string;
  testid: string;
  similarity: number;
}

export const collectSimilarElementsFn = new Function(
  "needle",
  `var elements = Array.prototype.slice.call(
    document.querySelectorAll("button,input,a,select,textarea,[role],label")
  ).slice(0, 1500);
  function normalize(value) { return String(value || "").replace(/\\s+/g, " ").trim(); }
  function nameOf(el) {
    return normalize(
      el.getAttribute("aria-label") ||
      el.innerText ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      ""
    );
  }
  function similarity(a, b) {
    if (!a || !b) return 0;
    var longer = a.length > b.length ? a : b;
    var shorter = a.length > b.length ? b : a;
    if (longer.indexOf(shorter) >= 0) return shorter.length / longer.length;
    var same = 0;
    var limit = Math.min(a.length, b.length);
    for (var i = 0; i < limit; i += 1) if (a[i] === b[i]) same += 1;
    return same / longer.length;
  }
  return elements
    .map(function (el) {
      var name = nameOf(el);
      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || "",
        name: name,
        text: normalize(el.innerText || "").slice(0, 80),
        testid: el.getAttribute("data-testid") || "",
        similarity: Math.round(similarity(normalize(needle), name) * 100) / 100,
      };
    })
    .filter(function (item) { return item.name || item.text; })
    .sort(function (a, b) { return b.similarity - a.similarity; })
    .slice(0, 5);`,
) as (needle: string) => SimilarElementInfo[];
