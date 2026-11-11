'use strict';
// Limite d'envois et mot de passe d'exemple : `npm test`
// (fichier séparé : chaque fichier de test démarre son propre serveur, avec ses réglages)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geomaurice-test-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = 'changez-moi'; // valeur de .env.example
process.env.REPORTS_PER_HOUR = '2';
const { app } = require('../server.js');

let server, base;
const api = (p) => `${base}/api/v1${p}`;

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('le mot de passe d’exemple est refusé', async () => {
  const res = await fetch(api('/admin/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'changez-moi' }) });
  assert.equal(res.status, 503);
  const json = await res.json();
  assert.equal(json.error, 'not_configured');
  assert.equal(json.token, undefined);
});

test('limite d’envois : 429 avec Retry-After, sans rien enregistrer', async () => {
  const send = () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ category: 'inondation', description: 'Route inondée', lat: -20.1609, lng: 57.4977 })) fd.append(k, String(v));
    return fetch(api('/reports'), { method: 'POST', body: fd });
  };
  assert.equal((await send()).status, 201);
  assert.equal((await send()).status, 201);
  const res = await send();
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'rate_limited');
  const retry = Number(res.headers.get('retry-after'));
  assert.ok(retry >= 1 && retry <= 3600, `Retry-After = ${retry}`);
});
