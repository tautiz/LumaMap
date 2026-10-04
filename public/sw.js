// Keeps LumaMap working without internet (e.g. a Raspberry Pi that boots before its Wi-Fi, or has none).
//
// Pages and other files: from the network when it answers within a few seconds, otherwise the copy
// saved on the last visit. Build files under assets/ have a content hash in their name, so a saved
// copy is always right and is used straight away. Videos in media/ are left to the browser: they are
// large and fetched in ranges (videos picked from the library are kept with the saved show anyway).

const CACHE = 'lumamap-app-v1';
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const scopePath = () => new URL(self.registration.scope).pathname;

const fromNetwork = (request, key) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS);
    fetch(request).then(
      (response) => {
        // The timeout covers only the wait for an answer; a large show file may take longer to arrive.
        clearTimeout(timer);
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(key, copy)).catch(() => {});
        }
        resolve(response);
      },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });

const networkFirst = async (request, key) => {
  try {
    return await fromNetwork(request, key);
  } catch (error) {
    const cached = await caches.match(key);
    if (cached) return cached;
    throw error;
  }
};

const cacheFirst = async (request) => {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
};

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(scopePath())) return;
  const path = url.pathname.slice(scopePath().length);
  if (path.startsWith('media/') && !path.endsWith('.json')) return;

  if (request.mode === 'navigate') {
    // ?show, ?live=true and the editor are all the same page: keep one copy of it.
    event.respondWith(networkFirst(request, new URL(scopePath(), url).toString()));
  } else if (path.startsWith('assets/')) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request, request));
  }
});
