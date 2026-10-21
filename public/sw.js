// SA ERP field app service worker.
//  - App code (/_next/static) is cached on first use and served from cache.
//  - Field pages (/f…) are network-first; offline, the last copy is served.
//  - API calls are never cached here; the app keeps its own copy of the data.
const VERSION = "sa-field-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(["/icons/icon.svg", "/manifest.json"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  const isFieldPage = req.mode === "navigate" && url.pathname.startsWith("/f");
  const isFieldData = url.pathname.startsWith("/f") && req.headers.get("RSC") === "1";
  if (isFieldPage || isFieldData) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Don't keep a login redirect as the offline copy.
          if (res.ok && !res.redirected) caches.open(VERSION).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("/f/collect", { ignoreSearch: true })),
        ),
    );
  }
});
