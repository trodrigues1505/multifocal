const CACHE = "multifocal-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase-config.js",
  "./manifest.json",
  "./logo.png",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", e => {
  self.skipWaiting(); // activate immediately, don't wait
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => {
        console.log("[SW] Deleting old cache:", k);
        return caches.delete(k);
      }))
    ).then(() => self.clients.claim()) // take control of all open tabs
  );
});

self.addEventListener("fetch", e => {
  const url = e.request.url;
  // Always network-first for Firebase and CDN resources
  if (url.includes("firestore.googleapis.com") ||
      url.includes("firebase") ||
      url.includes("gstatic.com/firebasejs") ||
      url.includes("googleapis.com") ||
      url.includes("jsdelivr.net") ||
      url.includes("fonts.")) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // Network-first for app files too (always fresh)
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
