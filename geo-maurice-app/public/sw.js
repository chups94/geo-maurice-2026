// Service worker GéoMaurice : l'application reste utilisable sans réseau après
// une première visite (interface + données déjà consultées). Les signalements
// faits hors ligne sont gardés par l'application (src/reports/outbox.js).
const VERSION = 'v1';
const SHELL = `geomaurice-shell-${VERSION}`;
const DATA = `geomaurice-data-${VERSION}`;

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/map.svg', '/manifest.webmanifest'])));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA].includes(k)).map((k) => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);
    // On ne touche qu'aux lectures sur notre propre serveur.
    if (req.method !== 'GET' || url.origin !== self.location.origin) return;
    // API et espace admin : toujours en direct. Fond de carte : lectures partielles (Range), gérées par le navigateur.
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin') || req.headers.has('range')) return;

    // Pages : réseau d'abord, version en cache si hors ligne
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((res) => { caches.open(SHELL).then((c) => c.put('/', res.clone())); return res; })
                .catch(() => caches.match('/')),
        );
        return;
    }

    // Fichiers construits (noms avec empreinte, immuables) : cache d'abord
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
        event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
            if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
            return res;
        })));
        return;
    }

    // Données de la carte : réponse immédiate depuis le cache, mise à jour en arrière-plan
    if (url.pathname.startsWith('/data/')) {
        event.respondWith(caches.open(DATA).then(async (cache) => {
            const hit = await cache.match(req);
            const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
            return hit || network;
        }));
    }
});
