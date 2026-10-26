import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// app.js, logic.js, and styles.css are precached by both service workers.
// Editing any of them means bumping SHARED_REV and both cache names together.
const SHARED_REV = "4";
const MAX_CACHE = "max-daily-score-v4";
const LIISU_CACHE = "liisu-daily-score-v2";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("shared assets use one revision in both workers and both pages", () => {
  const index = read("index.html");
  const liisu = read("liisu/index.html");
  const app = read("app.js");
  const maxSw = read("sw.js");
  const liisuSw = read("liisu/sw.js");
  const rev = `?v=${SHARED_REV}`;

  for (const [name, source, needles] of [
    ["index.html", index, [`./app.js${rev}`, `./logic.js${rev}`, `styles.css${rev}`]],
    ["liisu/index.html", liisu, [`../app.js${rev}`, `../logic.js${rev}`, `../styles.css${rev}`]],
    ["app.js", app, [`./logic.js${rev}`]],
    ["sw.js", maxSw, [`./app.js${rev}`, `./logic.js${rev}`, `./styles.css${rev}`]],
    ["liisu/sw.js", liisuSw, [`../app.js${rev}`, `../logic.js${rev}`, `../styles.css${rev}`]],
  ]) {
    for (const needle of needles) {
      assert.ok(source.includes(needle), `${name} is missing ${needle}`);
    }
  }

  assert.doesNotMatch(app, /from "\.\/logic\.js";/);
  assert.doesNotMatch(index, /from "\.\/app\.js";/);
  assert.doesNotMatch(index, /from "\.\/logic\.js";/);
  assert.doesNotMatch(liisu, /from "\.\.\/app\.js";/);
  assert.doesNotMatch(liisu, /from "\.\.\/logic\.js";/);

  assert.match(maxSw, new RegExp(`const CACHE_NAME = "${MAX_CACHE}"`));
  assert.match(liisuSw, new RegExp(`const CACHE_NAME = "${LIISU_CACHE}"`));
  assert.match(maxSw, /SHARED PRECACHE:/);
  assert.match(liisuSw, /SHARED PRECACHE:/);
  assert.notEqual(MAX_CACHE, LIISU_CACHE);
});
