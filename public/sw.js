// SA ERP field app service worker.
//  - App code (/_next/static) is cached on first use and served from cache.
//  - Field pages (/f…) are network-first; offline, the last copy is served.
//  - API calls are never cached here; the app keeps its own copy of the data.
const VERSION = "sa-field-v2";

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
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Only whole pages. In-app data requests (RSC) aren't cached: offline, Next
  // falls back to a full page load, which is served from here.
  if (req.mode === "navigate" && url.pathname.startsWith("/f")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Don't keep a login redirect as the offline copy.
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(url.pathname).then((hit) => hit || caches.match("/f/collect")),
        ),
    );
  }
});
