import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { activeGoals, daysBefore, isoAddDays, LIISU_GOAL_V2_FROM, liisuTracker, tallinnISO } from "../logic.js";

// Pin these. `main` moves when a release merges, and the upgrade check has to
// keep booting the worker that was actually installed.
// v2 cached bare logic.js, which does not export maxTracker.
const V2_COMMIT = "4130fd5";
// Phones on the current release: Max cache v3, Liisu cache v1, shared ?v=3.
const INSTALLED_COMMIT = "1251c0e";

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

function writeRepoFiles(dir, rev, files) {
  for (const file of files) {
    const dest = join(dir, file);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, gitShow(`${rev}:${file}`));
  }
}

function copyIcons(dir, iconDir) {
  mkdirSync(join(dir, iconDir), { recursive: true });
  for (const icon of ["icon-192.png", "icon-512.png"]) {
    writeFileSync(join(dir, iconDir, icon), readFileSync(join(root, iconDir, icon)));
  }
}

function writeOldSite(dir) {
  writeRepoFiles(dir, V2_COMMIT, ["index.html", "logic.js", "sw.js", "manifest.webmanifest"]);
  copyIcons(dir, "icons");
}

function writeInstalledSite(dir) {
  writeRepoFiles(dir, INSTALLED_COMMIT, [
    "index.html",
    "app.js",
    "logic.js",
    "styles.css",
    "sw.js",
    "manifest.webmanifest",
    "liisu/index.html",
    "liisu/sw.js",
    "liisu/manifest.webmanifest",
  ]);
  copyIcons(dir, "icons");
  copyIcons(dir, "liisu/icons");
}

function logicRev(swSource) {
  const match = swSource.match(/logic\.js\?v=(\d+)/);
  if (!match) return "";
  return match[1];
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
    const forceOldWorker = mode === "new" && (relPath === "sw.js" || relPath === "liisu/sw.js");
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
        descs: [...document.querySelectorAll(".kpi .desc")].map((el) => el.textContent),
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
    assert.deepEqual(viewed.descs, [], "Max's goals render without description lines");
    assert.equal(viewed.controller.endsWith("/sw.js"), true);
    assert.ok(viewed.cacheNames.includes("max-daily-score-v2"));
    assert.equal(viewed.cachedLogicHasMaxTracker, false);
    assert.equal(viewed.stored.marker, "keep");
    assert.equal(viewed.stored.days["2026-10-20"].v.delegate, true);
    assert.ok(server.requests.some((url) => url.startsWith("/logic.js?v=5")));
    assert.ok(server.requests.some((url) => url.startsWith("/app.js?v=5")));
  } finally {
    await browser.close();
    await server.close();
    rmSync(oldDir, { recursive: true, force: true });
  }
});

async function launchChrome(t) {
  const chrome = chromePath();
  if (!chrome) {
    t.skip("Chrome is not installed");
    return null;
  }
  let puppeteer;
  try {
    ({ default: puppeteer } = await import("puppeteer-core"));
  } catch {
    t.skip("puppeteer-core is not installed");
    return null;
  }
  return puppeteer.launch({
    executablePath: chrome,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

async function waitForController(page, server) {
  try {
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15000 });
  } catch (err) {
    err.message += `\nrequests: ${server.requests.join("\n")}`;
    throw err;
  }
}

test("installed v3 worker renders the new page from ?v=5 modules", { timeout: 60000 }, async (t) => {
  const browser = await launchChrome(t);
  if (!browser) return;

  const oldDir = mkdtempSync(join(tmpdir(), "score-v3-"));
  writeInstalledSite(oldDir);
  const oldSw = readFileSync(join(oldDir, "sw.js"), "utf8");
  const oldLogic = readFileSync(join(oldDir, "logic.js"), "utf8");
  assert.match(oldSw, /const CACHE_NAME = "max-daily-score-v3"/);
  assert.equal(logicRev(oldSw), "3");
  assert.equal(oldLogic.includes("maxTracker"), true);
  assert.equal(oldLogic.includes("Orange light"), false);

  const server = await startServer(oldDir);
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("favicon")) errors.push(msg.text());
    });
    await page.goto(server.origin + "/", { waitUntil: "networkidle0" });
    await waitForController(page, server);

    const seeded = await page.evaluate(async () => {
      const cache = await caches.open("max-daily-score-v3");
      const keys = await cache.keys();
      const logicKey = keys.find((key) => new URL(key.url).pathname.endsWith("/logic.js"));
      const logic = logicKey ? await (await cache.match(logicKey)).text() : "";
      return {
        cacheNames: await caches.keys(),
        logicSearch: logicKey ? new URL(logicKey.url).search : "",
        logicHasOrange: logic.includes("Orange light"),
      };
    });
    assert.ok(seeded.cacheNames.includes("max-daily-score-v3"));
    assert.equal(seeded.logicSearch, "?v=3");
    assert.equal(seeded.logicHasOrange, false);

    server.setMode("new");
    const marked = server.requests.length;
    errors.length = 0;
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector(".kpi .title", { timeout: 10000 });
    const today = tallinnISO();
    const todayGoals = activeGoals(today).map((goal) => goal.title);
    const viewed = await page.evaluate(async () => ({
      titles: [...document.querySelectorAll(".kpi .title")].map((el) => el.textContent),
      descs: [...document.querySelectorAll(".kpi .desc")].map((el) => el.textContent),
      note: document.getElementById("dayNote").textContent,
      label: document.querySelector("#day-label").innerText,
      dots: [...document.querySelectorAll("#history .row")].map((row) => row.querySelectorAll(".dot").length),
      cacheNames: await caches.keys(),
    }));
    const fresh = server.requests.slice(marked);
    assert.deepEqual(errors, []);
    assert.equal(viewed.label.startsWith("Today"), true);
    assert.deepEqual(viewed.titles, todayGoals);
    assert.deepEqual(viewed.descs, [], "Max's goals render without description lines");
    assert.equal(viewed.titles.includes("Orange light"), false);
    assert.match(viewed.note, new RegExp(`This day 0/${todayGoals.length}`));
    const expectedDots = [];
    for (let i = 0; i < 14; i++) expectedDots.push(activeGoals(isoAddDays(today, -i)).length);
    assert.deepEqual(viewed.dots, expectedDots);
    assert.ok(viewed.cacheNames.includes("max-daily-score-v3"));
    assert.ok(fresh.some((url) => url.startsWith("/logic.js?v=5")));
    assert.ok(fresh.some((url) => url.startsWith("/app.js?v=5")));

    const earlier = "2026-10-27";
    if (earlier <= today) {
      const steps = daysBefore(earlier, today);
      await page.evaluate((n) => {
        for (let i = 0; i < n; i++) document.getElementById("day-prev").click();
      }, steps);
      const earlierGoals = activeGoals(earlier).map((goal) => goal.title);
      const back = await page.evaluate(() => ({
        titles: [...document.querySelectorAll(".kpi .title")].map((el) => el.textContent),
        descs: [...document.querySelectorAll(".kpi .desc")].map((el) => el.textContent),
        note: document.getElementById("dayNote").textContent,
        label: document.querySelector("#day-label").innerText,
      }));
      assert.equal(earlierGoals.length, 9);
      assert.deepEqual(back.titles, earlierGoals);
      assert.equal(back.titles.includes("2l of water"), false);
      assert.equal(back.titles.includes("Vitamins"), false);
      assert.deepEqual(back.descs, [], "earlier Max days also hide description lines");
      assert.match(back.note, /This day 0\/9/);
      assert.equal(back.label.includes("27 Oct 2026"), true);

      if (steps > 0) {
        await page.click("#day-label");
        const returned = await page.evaluate(() => ({
          titles: [...document.querySelectorAll(".kpi .title")].map((el) => el.textContent),
          descs: [...document.querySelectorAll(".kpi .desc")].map((el) => el.textContent),
          label: document.querySelector("#day-label").innerText,
        }));
        assert.equal(returned.label.startsWith("Today"), true);
        assert.deepEqual(returned.titles, todayGoals);
        assert.deepEqual(returned.descs, []);
      }
    }
  } finally {
    await browser.close();
    await server.close();
    rmSync(oldDir, { recursive: true, force: true });
  }
});

test("installed Liisu worker renders six goals today and five on earlier days", { timeout: 60000 }, async (t) => {
  const browser = await launchChrome(t);
  if (!browser) return;

  const oldDir = mkdtempSync(join(tmpdir(), "score-liisu-"));
  writeInstalledSite(oldDir);
  const oldSw = readFileSync(join(oldDir, "liisu/sw.js"), "utf8");
  const oldLogic = readFileSync(join(oldDir, "logic.js"), "utf8");
  assert.match(oldSw, /const CACHE_NAME = "liisu-daily-score-v1"/);
  assert.equal(logicRev(oldSw), "3");
  assert.equal(oldLogic.includes("Orange light"), false);

  const server = await startServer(oldDir);
  const errors = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("favicon")) errors.push(msg.text());
    });
    await page.goto(server.origin + "/liisu/", { waitUntil: "networkidle0" });
    await waitForController(page, server);

    const seeded = await page.evaluate(async () => {
      const cache = await caches.open("liisu-daily-score-v1");
      const keys = await cache.keys();
      const logicKey = keys.find((key) => new URL(key.url).pathname.endsWith("/logic.js"));
      const logic = logicKey ? await (await cache.match(logicKey)).text() : "";
      return {
        cacheNames: await caches.keys(),
        logicSearch: logicKey ? new URL(logicKey.url).search : "",
        logicHasOrange: logic.includes("Orange light"),
        controller: navigator.serviceWorker.controller.scriptURL,
      };
    });
    assert.deepEqual(seeded.cacheNames, ["liisu-daily-score-v1"]);
    assert.equal(seeded.logicSearch, "?v=3");
    assert.equal(seeded.logicHasOrange, false);
    assert.equal(seeded.controller.endsWith("/liisu/sw.js"), true);

    server.setMode("new");
    const marked = server.requests.length;
    errors.length = 0;
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector(".kpi .title", { timeout: 10000 });

    const today = tallinnISO();
    const todayGoals = liisuTracker.activeGoals(today);
    const todayTitles = todayGoals.map((goal) => goal.title);
    const viewed = await page.evaluate(() => ({
      titles: [...document.querySelectorAll(".kpi .title")].map((el) => el.textContent),
      descs: [...document.querySelectorAll(".kpi .desc")].map((el) => el.textContent),
      note: document.getElementById("dayNote").textContent,
      label: document.querySelector("#day-label").innerText,
      dots: [...document.querySelectorAll("#history .row")].map((row) => row.querySelectorAll(".dot").length),
    }));
    const fresh = server.requests.slice(marked);
    assert.deepEqual(errors, []);
    assert.equal(viewed.label.startsWith("Today"), true);
    assert.deepEqual(viewed.titles, todayTitles);
    assert.deepEqual(viewed.descs, todayGoals.map((goal) => goal.desc));
    assert.equal(viewed.titles.includes("2l of water"), false);
    assert.equal(viewed.titles.includes("Vitamins"), false);
    assert.match(viewed.note, new RegExp(`This day 0/${todayTitles.length}`));
    const expectedDots = [];
    for (let i = 0; i < 14; i++) expectedDots.push(liisuTracker.activeGoals(isoAddDays(today, -i)).length);
    assert.deepEqual(viewed.dots, expectedDots);
    assert.ok(fresh.some((url) => url.startsWith("/logic.js?v=5")));
    assert.ok(fresh.some((url) => url.startsWith("/app.js?v=5")));

    const before = isoAddDays(LIISU_GOAL_V2_FROM, -1);
    if (before <= today) {
      const steps = daysBefore(before, today);
      await page.evaluate((n) => {
        for (let i = 0; i < n; i++) document.getElementById("day-prev").click();
      }, steps);
      const earlierGoalSet = liisuTracker.activeGoals(before);
      const earlierGoals = earlierGoalSet.map((goal) => goal.title);
      const earlier = await page.evaluate(() => ({
        titles: [...document.querySelectorAll(".kpi .title")].map((el) => el.textContent),
        descs: [...document.querySelectorAll(".kpi .desc")].map((el) => el.textContent),
        note: document.getElementById("dayNote").textContent,
      }));
      assert.deepEqual(earlier.titles, earlierGoals);
      assert.deepEqual(earlier.descs, earlierGoalSet.map((goal) => goal.desc));
      assert.equal(earlier.titles.includes("Orange light"), false);
      assert.match(earlier.note, new RegExp(`This day 0/${earlierGoals.length}`));

      await page.click(".kpi .pill");
      const logged = await page.evaluate((iso) => {
        const data = JSON.parse(localStorage.getItem("liisu_daily_score_v1"));
        return {
          note: document.getElementById("dayNote").textContent,
          day: data.days[iso],
          maxKey: localStorage.getItem("max_daily_score_v1"),
        };
      }, before);
      assert.match(logged.note, new RegExp(`This day 1/${earlierGoals.length}`));
      assert.equal(logged.day.v[liisuTracker.activeGoals(before)[0].id], true);
      assert.equal(logged.day.v.orange, undefined);
      assert.equal(logged.maxKey, null);

      if (steps > 0) {
        await page.click("#day-label");
        const back = await page.evaluate(() => ({
          titles: [...document.querySelectorAll(".kpi .title")].map((el) => el.textContent),
          descs: [...document.querySelectorAll(".kpi .desc")].map((el) => el.textContent),
          note: document.getElementById("dayNote").textContent,
          label: document.querySelector("#day-label").innerText,
        }));
        assert.equal(back.label.startsWith("Today"), true);
        assert.deepEqual(back.titles, todayTitles);
        assert.deepEqual(back.descs, todayGoals.map((goal) => goal.desc));
        assert.match(back.note, new RegExp(`This day 0/${todayTitles.length}`));
      }
    }
  } finally {
    await browser.close();
    await server.close();
    rmSync(oldDir, { recursive: true, force: true });
  }
});
