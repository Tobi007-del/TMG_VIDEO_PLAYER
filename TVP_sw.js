const cacheName = "TVP_offline_cache_v1.0.0";
const whiteList = [location.origin, "https://fonts.googleapis.com", "https://unpkg.com"];
// prettier-ignore
const preCachedResources = [
  "index.html", 
  "assets/images/lone-tree.jpg", "assets/icons/movie-tape.png", "assets/icons/tmg-icon.jpeg",  "assets/icons/tmg-icon.png",
  "styles/index.css", "styles/prototype-3-video.css", "styles/T007_toast.css", "styles/T007_dialog.css", "styles/T007_input.css",
  "scripts/index.js", "scripts/prototype-3.js", "scripts/T007_toast.js",  "scripts/T007_dialog.js", "scripts/T007_input.js",
  "assets/ffmpeg/ffmpeg.min.js", "assets/ffmpeg/ffmpeg-core.js", "assets/ffmpeg/ffmpeg-core.wasm", "assets/ffmpeg/ffmpeg-core.worker.js"
];

async function preCache() {
  const cache = await caches.open(cacheName);
  await Promise.all(preCachedResources.map((url) => cache.add(url).catch((e) => console.error("TVP couldn't pre cache: ", e))));
}

function isCacheable(request) {
  const url = new URL(request.url);
  return whiteList.includes(url.origin) && !url.pathname.startsWith("/api/");
}

async function cacheFirstWithRefresh(request) {
  try {
    const fetchResponsePromise = fetch(request).then(async (networkResponse) => {
      if (networkResponse.ok || networkResponse.status === 0) {
        const cache = await caches.open(cacheName);
        await cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    });
    return (await caches.match(request)) || (await fetchResponsePromise);
  } catch (e) {
    console.error("TVP couldn't cache first: ", e);
    return (await caches.match(request)) || Response.error();
  }
} // stale-while-revalidate

async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok || networkResponse.status === 0) {
      const cache = await caches.open(cacheName);
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (e) {
    console.error("TVP couldn't network first: ", e);
    return (await caches.match(request)) || Response.error();
  }
} // network-first

addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      await preCache();
      await self.skipWaiting();
    })()
  )
);

addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)));
      await clients.claim();
    })()
  )
);

addEventListener("fetch", (event) => {
  if (!isCacheable(event.request)) return;
  // event.respondWith((event.request.destination === "document" ? networkFirst : cacheFirstWithRefresh)(event.request));
  event.respondWith((event.request.destination !== "image" ? networkFirst : cacheFirstWithRefresh)(event.request)); // during dev
});
