/* GUIDON service worker.
 *
 * The app is one large self-contained HTML file, so the caching model is
 * deliberately simple: precache the shell on install, serve it cache-first,
 * and treat a new build as a whole new cache generation.
 *
 * VERSION is rewritten at build time with a content hash of index.html, so a
 * changed build always produces a new cache name and always triggers the
 * update flow. Never edit it by hand.
 */
const VERSION = "__GUIDON_BUILD__";
const CACHE = "guidon-" + VERSION;

/* Everything needed to boot with the network switched off. */
const PRECACHE = [
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  // The DA 4856 PDF stack is loaded on demand rather than at boot, but it is
  // still precached: a Soldier must be able to export a counseling form with no
  // signal. Deferring the PARSE must not cost the offline guarantee.
  "./assets/pdf-lib.js",
  "./assets/da4856.js",
];

// The one entry the fetch handler's navigation path depends on cache-first
// (see "req.mode === navigate" below) - if this specifically didn't cache,
// the install must not be accepted as successful.
const CRITICAL = ["./index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      let criticalOk = true;
      // Individually, so one missing optional icon cannot fail the whole install
      // and leave the app with no offline capability at all - but track the
      // one entry that actually matters (index.html) separately: this used
      // to swallow that failure the same as an icon's, so install() could
      // report success on a transient network blip while the critical shell
      // silently never made it into the cache.
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const res = await fetch(new Request(url, { cache: "reload" }));
            if (res.ok) { await cache.put(url, res); }
            else if (CRITICAL.includes(url)) { criticalOk = false; }
          } catch (e) {
            if (CRITICAL.includes(url)) criticalOk = false;
            /* non-fatal for everything else: shell still caches */
          }
        })
      );
      if (!criticalOk) {
        // Don't accept this install. Failing here (rather than resolving)
        // means the browser treats install as failed: this cache generation
        // is discarded and any previously-working service worker (and its
        // cache) stays active and serving in the meantime - strictly safer
        // than silently accepting an incomplete new generation.
        try { await caches.delete(CACHE); } catch (e) {}
        throw new Error("GUIDON SW install: critical precache entry failed (" + CRITICAL.join(",") + ")");
      }
      // Deliberately NOT skipWaiting() here. The page decides when to activate a
      // new version, so a Soldier mid-drill is never swapped out from under.
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("guidon-") && n !== CACHE).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

/* The page posts this after the user accepts an update prompt. */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "GET_VERSION") {
    event.ports && event.ports[0] && event.ports[0].postMessage({ version: VERSION });
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // app makes no cross-origin requests

  // Navigations always resolve to the cached shell first. This is what makes
  // the app open instantly and work with no signal.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cached = await caches.match("./index.html", { ignoreSearch: true });
        if (cached) return cached;
        try {
          return await fetch(req);
        } catch (e) {
          return new Response("<h1>GUIDON is offline and not yet cached.</h1>", {
            status: 503,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === "basic") {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch (e) {
        return new Response("", { status: 504 });
      }
    })()
  );
});
