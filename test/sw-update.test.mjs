import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { activeGoals, tallinnISO } from "../logic.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".json": "application/json",
};

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/local/bin/google-chrome",
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path)) || null;
}

function gitShow(spec) {
  const result = spawnSync("git", ["show", spec], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git show ${spec} failed`);
  return result.stdout;
}

function writeOldSite(dir) {
  mkdirSync(join(dir, "icons"), { recursive: true });
  writeFileSync(join(dir, "index.html"), gitShow("main:index.html"));
  writeFileSync(join(dir, "logic.js"), gitShow("main:logic.js"));
  writeFileSync(join(dir, "sw.js"), gitShow("main:sw.js"));
  writeFileSync(join(dir, "manifest.webmanifest"), gitShow("main:manifest.webmanifest"));
  for (const icon of ["icon-192.png", "icon-512.png"]) {
    writeFileSync(join(dir, "icons", icon), readFileSync(join(root, "icons", icon)));
  }
}

function startServer(oldDir) {
  let mode = "old";
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    requests.push(url.pathname + url.search);
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const relPath = rel.replace(/^\/+/, "");
    const fileName = relPath.split("/").pop();
    // Keep serving the installed v2 worker after the rest of the site is new.
    const forceOldWorker = mode === "new" && relPath === "sw.js";
    const base = resolve(mode === "old" || forceOldWorker ? oldDir : root);
    const filePath = resolve(base, relPath);
    if (filePath !== base && !filePath.startsWith(base + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = readFileSync(filePath);
      res.writeHead(200, {
        "content-type": TYPES[extname(fileName)] || "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("missing");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        requests,
        setMode(next) { mode = next; },
        close() { return new Promise((done) => server.close(() => done())); },
      });
    });
  });
}

test("new index renders against a v2 cache that still holds the old logic.js", { timeout: 60000 }, async (t) => {
  const chrome = chromePath();
  if (!chrome) {
    t.skip("Chrome is not installed");
    return;
  }
  let puppeteer;
  try {
    ({ default: puppeteer } = await import("puppeteer-core"));
  } catch {
    t.skip("puppeteer-core is not installed");
    return;
  }

  const oldDir = mkdtempSync(join(tmpdir(), "score-v2-"));
  writeOldSite(oldDir);
  assert.equal(readFileSync(join(oldDir, "sw.js"), "utf8").includes('max-daily-score-v2'), true);
  assert.equal(readFileSync(join(oldDir, "logic.js"), "utf8").includes("maxTracker"), false);

  const server = await startServer(oldDir);
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("favicon")) errors.push(msg.text());
    });

    await page.goto(server.origin + "/", { waitUntil: "networkidle0" });
    try {
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15000 });
    } catch (err) {
      err.message += `\nrequests: ${server.requests.join("\n")}`;
      throw err;
    }

    const seeded = await page.evaluate(async () => {
      localStorage.setItem("max_daily_score_v1", JSON.stringify({
        days: { "2026-10-20": { ts: 1, v: { delegate: true } } },
        marker: "keep",
      }));
      const cache = await caches.open("max-daily-score-v2");
      const keys = await cache.keys();
      const logicKey = keys.find((key) => new URL(key.url).pathname.endsWith("/logic.js"));
      const logic = logicKey ? await (await cache.match(logicKey)).text() : "";
      return {
        cacheNames: await caches.keys(),
        controller: navigator.serviceWorker.controller.scriptURL,
        logicHasMaxTracker: logic.includes("maxTracker"),
        logicHasV2: logic.includes("GOAL_V2_FROM"),
      };
    });
    assert.deepEqual(seeded.cacheNames, ["max-daily-score-v2"]);
    assert.equal(seeded.controller.endsWith("/sw.js"), true);
    assert.equal(seeded.logicHasMaxTracker, false);
    assert.equal(seeded.logicHasV2, true);

    server.setMode("new");
    errors.length = 0;
    await page.reload({ waitUntil: "networkidle0" });
    try {
      await page.waitForSelector(".kpi .title", { timeout: 10000 });
    } catch (err) {
      const html = await page.content();
      err.message += `\npage errors: ${JSON.stringify(errors)}\nhtml: ${html.slice(0, 500)}\nrequests: ${server.requests.join("\n")}`;
      throw err;
    }

    const viewed = await page.evaluate(async () => {
      const cache = await caches.open("max-daily-score-v2");
      const keys = await cache.keys();
      const logicKey = keys.find((key) => {
        const url = new URL(key.url);
        return url.pathname.endsWith("/logic.js") && url.search === "";
      });
      const logic = logicKey ? await (await cache.match(logicKey)).text() : "";
      return {
        titles: [...document.querySelectorAll(".kpi .title")].map((el) => el.textContent),
        label: document.querySelector("#day-label").innerText,
        controller: navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL,
        cacheNames: await caches.keys(),
        cachedLogicHasMaxTracker: logic.includes("maxTracker"),
        stored: JSON.parse(localStorage.getItem("max_daily_score_v1")),
      };
    });

    assert.deepEqual(errors, []);
    assert.equal(viewed.label.startsWith("Today"), true);
    assert.deepEqual(viewed.titles, activeGoals(tallinnISO()).map((goal) => goal.title));
    assert.equal(viewed.controller.endsWith("/sw.js"), true);
    assert.ok(viewed.cacheNames.includes("max-daily-score-v2"));
    assert.equal(viewed.cachedLogicHasMaxTracker, false);
    assert.equal(viewed.stored.marker, "keep");
    assert.equal(viewed.stored.days["2026-10-20"].v.delegate, true);
    assert.ok(server.requests.some((url) => url.startsWith("/logic.js?v=")));
    assert.ok(server.requests.some((url) => url.startsWith("/app.js?v=")));
  } finally {
    await browser.close();
    await server.close();
    rmSync(oldDir, { recursive: true, force: true });
  }
});
