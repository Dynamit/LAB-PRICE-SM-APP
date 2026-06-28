/* Service worker — offline-first, dependency-free.
 * To ship an update (new code OR new data): bump CACHE_VERSION and redeploy.
 * The old cache is deleted on activate; the app shows an "update available"
 * banner and reloads when the user taps it. */
const CACHE_VERSION = "v1";
const CACHE_NAME = "lab-calc-" + CACHE_VERSION;

// Everything the app needs to run with no network at all.
const PRECACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.webmanifest",
  // data
  "./assets/data/lab_prices.json",
  "./assets/data/lab_details.json",
  "./assets/data/lab_details_haifa.json",
  // brand
  "./assets/logo_final.png",
  // icons
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-192-maskable.png",
  "./assets/icons/icon-512-maskable.png",
  "./assets/icons/apple-touch-icon-180.png",
  // PDF libraries (vendored, offline)
  "./assets/lib/jspdf.umd.min.js",
  "./assets/lib/html2canvas.min.js",
  // fonts
  "./assets/fonts/fonts.css",
  "./assets/fonts/frank-ruhl-libre-500-hebrew.woff2",
  "./assets/fonts/frank-ruhl-libre-500-latin.woff2",
  "./assets/fonts/frank-ruhl-libre-700-hebrew.woff2",
  "./assets/fonts/frank-ruhl-libre-700-latin.woff2",
  "./assets/fonts/frank-ruhl-libre-900-hebrew.woff2",
  "./assets/fonts/frank-ruhl-libre-900-latin.woff2",
  "./assets/fonts/heebo-400-hebrew.woff2",
  "./assets/fonts/heebo-400-latin.woff2",
  "./assets/fonts/heebo-500-hebrew.woff2",
  "./assets/fonts/heebo-500-latin.woff2",
  "./assets/fonts/heebo-600-hebrew.woff2",
  "./assets/fonts/heebo-600-latin.woff2",
  "./assets/fonts/heebo-700-hebrew.woff2",
  "./assets/fonts/heebo-700-latin.woff2",
  "./assets/fonts/heebo-800-hebrew.woff2",
  "./assets/fonts/heebo-800-latin.woff2"
];

// Precache the app shell. Do NOT skipWaiting here — the page drives the update
// via the "update available" banner so data never changes under the user's feet.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
});

// Drop caches from older versions, then take control of open pages.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith("lab-calc-") && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Let the page tell us to activate the new worker immediately (banner "reload").
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Cache-first. Everything needed is precached, so this works fully offline.
// Navigations fall back to the cached index.html (covers start_url + refresh).
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      caches.match("./index.html").then((cached) => cached || fetch(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Runtime-cache any same-origin GET we didn't precache.
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
