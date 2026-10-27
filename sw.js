/* Arrow Escape service worker: makes the installed app work offline.
   Network first for the game's own files (so updates you upload show up right
   away when online), falling back to the saved copy when offline. If the Wi-Fi
   is connected but the internet is down, the page waits at most 4 seconds, and
   a page that opened from the saved copy loads all of its files from the saved
   copy too, so every piece comes from the same version. Fonts come from the
   saved copy and refresh in the background. (The sounds are built into sounds.js.) */
const CACHE = 'slipstream-v88';
const APP_FILES = [
  './', 'index.html', 'styles.css', 'sounds.js', 'engine.js', 'pictures.js', 'cube.js', 'game.js', 'pwa.js', 'manifest.webmanifest',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];
const offline = new Set(); // pages that opened from the saved copy

self.addEventListener('install', (event) => {
  // Save each file on its own, so one hiccup doesn't stop the rest being saved.
  event.waitUntil(caches.open(CACHE).then((c) => Promise.all(APP_FILES.map((f) => c.add(f).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  // Only clear out Arrow Escape's own old copies. Other games on the same site
  // (like Sand Alchemy and its on-device AI download) keep theirs.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('slipstream-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: saved copy first, refreshed in the background.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;

  const saved = async () => (await caches.match(req, { ignoreSearch: true })) ||
    (req.mode === 'navigate' ? (await caches.match('index.html')) || (await caches.match('./')) : null);
  if (req.mode !== 'navigate' && offline.has(event.clientId)) {
    event.respondWith(saved().then((hit) => hit || fetch(req)));
    return;
  }
  const net = fetch(req, { cache: 'no-cache' }) // always ask GitHub whether there's a newer copy
    .then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    });
  const useSaved = async () => {
    const hit = await saved();
    if (hit && req.mode === 'navigate' && event.resultingClientId) offline.add(event.resultingClientId);
    return hit;
  };
  if (req.mode === 'navigate') {
    const slow = new Promise((r) => setTimeout(r, 4000)).then(async () => (await useSaved()) || net);
    event.respondWith(Promise.race([net, slow]).catch(async () => (await useSaved()) || Response.error()));
  } else {
    event.respondWith(net.catch(async () => (await saved()) || Response.error()));
  }
});
