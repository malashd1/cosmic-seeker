// BaseStriker service worker — offline shell, smart caching.
// Strategy:
//   - HTML (navigation): network-first, fallback to cached index.html.
//   - JS/CSS hashed assets (under /assets/): cache-first, immutable.
//   - Backend API (/api/*): network-only, never cached.
//   - Everything else (icons, manifest, sw itself): stale-while-revalidate.

const VERSION = 'v1';
const STATIC_CACHE = `bsk-static-${VERSION}`;
const RUNTIME_CACHE = `bsk-runtime-${VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // Some assets may not exist in dev; allow individual failures.
      Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u))),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('bsk-') && !k.endsWith(VERSION))
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache the backend API or any third-party origin.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // HTML navigation — network-first.
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((r) => {
          const copy = r.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return r;
        })
        .catch(() => caches.match(req).then((m) => m ?? caches.match('/index.html'))),
    );
    return;
  }

  // Hashed asset — cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((r) => {
          const copy = r.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
          return r;
        });
      }),
    );
    return;
  }

  // Everything else — stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const networked = fetch(req)
        .then((r) => {
          const copy = r.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return r;
        })
        .catch(() => cached);
      return cached || networked;
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
