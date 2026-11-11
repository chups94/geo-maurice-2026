'use strict';

/*
 * GéoMaurice — serveur
 *  - sert l'application React construite (geo-maurice-app/dist)
 *  - API v1 des signalements citoyens (web aujourd'hui, application mobile demain)
 *  - modération : tout signalement arrive « en attente » et n'est publié
 *    qu'après validation manuelle par un admin du CEDTI ; il reste ensuite
 *    affiché jusqu'à son retrait manuel.
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { DatabaseSync } = require('node:sqlite');

// ---------------------------------------------------------------------------
// Configuration (variables d'environnement, voir .env.example)
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
// Le mot de passe d'exemple de .env.example n'est jamais accepté : tant qu'il
// n'est pas changé, l'espace admin reste fermé.
const DEFAULT_PASSWORDS = new Set(['changez-moi']);
const RAW_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_PASSWORD_IS_DEFAULT = DEFAULT_PASSWORDS.has(RAW_ADMIN_PASSWORD);
const ADMIN_PASSWORD = ADMIN_PASSWORD_IS_DEFAULT ? '' : RAW_ADMIN_PASSWORD;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const TILES_DIR = path.resolve(process.env.TILES_DIR || path.join(__dirname, 'tiles'));
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(__dirname, '..', 'geo-maurice-app', 'dist'));
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
// Origines autorisées à appeler l'API depuis un autre domaine (future app mobile).
// Ex. : CORS_ORIGINS=capacitor://localhost,http://localhost
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024; // la photo est déjà compressée par l'application
const MAX_DESCRIPTION = 500;
// Limite anti-spam par adresse IP (gardée en mémoire uniquement). Sur les réseaux
// mobiles, plusieurs abonnés partagent souvent la même IP : la limite doit donc
// rester assez large. Réglable avec REPORTS_PER_HOUR.
const REPORTS_PER_HOUR = Math.max(1, Math.floor(Number(process.env.REPORTS_PER_HOUR)) || 30);
const SESSION_HOURS = 8;

const CATEGORIES = [
  { id: 'inondation', color: '#3b82f6' },
  { id: 'erosion', color: '#ef4444' },
  { id: 'glissement', color: '#a16207' },
  { id: 'cyclone', color: '#a855f7' },
  { id: 'secheresse', color: '#f59e0b' },
  { id: 'pollution', color: '#65a30d' },
  { id: 'autre', color: '#64748b' },
];
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

// Territoire accepté : île Maurice et Rodrigues
const TERRITORY = [
  { minLat: -20.6, maxLat: -19.9, minLng: 57.25, maxLng: 57.85 },
  { minLat: -19.8, maxLat: -19.6, minLng: 63.3, maxLng: 63.55 },
];

// ---------------------------------------------------------------------------
// Base de données (SQLite intégré à Node)
// ---------------------------------------------------------------------------
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'geomaurice.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id           TEXT PRIMARY KEY,
    category     TEXT NOT NULL,
    description  TEXT NOT NULL,
    lat          REAL NOT NULL,
    lng          REAL NOT NULL,
    photo        TEXT,
    photo_bytes  INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'published'
    created_at   TEXT NOT NULL,
    published_at TEXT
  );
  CREATE INDEX IF NOT EXISTS reports_status ON reports(status, created_at);
`);
// Volontairement : aucune donnée personnelle (ni nom, ni e-mail, ni IP) n'est stockée.

const stmt = {
  insert: db.prepare(`INSERT INTO reports (id, category, description, lat, lng, photo, photo_bytes, status, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`),
  byStatus: db.prepare('SELECT * FROM reports WHERE status = ? ORDER BY created_at DESC'),
  get: db.prepare('SELECT * FROM reports WHERE id = ?'),
  publish: db.prepare(`UPDATE reports SET status = 'published', published_at = ? WHERE id = ? AND status = 'pending'`),
  del: db.prepare('DELETE FROM reports WHERE id = ?'),
  stats: db.prepare(`SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)   AS pending,
      SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN photo IS NOT NULL THEN 1 ELSE 0 END)    AS photos,
      COALESCE(SUM(photo_bytes), 0)                         AS photo_bytes
    FROM reports`),
};

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/** Retire les métadonnées d'un JPEG (EXIF/GPS, XMP, commentaires…). */
function stripJpegMetadata(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not-jpeg');
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) throw new Error('bad-jpeg');
    const marker = buf[i + 1];
    if (marker === 0xda) { out.push(buf.subarray(i)); return Buffer.concat(out); }
    const len = buf.readUInt16BE(i + 2);
    const isMeta = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMeta) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  throw new Error('bad-jpeg');
}

const inTerritory = (lat, lng) =>
  TERRITORY.some((t) => lat >= t.minLat && lat <= t.maxLat && lng >= t.minLng && lng <= t.maxLng);

function toFeature(r) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    properties: {
      id: r.id,
      category: r.category,
      description: r.description,
      status: r.status,
      created_at: r.created_at,
      published_at: r.published_at,
      photo_url: r.photo ? `/api/v1/photos/${r.id}` : null,
      photo_bytes: r.photo_bytes,
    },
  };
}
const collection = (rows) => ({ type: 'FeatureCollection', features: rows.map(toFeature) });

function rateLimiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, ts] of hits) {
      const kept = ts.filter((t) => now - t < windowMs);
      if (kept.length) hits.set(k, kept); else hits.delete(k);
    }
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const ts = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (ts.length >= max) {
      // Délai avant qu'une place se libère, pour que l'application sache quand réessayer
      res.set('Retry-After', String(Math.max(1, Math.ceil((ts[0] + windowMs - now) / 1000))));
      return res.status(429).json({ error: 'rate_limited', message: 'Trop de requêtes, réessayez plus tard.' });
    }
    ts.push(now);
    hits.set(req.ip, ts);
    next();
  };
}

// Sessions admin en mémoire (un redémarrage déconnecte l'admin)
const sessions = new Map();
function isAdmin(req) {
  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  const exp = m && sessions.get(m[1]);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(m[1]); return false; }
  return true;
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'unauthorized', message: 'Session admin invalide ou expirée.' });
  next();
}
function passwordMatches(candidate) {
  if (!ADMIN_PASSWORD) return false;
  const a = crypto.createHash('sha256').update(String(candidate)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
const bad = (res, error, message) => res.status(400).json({ error, message });

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
if (TRUST_PROXY) app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://tile.openstreetmap.org",
      "connect-src 'self'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  });
  next();
});

// CORS limité aux origines déclarées (application mobile native)
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      Vary: 'Origin',
    });
    if (req.method === 'OPTIONS') return res.status(204).end();
  }
  next();
});

const api = express.Router();

api.get('/health', (req, res) => res.json({ ok: true }));
api.get('/categories', (req, res) => res.json(CATEGORIES));

// Connecteur public : uniquement les signalements validés, en GeoJSON
api.get('/reports', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json(collection(stmt.byStatus.all('published')));
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 6, fieldSize: 4 * 1024 },
});

api.post('/reports', rateLimiter(REPORTS_PER_HOUR, 60 * 60 * 1000), upload.single('photo'), (req, res) => {
  const category = String(req.body.category || '');
  const description = String(req.body.description || '').trim();
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);

  if (!CATEGORY_IDS.has(category)) return bad(res, 'invalid_category', 'Catégorie inconnue.');
  if (description.length < 5 || description.length > MAX_DESCRIPTION) {
    return bad(res, 'invalid_description', `La description doit faire entre 5 et ${MAX_DESCRIPTION} caractères.`);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inTerritory(lat, lng)) {
    return bad(res, 'invalid_position', 'Le point doit se trouver à Maurice ou à Rodrigues.');
  }

  const id = crypto.randomUUID();
  let photo = null;
  let photoBytes = 0;
  if (req.file) {
    let clean;
    try { clean = stripJpegMetadata(req.file.buffer); } catch { return bad(res, 'invalid_photo', 'La photo doit être une image JPEG.'); }
    photo = `${id}.jpg`;
    photoBytes = clean.length;
    fs.writeFileSync(path.join(UPLOAD_DIR, photo), clean);
  }

  const round = (x) => Math.round(x * 1e5) / 1e5;
  stmt.insert.run(id, category, description, round(lat), round(lng), photo, photoBytes, new Date().toISOString());
  // Réponse volontairement minimale : le signalement n'est pas public avant validation.
  res.status(201).json({ id, status: 'pending' });
});

// Photo : publique si le signalement est validé, sinon réservée à l'admin
api.get('/photos/:id', (req, res) => {
  const r = stmt.get.get(req.params.id);
  if (!r || !r.photo) return res.status(404).end();
  if (r.status !== 'published') {
    if (!isAdmin(req)) return res.status(404).end();
    res.set('Cache-Control', 'private, no-store');
  } else {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
  res.type('jpeg').sendFile(path.join(UPLOAD_DIR, r.photo));
});

// --- Admin -----------------------------------------------------------------
api.post('/admin/login', rateLimiter(5, 15 * 60 * 1000), express.json({ limit: '2kb' }), (req, res) => {
  if (!ADMIN_PASSWORD) {
    const message = ADMIN_PASSWORD_IS_DEFAULT
      ? "Le mot de passe d'exemple n'est pas accepté : changez ADMIN_PASSWORD dans le fichier .env, puis redémarrez."
      : "ADMIN_PASSWORD n'est pas configuré sur le serveur.";
    return res.status(503).json({ error: 'not_configured', message });
  }
  if (!passwordMatches(req.body && req.body.password)) return res.status(401).json({ error: 'bad_password', message: 'Mot de passe incorrect.' });
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_HOURS * 3600 * 1000);
  res.json({ token, expires_in_hours: SESSION_HOURS });
});

api.post('/admin/logout', requireAdmin, (req, res) => {
  sessions.delete(req.get('authorization').slice(7));
  res.status(204).end();
});

api.get('/admin/stats', requireAdmin, (req, res) => {
  const s = stmt.stats.get();
  res.json({ pending: s.pending || 0, published: s.published || 0, photos: s.photos || 0, photo_bytes: s.photo_bytes });
});

api.get('/admin/reports', requireAdmin, (req, res) => {
  const status = req.query.status === 'published' ? 'published' : 'pending';
  res.set('Cache-Control', 'no-store');
  res.json(collection(stmt.byStatus.all(status)));
});

// Validation : le signalement devient public
api.post('/admin/reports/:id/approve', requireAdmin, (req, res) => {
  const r = stmt.get.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not_found', message: 'Signalement introuvable.' });
  stmt.publish.run(new Date().toISOString(), r.id);
  res.json(toFeature(stmt.get.get(r.id)));
});

// Rejet d'un signalement en attente, ou retrait d'un signalement publié :
// la ligne ET la photo sont supprimées définitivement.
api.delete('/admin/reports/:id', requireAdmin, (req, res) => {
  const r = stmt.get.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not_found', message: 'Signalement introuvable.' });
  stmt.del.run(r.id);
  if (r.photo) fs.rmSync(path.join(UPLOAD_DIR, r.photo), { force: true });
  res.status(204).end();
});

api.use((req, res) => res.status(404).json({ error: 'not_found', message: 'Route inconnue.' }));
app.use('/api/v1', api);

// --- Fichiers statiques ------------------------------------------------------
app.use('/tiles', express.static(TILES_DIR, { maxAge: '7d' }));
app.use('/admin', express.static(path.join(__dirname, 'admin'), { extensions: ['html'] }));
// Fichiers construits par Vite : noms avec empreinte -> cache long ; données -> 7 jours.
app.use('/assets', express.static(path.join(STATIC_DIR, 'assets'), { maxAge: '365d', immutable: true }));
app.use('/data', express.static(path.join(STATIC_DIR, 'data'), { maxAge: '7d' }));
app.use(express.static(STATIC_DIR, { index: false }));
// Application monopage : toute autre URL renvoie index.html
app.get(/^\/(?!api\/|tiles\/|data\/|assets\/).*/, (req, res, next) => {
  const index = path.join(STATIC_DIR, 'index.html');
  if (!fs.existsSync(index)) return res.status(503).send("Application non construite : lancez « npm run build » dans geo-maurice-app.");
  res.set('Cache-Control', 'no-cache');
  res.sendFile(index);
});

// --- Erreurs -----------------------------------------------------------------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Photo trop lourde (1,5 Mo max).' : 'Envoi invalide.';
    return bad(res, 'invalid_upload', msg);
  }
  console.error(err);
  res.status(500).json({ error: 'server_error', message: 'Erreur serveur.' });
});

if (require.main === module) {
  if (ADMIN_PASSWORD_IS_DEFAULT) console.warn("⚠ ADMIN_PASSWORD est encore le mot de passe d'exemple : la page admin restera fermée tant qu'il n'est pas changé (.env).");
  else if (!ADMIN_PASSWORD) console.warn('⚠ ADMIN_PASSWORD non défini : la page admin sera inaccessible.');
  app.listen(PORT, () => console.log(`GéoMaurice : http://localhost:${PORT}  (admin : /admin)`));
}

module.exports = { app, stripJpegMetadata };
