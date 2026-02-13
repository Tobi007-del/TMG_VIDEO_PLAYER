const cacheName = "TVP_offline_cache_v1.0.0";
// prettier-ignore
const precachedResources = [
  "index.html", 
  "assets/images/lone-tree.jpg", "assets/icons/movie-tape.png", "assets/icons/tmg-icon.jpeg",  "assets/icons/tmg-icon.png",
  "styles/index.css", "styles/prototype-3-video.css", "styles/T007_toast.css", "styles/T007_dialog.css", "styles/T007_input.css",
  "scripts/index.js", "scripts/prototype-3.js", "scripts/T007_toast.js",  "scripts/T007_dialog.js", "scripts/T007_input.js",
  "assets/ffmpeg/ffmpeg.min.js", "assets/ffmpeg/ffmpeg-core.js", "assets/ffmpeg/ffmpeg-core.wasm", "assets/ffmpeg/ffmpeg-core.worker.js"
];

async function precache() {
  const cache = await caches.open(cacheName);
  await cache.addAll(precachedResources);
}

function isCacheable(request) {
  const url = new URL(request.url);
  return url.origin === location.origin && !url.pathname.startsWith("/api/");
}

async function cacheFirstWithRefresh(request) {
  try {
    const fetchResponsePromise = fetch(request).then(async (networkResponse) => {
      if (networkResponse.ok) {
        const cache = await caches.open(cacheName);
        await cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    });
    return (await caches.match(request)) || (await fetchResponsePromise);
  } catch {
    return (await caches.match(request)) || Response.error();
  }
}

async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return (await caches.match(request)) || Response.error();
  }
}

addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      await precache();
      await self.skipWaiting();
    })()
  )
);

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)));
      await clients.claim();
    })()
  );
});

addEventListener("fetch", (event) => {
  if (isCacheable(event.request)) event.respondWith(networkFirst(event.request));
});
