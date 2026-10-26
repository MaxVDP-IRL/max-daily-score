// Offline cache for Liisu's app. Default scope is /liisu/, which is more
// specific than Max's root worker, so the two registrations do not share clients.
// Only caches named liisu-daily-score-* are deleted here.
//
// SHARED PRECACHE: app.js, logic.js, and styles.css are cached here and in
// ../sw.js. If you change one of those files, bump ?v= everywhere it is
// referenced and bump BOTH cache names.
const CACHE_NAME = "liisu-daily-score-v2";
const CACHE_PREFIX = "liisu-daily-score-";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./sw.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "../styles.css?v=4",
  "../app.js?v=4",
  "../logic.js?v=4"
];

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

  // Cache-first for static assets, including the shared files above this directory.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
