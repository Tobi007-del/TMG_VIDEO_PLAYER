const cacheName = "TVP_user_interface_cache_1";
const precachedResources = ["/TMG_VIDEO_PLAYER/", "/TMG_VIDEO_PLAYER/assets/images/lone-tree.jpg", "/TMG_VIDEO_PLAYER/index.html", "/TMG_VIDEO_PLAYER/index.css", "/TMG_VIDEO_PLAYER/index.js", "/TMG_MEDIA_PROTOTYPE/prototype-2/prototype-2.js", "/TMG_MEDIA_PROTOTYPE/prototype-2/prototype-2-video.css", "/RESTAURANT_THEMED_SITE/styles/scroll-bar.css", "/TMG_VIDEO_PLAYER/assets/icons/tmg-icon.jpeg", "/T007_TOOLS/T007_toast_library/T007_toast.js", "/T007_TOOLS/T007_toast_library/T007_toast.css"]

async function precache() {
    const cache = await caches.open(cacheName);
    return cache.addAll(precachedResources);
}

function isCacheable(request) {
    const url = new URL(request.url);
    return url.origin === self.location.origin;
}

//exploitig a network first cache strategy since the app is still in development, might switch to the stale while revalidate strategy 
async function networkFirst(request) {
    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch(error) {
        const cacheResponse = await caches.match(request)
        return cacheResponse || Response.error()
    }
}

addEventListener("install", skipWaiting);

addEventListener("install", precache());

addEventListener("fetch", event => {
    if (isCacheable(event.request)) {
        event.respondWith(networkFirst(event.request)); 
    }
});