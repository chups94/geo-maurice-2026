'use strict';
// Tests de l'API : `npm test`
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geomaurice-test-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = 'secret-test';
process.env.CORS_ORIGINS = 'capacitor://localhost';
const { app, stripJpegMetadata } = require('../server.js');

function fakeJpegWithExif() {
  const seg = (marker, payload) => {
    const len = Buffer.alloc(2); len.writeUInt16BE(payload.length + 2);
    return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
  };
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary')),
    seg(0xe1, Buffer.from('Exif\0\0GPS-20.1609,57.4977-SECRET')),
    seg(0xfe, Buffer.from('commentaire perso')),
    seg(0xdb, Buffer.alloc(65, 1)),
    Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6, 0xaa, 0xbb, 0xff, 0xd9]),
  ]);
}

let server, base, token;
const api = (p) => `${base}/api/v1${p}`;
const auth = () => ({ Authorization: `Bearer ${token}` });

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(api('/admin/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret-test' }) });
  token = (await res.json()).token;
});
test.after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

function form(fields, photo) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  if (photo) fd.append('photo', new Blob([photo], { type: 'image/jpeg' }), 'p.jpg');
  return fd;
}
const valid = { category: 'inondation', description: 'Route inondée, 30 cm d’eau', lat: -20.1609, lng: 57.4977 };
const publicIds = async () => (await (await fetch(api('/reports'))).json()).features.map((f) => f.properties.id);

test('stripJpegMetadata retire EXIF et commentaires', () => {
  const out = stripJpegMetadata(fakeJpegWithExif());
  assert.ok(!out.includes(Buffer.from('SECRET')));
  assert.ok(!out.includes(Buffer.from('commentaire')));
  assert.deepEqual([...out.subarray(-2)], [0xff, 0xd9]);
});

test('circuit de modération : en attente → validé → retiré', async () => {
  let res = await fetch(api('/reports'), { method: 'POST', body: form(valid, fakeJpegWithExif()) });
  assert.equal(res.status, 201);
  const { id, status } = await res.json();
  assert.equal(status, 'pending');

  // Métadonnées supprimées sur disque
  assert.ok(!fs.readFileSync(path.join(dataDir, 'uploads', `${id}.jpg`)).includes(Buffer.from('SECRET')));

  // Pas public tant qu'il n'est pas validé, photo comprise
  assert.deepEqual(await publicIds(), []);
  assert.equal((await fetch(api(`/photos/${id}`))).status, 404);
  assert.equal((await fetch(api(`/photos/${id}`), { headers: auth() })).status, 200, 'l’admin voit la photo en attente');

  // File d'attente admin
  assert.equal((await fetch(api('/admin/reports'))).status, 401);
  let pending = await (await fetch(api('/admin/reports?status=pending'), { headers: auth() })).json();
  assert.deepEqual(pending.features.map((f) => f.properties.id), [id]);

  // Validation refusée sans compte admin, puis acceptée
  assert.equal((await fetch(api(`/admin/reports/${id}/approve`), { method: 'POST' })).status, 401);
  res = await fetch(api(`/admin/reports/${id}/approve`), { method: 'POST', headers: auth() });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).properties.status, 'published');

  assert.deepEqual(await publicIds(), [id]);
  assert.equal((await fetch(api(`/photos/${id}`))).status, 200, 'photo publique après validation');

  const stats = await (await fetch(api('/admin/stats'), { headers: auth() })).json();
  assert.equal(stats.pending, 0);
  assert.equal(stats.published, 1);

  // Retrait manuel
  res = await fetch(api(`/admin/reports/${id}`), { method: 'DELETE', headers: auth() });
  assert.equal(res.status, 204);
  assert.deepEqual(await publicIds(), []);
  assert.ok(!fs.existsSync(path.join(dataDir, 'uploads', `${id}.jpg`)), 'photo supprimée du disque');
});

test('rejet d’un signalement en attente', async () => {
  const { id } = await (await fetch(api('/reports'), { method: 'POST', body: form(valid) })).json();
  assert.equal((await fetch(api(`/admin/reports/${id}`), { method: 'DELETE', headers: auth() })).status, 204);
  const pending = await (await fetch(api('/admin/reports'), { headers: auth() })).json();
  assert.ok(!pending.features.some((f) => f.properties.id === id));
});

test('validation des envois', async () => {
  const cases = [
    [{ ...valid, category: 'xxx' }, null],
    [{ ...valid, description: 'abc' }, null],
    [{ ...valid, lat: 48.85, lng: 2.35 }, null],
    [{ ...valid, lat: 'abc' }, null],
    [valid, Buffer.from('pas une image')],
  ];
  for (const [fields, photo] of cases) {
    const res = await fetch(api('/reports'), { method: 'POST', body: form(fields, photo) });
    assert.equal(res.status, 400, JSON.stringify(fields));
    assert.ok((await res.json()).error, 'code d’erreur lisible par une app mobile');
  }
  assert.equal((await fetch(api('/reports'), { method: 'POST', body: form({ ...valid, lat: -19.71, lng: 63.42 }) })).status, 201, 'Rodrigues accepté');
});

test('CORS limité aux origines déclarées', async () => {
  let res = await fetch(api('/reports'), { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost' } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'capacitor://localhost');
  res = await fetch(api('/reports'), { headers: { Origin: 'https://evil.example' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('déconnexion admin', async () => {
  const res = await fetch(api('/admin/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'secret-test' }) });
  const t2 = (await res.json()).token;
  await fetch(api('/admin/logout'), { method: 'POST', headers: { Authorization: `Bearer ${t2}` } });
  assert.equal((await fetch(api('/admin/stats'), { headers: { Authorization: `Bearer ${t2}` } })).status, 401);
});
