// sw.js — minimal, safe service worker for The Co-Founder PWA.
// Goals: installable + fast, but NEVER serve a stale app after a deploy.
//  - The HTML shell is always network-first (so new deploys show immediately, even for returning users).
//  - Static assets use stale-while-revalidate (fast, but self-update on the next load).
//  - The chat API + health check are never touched.
// Bump CACHE when you want to force-clear old caches; the SWR/network-first design means you rarely need to.
const CACHE = "cofounder-v2";
// Only precache things that don't change per deploy. The HTML is deliberately NOT precached —
// it's handled network-first below, and the navigation handler keeps a fresh offline copy.
const SHELL = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Treat the document itself and any .html as HTML that must stay fresh.
function isHTML(req, url) {
  return req.mode === "navigate"
    || url.pathname === "/"
    || url.pathname.endsWith(".html")
    || (req.headers.get("accept") || "").includes("text/html");
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                 // leave cross-origin alone
  if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") return; // never cache API/stream

  // HTML: network-first, so a fresh deploy is seen right away; fall back to the last good copy offline.
  if (isHTML(req, url)) {
    e.respondWith(
      fetch(req)
        .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put("/index.html", cp)); return r; })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/index.html")))
    );
    return;
  }

  // Static assets: stale-while-revalidate — serve cache instantly, refresh it in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((r) => {
        if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
        return r;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
