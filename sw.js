// Service worker: aplikacja działa offline (sklep bez zasięgu).
// Strategia: odpowiedz z pamięci podręcznej od razu, a w tle pobierz świeżą wersję na następne uruchomienie.
// Po zmianie plików podbij numer wersji — stara pamięć zostanie usunięta.
const CACHE = 'pchla-v1';

const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'data/przepisy.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'js/app.js',
  'js/claude.js',
  'js/ics.js',
  'js/model.js',
  'js/nav.js',
  'js/nutrition.js',
  'js/planner.js',
  'js/seed.js',
  'js/shopping.js',
  'js/stats.js',
  'js/store.js',
  'js/ui.js',
  'js/util.js',
  'js/views/claude-ui.js',
  'js/views/progress.js',
  'js/views/recipes.js',
  'js/views/settings.js',
  'js/views/shop.js',
  'js/views/today.js',
  'js/views/week.js',
  'js/views/weekparts.js',
  'js/views/wizard.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        e.waitUntil(fresh);
        return cached;
      }
      return (await fresh) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
    }),
  );
});
