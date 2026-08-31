// UI DOM smoke: loads the built frontend in headless Chromium and fails when
// the app crashes at startup (e.g. error boundary, provider errors). This is
// the net that catches "merged but the app will not open" regressions.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const distRoot = resolve("apps/web/dist");
if (!existsSync(join(distRoot, "index.html"))) {
  console.error("ui-dom-smoke: apps/web/dist/index.html 不存在，请先执行 pnpm --filter @xiling/web build");
  process.exit(1);
}

let playwright;
try {
  playwright = await import("playwright");
} catch {
  console.log("ui-dom-smoke: 未安装 playwright，跳过（CI 中会安装并执行）");
  process.exit(0);
}

const mimeTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  // 冒烟环境没有后端：给前端启动所需的 API 提供最小桩，让应用渲染空状态而不是崩溃。
  if (url.pathname.startsWith("/api/")) {
    response.setHeader("content-type", "application/json");
    if (url.pathname === "/api/v1/projects") return response.end("[]");
    if (url.pathname === "/api/settings/models") return response.end(JSON.stringify({ runtime: { mode: "offline", ready: false }, catalog: [], configuredProviderIds: [] }));
    return response.end("[]");
  }
  let filePath = join(distRoot, normalize(url.pathname).replace(/^[/\\]+/, ""));
  if (!filePath.startsWith(distRoot) || !existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(distRoot, "index.html");
  response.setHeader("content-type", mimeTypes[extname(filePath)] ?? "application/octet-stream");
  response.end(readFileSync(filePath));
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const baseUrl = `http://127.0.0.1:${server.address().port}/`;

const browser = await playwright.chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));

try {
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  const bodyText = (await page.textContent("body")) ?? "";
  const failures = [];
  if (bodyText.includes("无法启动当前视图")) failures.push("首页渲染了启动失败错误边界");
  if (bodyText.trim().length < 10) failures.push("首页内容为空");
  if (pageErrors.length) failures.push(`页面出现未捕获错误：${pageErrors.join(" | ")}`);
  if (failures.length) {
    console.error("ui-dom-smoke 失败：");
    for (const failure of failures) console.error(` - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("ui-dom-smoke 通过：首页正常渲染，无未捕获错误。");
  }
} finally {
  await browser.close();
  server.close();
}
