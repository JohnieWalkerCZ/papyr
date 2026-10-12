const CACHE = "papyr-shell-v1";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/icons/papyr-192.png", "/icons/papyr-512.png"])),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith("papyr-shell-") && key !== CACHE).map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // shortcut: cache all same-origin GETs without a size cap; replace with bounded policies before library assets grow.
  event.respondWith(
    fetch(request)
      .then((response) => {
        return response.ok
          ? caches.open(CACHE).then((cache) => cache.put(request, response.clone()).then(() => response))
          : response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode !== "navigate") return Response.error();
        return caches.match("/");
      }),
  );
});
