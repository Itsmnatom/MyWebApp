const CACHE_NAME = 'speedmanga-v7';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js?v=4.1.6',
  'https://fonts.googleapis.com/css2?family=Kanit:wght@400;700&family=Outfit:wght@700;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching Core Assets');
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch Event: Stale-While-Revalidate
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only cache local assets and known CDNs
  const url = new URL(request.url);
  const isLocal = url.origin === self.location.origin;
  const isCdn = url.hostname.includes('fonts') || url.hostname.includes('cloudflare');

  if (request.method !== 'GET' || (!isLocal && !isCdn)) return;
  
  // Strict API and Reader bypass
  if (url.pathname.includes('/api/') || 
      url.pathname.includes('/read') || 
      url.pathname.includes('/manga')) return;

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        // Clone immediately before anything else uses the stream
        const clonedResponse = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, clonedResponse);
        });
        return networkResponse;
      });
      return cachedResponse || fetchPromise;
    })
  );
});
