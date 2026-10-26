// Offline cache for Max's app. Scope is the site root (this file's directory).
// Liisu's worker lives at ./liisu/sw.js and owns the /liisu/ scope. Cache names
// are prefixed so one app's activate step cannot delete the other's cache.
//
// SHARED PRECACHE: app.js, logic.js, and styles.css are cached here and in
// liisu/sw.js. If you change one of those files, bump ?v= everywhere it is
// referenced and bump BOTH cache names.
const CACHE_NAME = "max-daily-score-v4";
const CACHE_PREFIX = "max-daily-score-";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js?v=4",
  "./logic.js?v=4",
  "./styles.css?v=4",
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
  // The installed v2 worker stored every navigation, including /liisu/, under
  // ./index.html. Ignore those requests here. activate deletes max-daily-score-v2,
  // so a poisoned index entry does not survive this worker taking control.
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
