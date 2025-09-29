const cacheName = "TVP_user_interface_cache_1";
const precachedResources = ["assets/images/lone-tree.jpg", "assets/icons/movie-tape.png", "index.html", "index.css", "index.js", "prototype-2.js", "prototype-2-video.css", "assets/icons/tmg-icon.jpeg", "assets/icons/tmg-icon.png", "T007_toast.js", "T007_toast.css", "assets/ffmpeg/ffmpeg.min.js", "assets/ffmpeg/ffmpeg-core.js", "assets/ffmpeg/ffmpeg-core.wasm", "assets/ffmpeg/ffmpeg-core.worker.js"];

async function precache() {
  const cache = await caches.open(cacheName);
  return cache.addAll(precachedResources);
}

function isCacheable(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin;
}

async function cacheFirstWithRefresh(request) {
  const fetchResponsePromise = fetch(request).then(async (networkResponse) => {
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  });
  return (await caches.match(request)) || (await fetchResponsePromise);
}

async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cacheResponse = await caches.match(request);
    return cacheResponse || Response.error();
  }
}

addEventListener("install", skipWaiting);

addEventListener("install", precache);

addEventListener("fetch", (event) => {
  if (isCacheable(event.request)) event.respondWith(cacheFirstWithRefresh(event.request));
});
