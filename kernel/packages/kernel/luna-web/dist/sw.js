// Service Worker da Luna Web — PWA (scope-aware: funciona em / ou em /luna/)
// Estratégia: API/stream = rede direta (nunca cachear); assets estáticos = cache-first.
const CACHE = 'luna-pwa-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  const scope = self.registration.scope;          // ex: https://host/luna/
  const path = url.pathname;
  const apiPrefix = scope.endsWith('/') ? scope + 'api/' : scope + '/api/';
  const rootPath = new URL(scope).pathname;        // ex: /luna/

  // API e stream: rede direta, sem cache
  if (path.startsWith(apiPrefix)) return;

  // Navegação: network-first (sempre versão nova; offline cai no cache do shell)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(scope, clone));
          return res;
        })
        .catch(() => caches.match(scope))
    );
    return;
  }

  // Assets com hash: cache-first + preenchimento
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
