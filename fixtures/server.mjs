import http from "node:http";
import { pathToFileURL } from "node:url";

const REGIONS = ["华东区", "华南区", "华北区", "西南区", "东北区"];

const state = {
  customers: [],
  nextId: 1,
  streams: new Set(),
};

function seed() {
  state.customers = [
    { id: 1, name: "华东示例客户", regions: ["华东区"], region: "华东区", amount: 1200, status: "启用", needsApproval: true, followDate: "" },
    { id: 2, name: "华南示例客户", regions: ["华南区"], region: "华南区", amount: 300, status: "启用", needsApproval: false, followDate: "" },
    { id: 3, name: "停用示例客户", regions: ["华北区"], region: "华北区", amount: 8000, status: "停用", needsApproval: false, followDate: "" },
  ];
  state.nextId = 4;
}

seed();

const layout = (title, body, extraHead = "") => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · FlowForge Fixture</title>
<style>
  :root { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2937; }
  body { margin: 0; background: #f6f7f9; }
  header { display:flex; gap:12px; align-items:center; padding:16px 24px; background:#fff; border-bottom:1px solid #e5e7eb; }
  header h1 { font-size:18px; margin:0; flex:1; }
  main { padding:24px; max-width:1080px; margin:0 auto; }
  button, input, select { font: inherit; }
  button { padding:7px 14px; border:1px solid #cbd5e1; background:#fff; border-radius:6px; cursor:pointer; }
  button.primary { background:#2563eb; color:#fff; border-color:#2563eb; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  table { width:100%; border-collapse:collapse; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.08); border-radius:8px; overflow:hidden; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid #eef2f7; font-size:14px; }
  th { background:#f1f5f9; font-weight:600; }
  dialog, [role=dialog] { border:1px solid #cbd5e1; border-radius:10px; background:#fff; padding:20px; box-shadow:0 20px 40px rgba(0,0,0,.2); }
  .overlay { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; z-index:10; }
  .overlay[hidden] { display:none; }
  .field { display:flex; flex-direction:column; gap:6px; margin-bottom:14px; }
  .field label { font-size:13px; color:#475569; }
  .field input, .field select { padding:8px; border:1px solid #cbd5e1; border-radius:6px; }
  .row-actions { display:flex; gap:8px; justify-content:flex-end; }
  #toast { position:fixed; top:16px; right:16px; background:#065f46; color:#fff; padding:10px 16px; border-radius:8px; opacity:0; transition:opacity .15s; z-index:50; }
  #toast.error { background:#991b1b; }
  #toast.show { opacity:1; }
  #region-options { display:grid; gap:6px; max-height:220px; overflow:auto; margin:10px 0; }
  [role=option] { padding:8px 10px; border:1px solid #e2e8f0; border-radius:6px; cursor:pointer; }
  [role=option][aria-selected=true] { background:#dbeafe; border-color:#93c5fd; }
  .skeleton { color:#94a3b8; }
  nav { display:flex; gap:8px; margin-bottom:16px; }
  code { background:#eef2ff; padding:2px 5px; border-radius:4px; }
</style>
${extraHead}
</head>
<body>
${body}
<script>
window.showToast = (message, isError) => {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle('error', !!isError);
  toast.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
};
</script>
</body>
</html>`;

const customersPage = () => layout(
  "客户列表",
  `<header>
    <h1>客户列表</h1>
    <button id="new-customer" data-testid="customer-new" type="button">新建客户</button>
    <button id="open-filter" data-testid="filter-open" type="button">筛选</button>
    <a href="/live">实时页</a>
    <a href="/spa">SPA</a>
  </header>
  <main>
    <div id="toast" role="status" aria-live="polite"></div>
    <p id="summary">正在加载…</p>
    <table aria-label="客户表">
      <thead><tr><th>客户名称</th><th>区域</th><th>金额</th><th>状态</th><th>需要审批</th></tr></thead>
      <tbody id="rows"><tr><td colspan="5" class="skeleton">加载中…</td></tr></tbody>
    </table>

    <div id="filter-overlay" class="overlay" hidden>
      <div role="dialog" aria-label="筛选条件" aria-modal="true">
        <h2>筛选条件</h2>
        <div class="field"><label for="filter-region">区域</label>
          <select id="filter-region" name="region"><option value="">全部</option>${REGIONS.map((r) => `<option value="${r}">${r}</option>`).join("")}</select>
        </div>
        <div class="field"><label for="filter-min">金额下限</label><input id="filter-min" name="minAmount" type="number" /></div>
        <div class="field"><label for="filter-status">状态</label>
          <select id="filter-status" name="status"><option value="">全部</option><option value="启用">启用</option><option value="停用">停用</option></select>
        </div>
        <div class="row-actions"><button id="filter-cancel">取消</button><button id="filter-query" class="primary" data-testid="filter-query">查询</button></div>
      </div>
    </div>

    <div id="new-overlay" class="overlay" hidden>
      <div role="dialog" aria-label="新建客户" aria-modal="true">
        <h2>新建客户</h2>
        <div class="field"><label for="customer-name">客户名称</label><input id="customer-name" name="customerName" data-testid="customer-name" /></div>
        <div class="field">
          <label>所属区域</label>
          <button id="region-trigger" type="button" aria-haspopup="dialog">选择区域</button>
          <span id="region-value" data-testid="region-value"></span>
        </div>
        <div class="field"><label for="customer-amount">金额</label><input id="customer-amount" name="amount" type="number" /></div>
        <div class="field"><label for="follow-date">跟进日期</label><input id="follow-date" name="followDate" type="date" /></div>
        <div class="field"><label for="needs-approval"><input id="needs-approval" name="needsApproval" type="checkbox" /> 需要审批</label></div>
        <div class="row-actions"><button id="new-cancel">取消</button><button id="new-save" class="primary" data-testid="customer-save">保存</button></div>
      </div>
    </div>

    <div id="region-overlay" class="overlay" hidden>
      <div role="dialog" aria-label="选择区域" aria-modal="true">
        <h2>选择区域</h2>
        <input id="region-search" placeholder="搜索区域" data-testid="region-search" />
        <div id="region-options" role="listbox" aria-label="区域选项"></div>
        <div class="row-actions"><button id="region-cancel">取消</button><button id="region-ok" class="primary">确定</button></div>
      </div>
    </div>
  </main>
  <script>
    const rows = document.getElementById('rows');
    const summary = document.getElementById('summary');
    let selectedRegions = [];
    let filterTimer;

    function renderRows(list) {
      rows.innerHTML = list.length
        ? list.map((c) => '<tr data-testid="customer-row" data-id="' + c.id + '"><td>' + c.name + '</td><td>' + c.regions.join('、') + '</td><td>' + c.amount + '</td><td>' + c.status + '</td><td>' + (c.needsApproval ? '是' : '否') + '</td></tr>').join('')
        : '<tr data-testid="empty-row"><td colspan="5" class="skeleton">无匹配客户</td></tr>';
      summary.textContent = '共 ' + list.length + ' 条';
    }

    async function loadCustomers(params = '') {
      const res = await fetch('/api/customers' + params);
      renderRows(await res.json());
    }

    // 800ms 异步首屏渲染
    setTimeout(() => { loadCustomers(); }, 800);

    document.getElementById('open-filter').addEventListener('click', () => {
      document.getElementById('filter-overlay').hidden = false;
    });
    document.getElementById('filter-cancel').addEventListener('click', () => {
      document.getElementById('filter-overlay').hidden = true;
    });
    document.getElementById('filter-query').addEventListener('click', async () => {
      const region = document.getElementById('filter-region').value;
      const minAmount = document.getElementById('filter-min').value;
      const status = document.getElementById('filter-status').value;
      clearTimeout(filterTimer);
      document.getElementById('filter-overlay').hidden = true;
      await loadCustomers('?filter=1&slow=600&region=' + encodeURIComponent(region) + '&minAmount=' + encodeURIComponent(minAmount) + '&status=' + encodeURIComponent(status));
    });

    document.getElementById('new-customer').addEventListener('click', () => {
      document.getElementById('new-overlay').hidden = false;
      document.getElementById('customer-name').focus();
    });
    document.getElementById('new-cancel').addEventListener('click', () => {
      document.getElementById('new-overlay').hidden = true;
    });

    const regionOverlay = document.getElementById('region-overlay');
    const regionOptions = document.getElementById('region-options');
    document.getElementById('region-trigger').addEventListener('click', async () => {
      regionOverlay.hidden = false;
      await loadRegions('');
    });
    document.getElementById('region-cancel').addEventListener('click', () => {
      regionOverlay.hidden = true;
    });
    document.getElementById('region-ok').addEventListener('click', () => {
      regionOverlay.hidden = true;
      document.getElementById('region-value').textContent = selectedRegions.join('、');
    });
    document.querySelector('#region-search').addEventListener('input', (event) => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => loadRegions(event.target.value), 200);
    });

    async function loadRegions(query) {
      const res = await fetch('/api/regions?q=' + encodeURIComponent(query));
      const list = await res.json();
      const current = new Set(selectedRegions);
      regionOptions.innerHTML = list.map((r) => '<div role="option" tabindex="0" data-value="' + r + '" aria-selected="' + (current.has(r) ? 'true' : 'false') + '">' + r + '</div>').join('');
    }

    regionOptions.addEventListener('click', (event) => {
      const option = event.target.closest('[role=option]');
      if (!option) return;
      const value = option.dataset.value;
      if (selectedRegions.includes(value)) {
        selectedRegions = selectedRegions.filter((item) => item !== value);
        option.setAttribute('aria-selected', 'false');
      } else {
        selectedRegions.push(value);
        option.setAttribute('aria-selected', 'true');
      }
    });

    document.getElementById('new-save').addEventListener('click', async () => {
      const name = document.getElementById('customer-name').value.trim();
      const amount = Number(document.getElementById('customer-amount').value || 0);
      const needsApproval = document.getElementById('needs-approval').checked;
      const followDate = document.getElementById('follow-date').value;
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, regions: selectedRegions, amount, needsApproval, followDate }),
      });
      const data = await res.json();
      if (res.status === 409) {
        showToast('客户名称已存在', true);
        return;
      }
      showToast('保存成功');
      document.getElementById('new-overlay').hidden = true;
      selectedRegions = [];
      document.getElementById('region-value').textContent = '';
      document.getElementById('customer-name').value = '';
      document.getElementById('customer-amount').value = '';
      document.getElementById('needs-approval').checked = false;
      clearTimeout(filterTimer);
      setTimeout(() => loadCustomers(), 200);
    });
  </script>`,
);

const loginPage = () => layout(
  "登录",
  `<header><h1>登录</h1></header>
  <main style="max-width:420px">
    <div id="toast" role="status"></div>
    <div class="field"><label for="username">用户名</label><input id="username" name="username" /></div>
    <div class="field"><label for="password">密码</label><input id="password" name="password" type="password" /></div>
    <button id="login" class="primary" data-testid="login-submit">登录</button>
  </main>
  <script>
    document.getElementById('login').addEventListener('click', async () => {
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      const res = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
      if (!res.ok) { showToast('登录失败', true); return; }
      localStorage.setItem('ff_user', username);
      location.href = '/customers';
    });
  </script>`,
);

const livePage = () => layout(
  "实时数据",
  `<header><h1>实时数据</h1><a href="/customers">返回列表</a></header>
  <main>
    <p data-testid="live-title">实时数据（SSE 长轮询，不会出现 networkidle）</p>
    <p id="ticker">等待数据…</p>
  </main>
  <script>
    const source = new EventSource('/api/stream');
    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      document.getElementById('ticker').textContent = 'tick ' + data.tick;
    };
  </script>`,
);

const heavyPage = () => layout(
  "重资源页",
  `<header><h1>重资源页</h1></header>
  <main>
    <p data-testid="heavy-title">重资源页</p>
    <img id="heavy" src="/assets/heavy.png" alt="重资源" width="320" height="180" />
    <p id="slow-state">第三方脚本加载中…</p>
    <script src="/analytics.js"></script>
    <script src="/assets/slow.js"></script>
  </main>`,
);

const spaPage = () => layout(
  "SPA 路由",
  `<header><h1>SPA 路由</h1></header>
  <main>
    <nav>
      <button data-tab="a" id="tab-a">页面 A</button>
      <button data-tab="b" id="tab-b">页面 B</button>
    </nav>
    <div id="view" data-testid="spa-view">当前：A</div>
  </main>
  <script>
    document.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        const tab = button.dataset.tab;
        history.pushState({}, '', '/spa?tab=' + tab);
        document.getElementById('view').textContent = '当前：' + tab.toUpperCase();
      });
    });
  </script>`,
);

const variantPage = () => layout(
  "客户变体",
  `<header><h1>客户变体</h1></header>
  <main>
    <div role="dialog" aria-label="新建客户">
      <h2>新建客户（变体）</h2>
      <div class="field"><label for="variant-name">客户全称</label><input id="variant-name" name="customerName" /></div>
      <div class="field"><label for="variant-region">所属区域</label><input id="variant-region" name="region" /></div>
      <button id="variant-save" data-testid="variant-save" class="primary">保存</button>
    </div>
  </main>`,
);

const branchPage = () => layout(
  "分支",
  `<header><h1>分支</h1></header>
  <main>
    <div class="field"><label for="branch-amount">金额</label><input id="branch-amount" name="amount" type="number" /></div>
    <div class="field"><label for="branch-type">类型</label>
      <select id="branch-type" name="type"><option value="normal">普通</option><option value="vip">VIP</option></select>
    </div>
    <div class="field"><label for="branch-note">备注</label><input id="branch-note" name="note" /></div>
    <button id="branch-submit" class="primary">提交</button>
    <p id="branch-result" data-testid="branch-result"></p>
  </main>
  <script>
    document.getElementById('branch-submit').addEventListener('click', () => {
      const amount = Number(document.getElementById('branch-amount').value || 0);
      const type = document.getElementById('branch-type').value;
      document.getElementById('branch-result').textContent = '结果：' + (amount > 1000 ? '大额' : '普通') + ' / ' + type;
    });
  </script>`,
);

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;

    if (path === "/api/health") return json(res, 200, { ok: true });

    if (path === "/api/reset" && req.method === "POST") {
      seed();
      return json(res, 200, { ok: true });
    }

    if (path === "/api/login" && req.method === "POST") {
      const body = await readBody(req);
      if (!body.username || !body.password) return json(res, 400, { error: "缺少字段" });
      res.setHeader("set-cookie", "ff_session=ok; Path=/; HttpOnly; SameSite=Lax");
      return json(res, 200, { ok: true });
    }

    if (path === "/api/regions" && req.method === "GET") {
      const q = (url.searchParams.get("q") ?? "").trim();
      await delay(1200);
      return json(res, 200, REGIONS.filter((region) => region.includes(q)));
    }

    if (path === "/api/customers" && req.method === "GET") {
      if (url.searchParams.get("slow")) await delay(Number(url.searchParams.get("slow")));
      const region = url.searchParams.get("region") ?? "";
      const status = url.searchParams.get("status") ?? "";
      const minAmount = Number(url.searchParams.get("minAmount") ?? "");
      let list = state.customers.slice();
      if (region) list = list.filter((customer) => customer.regions.includes(region));
      if (status) list = list.filter((customer) => customer.status === status);
      if (!Number.isNaN(minAmount) && url.searchParams.get("minAmount")) {
        list = list.filter((customer) => customer.amount >= minAmount);
      }
      return json(res, 200, list);
    }

    if (path === "/api/customers" && req.method === "POST") {
      const body = await readBody(req);
      await delay(300);
      const name = String(body.name ?? "").trim();
      if (!name) return json(res, 400, { error: "客户名称必填" });
      if (state.customers.some((customer) => customer.name === name)) {
        return json(res, 409, { error: "已存在" });
      }
      const regions = Array.isArray(body.regions) ? body.regions : [];
      const customer = {
        id: state.nextId++,
        name,
        regions,
        region: regions.join("、"),
        amount: Number(body.amount ?? 0),
        status: "启用",
        needsApproval: Boolean(body.needsApproval),
        followDate: String(body.followDate ?? ""),
      };
      state.customers.push(customer);
      return json(res, 200, { ok: true, id: customer.id });
    }

    if (path === "/api/stream" && req.method === "GET") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      let tick = 0;
      const timer = setInterval(() => {
        tick += 1;
        res.write(`data: {"tick":${tick}}\n\n`);
      }, 300);
      state.streams.add(timer);
      req.on("close", () => {
        clearInterval(timer);
        state.streams.delete(timer);
      });
      return;
    }

    if (path === "/assets/heavy.png") {
      const buffer = Buffer.alloc(2 * 1024 * 1024, 0x89);
      res.writeHead(200, { "content-type": "image/png", "content-length": buffer.length });
      return res.end(buffer);
    }

    if (path === "/assets/slow.js") {
      await delay(1500);
      res.writeHead(200, { "content-type": "application/javascript" });
      return res.end("document.getElementById('slow-state').textContent = '第三方脚本已加载';");
    }

    if (path === "/analytics.js") {
      res.writeHead(200, { "content-type": "application/javascript" });
      return res.end("window.__analyticsLoaded = true;");
    }

    const pages = {
      "/": customersPage,
      "/customers": customersPage,
      "/login": loginPage,
      "/live": livePage,
      "/heavy": heavyPage,
      "/spa": spaPage,
      "/variant": variantPage,
      "/branch": branchPage,
    };
    const render = pages[path];
    if (render && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(render());
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startFixtureServer(options = {}) {
  const server = createServer();
  const port = options.port ?? 0;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    server,
    port: actualPort,
    baseUrl: `http://127.0.0.1:${actualPort}`,
    close: () =>
      new Promise((resolve) => {
        for (const timer of state.streams) clearInterval(timer);
        state.streams.clear();
        server.close(() => resolve());
      }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4100);
  const { baseUrl } = await startFixtureServer({ port });
  console.log(`FlowForge fixtures listening on ${baseUrl}`);
}
