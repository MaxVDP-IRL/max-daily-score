// Offline cache for Max's app. Scope is the site root (this file's directory).
// Liisu's worker lives at ./liisu/sw.js and owns the /liisu/ scope. Cache names
// are prefixed so one app's activate step cannot delete the other's cache.
const CACHE_NAME = "max-daily-score-v3";
const CACHE_PREFIX = "max-daily-score-";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./logic.js",
  "./styles.css",
  "./manifest.webmanifest",
  "./sw.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

function isLiisuPath(pathname) {
  return /\/liisu(\/|$)/.test(pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => (
      k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME ? caches.delete(k) : null
    )))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Pages under /liisu/ belong to Liisu's worker. Do not answer them, and do
  // not store her documents in this cache.
  if (url.origin === self.location.origin && isLiisuPath(url.pathname)) return;

  // Network-first for navigations so updates propagate, with cache fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
        return res;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Cache-first for static assets.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
