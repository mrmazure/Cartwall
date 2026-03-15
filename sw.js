/* ─────────────────────────────────────────────────────────────
   RadioTools – CartWall  |  Service Worker
   Stratégie : Network-First
   • Online  → toujours récupéré depuis le serveur (fresh)
               + mise à jour silencieuse du cache
   • Offline → fallback sur le cache
   ───────────────────────────────────────────────────────────── */

const CACHE = 'cartwall-v2';
const SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
  '/favicon.png',
  '/rt_logo_head.png',
  '/js/app.js'
];

// ── Install : pré-cache le shell ────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

// ── Activate : purge les anciens caches ────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch : Network-First ───────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  // Ne pas intercepter les ressources externes (PeerJS CDN, fonts, etc.)
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    // Force le contournement du cache HTTP du navigateur
    fetch(new Request(e.request, { cache: 'no-cache' }))
      .then(response => {
        if (response.ok) {
          // Met à jour le cache avec la version fraîche
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request)) // Offline : fallback cache
  );
});
