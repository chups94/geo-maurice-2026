// Espace de modération : valider, rejeter ou retirer les signalements citoyens.
const API = '/api/v1';
const LABELS = {
    inondation: 'Inondation / eau stagnante',
    erosion: 'Érosion côtière',
    glissement: 'Glissement de terrain',
    cyclone: 'Dégâts de cyclone / tempête',
    secheresse: "Sécheresse / manque d'eau",
    pollution: 'Pollution / déchets',
    autre: 'Autre',
};
const HINTS = {
    pending: "Ces signalements ne sont pas visibles du public. Vérifiez la photo (pas de visage ni de plaque lisible), la description et la position, puis validez ou rejetez. Le rejet supprime définitivement le signalement et sa photo.",
    published: "Signalements visibles sur la carte. Ils y restent jusqu'à leur retrait. Le retrait supprime définitivement le signalement et sa photo.",
};

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
    get() { try { return sessionStorage.getItem('gm-admin'); } catch { return null; } },
    set(v) { try { v ? sessionStorage.setItem('gm-admin', v) : sessionStorage.removeItem('gm-admin'); } catch { /* indisponible */ } },
};

let token = store.get();
let currentStatus = 'pending';
let colors = {};
const objectUrls = [];

async function api(path, options = {}) {
    const res = await fetch(API + path, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
    if (res.status === 401) { logout(false); throw new Error('Session expirée, reconnectez-vous.'); }
    return res;
}

function showDashboard(visible) {
    $('login-form').classList.toggle('hidden', visible);
    $('dashboard').classList.toggle('hidden', !visible);
    $('logout').classList.toggle('hidden', !visible);
}

async function loadStats() {
    const s = await (await api('/admin/stats')).json();
    const mo = (s.photo_bytes / 1048576).toFixed(2).replace('.', ',');
    const avg = s.photos ? Math.round(s.photo_bytes / s.photos / 1024) : 0;
    $('count-pending').textContent = s.pending;
    $('count-published').textContent = s.published;
    $('stats').innerHTML = [
        [s.pending, 'en attente'],
        [s.published, 'publiés'],
        [`${mo} Mo`, 'de photos stockées'],
        [`${avg} Ko`, 'par photo (moyenne)'],
    ].map(([v, l]) => `<div class="stat"><strong>${v}</strong><span>${l}</span></div>`).join('');
}

// Les photos en attente ne sont pas publiques : on les télécharge avec le jeton admin.
async function loadPhoto(img) {
    try {
        const res = await api(img.dataset.src.replace(API, ''));
        if (!res.ok) throw new Error();
        const url = URL.createObjectURL(await res.blob());
        objectUrls.push(url);
        img.src = url;
    } catch {
        img.replaceWith(Object.assign(document.createElement('span'), { className: 'muted', textContent: 'Photo indisponible' }));
    }
}

function card({ properties: p, geometry: g }) {
    const [lng, lat] = g.coordinates;
    const date = new Date(p.created_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
    const osm = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
    const actions = p.status === 'pending'
        ? `<button class="btn success" data-action="approve" type="button">✔ Valider</button>
           <button class="btn danger-outline" data-action="delete" data-label="Rejeter" type="button">Rejeter</button>`
        : `<a class="btn ghost" href="/?report=${encodeURIComponent(p.id)}">Voir sur la carte</a>
           <button class="btn danger-outline" data-action="delete" data-label="Retirer" type="button">Retirer</button>`;
    return `<article class="card report" data-id="${esc(p.id)}">
        <div class="photo">${p.photo_url ? `<img alt="Photo du signalement" data-src="${esc(p.photo_url)}">` : '<span class="muted">Sans photo</span>'}</div>
        <div class="body">
            <p class="cat"><span class="dot" style="background:${colors[p.category] || '#64748b'}"></span>${esc(LABELS[p.category] || p.category)}</p>
            <p class="desc">${esc(p.description)}</p>
            <p class="meta">Envoyé le ${esc(date)} · <a href="${osm}" target="_blank" rel="noopener">📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}</a>${p.photo_bytes ? ` · ${Math.round(p.photo_bytes / 1024)} Ko` : ''}</p>
            <div class="actions">${actions}</div>
        </div>
    </article>`;
}

async function loadList() {
    objectUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    $('tab-hint').textContent = HINTS[currentStatus];
    const { features } = await (await api(`/admin/reports?status=${currentStatus}`)).json();
    $('list').innerHTML = features.map(card).join('');
    $('empty').textContent = currentStatus === 'pending' ? 'Aucun signalement à valider. 🎉' : 'Aucun signalement publié.';
    $('empty').classList.toggle('hidden', features.length > 0);
    document.querySelectorAll('#list img[data-src]').forEach(loadPhoto);
}

const refresh = () => Promise.all([loadStats(), loadList()]).catch((err) => alertError(err));
function alertError(err) { $('tab-hint').textContent = err.message; }

$('list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.closest('.report').dataset.id;

    // Suppression en deux clics
    if (btn.dataset.action === 'delete') {
        btn.dataset.action = 'confirm';
        btn.textContent = `Confirmer : ${btn.dataset.label.toLowerCase()} ?`;
        setTimeout(() => { if (btn.isConnected && btn.dataset.action === 'confirm') { btn.dataset.action = 'delete'; btn.textContent = btn.dataset.label; } }, 4000);
        return;
    }
    btn.disabled = true;
    try {
        const res = btn.dataset.action === 'approve'
            ? await api(`/admin/reports/${encodeURIComponent(id)}/approve`, { method: 'POST' })
            : await api(`/admin/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 404) throw new Error('Action impossible.');
        await refresh();
    } catch (err) {
        btn.disabled = false;
        alertError(err);
    }
});

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    currentStatus = tab.dataset.status;
    loadList().catch(alertError);
}));
$('refresh').addEventListener('click', refresh);

$('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-error').textContent = '';
    const res = await fetch(`${API}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $('password').value }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { $('login-error').textContent = json.message || 'Connexion impossible.'; return; }
    token = json.token;
    store.set(token);
    $('password').value = '';
    showDashboard(true);
    refresh();
});

async function logout(callServer = true) {
    if (callServer && token) await fetch(`${API}/admin/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    token = null;
    store.set(null);
    showDashboard(false);
}
$('logout').addEventListener('click', () => logout());

try {
    colors = Object.fromEntries((await (await fetch(`${API}/categories`)).json()).map((c) => [c.id, c.color]));
} catch { /* couleurs par défaut */ }
if (token) { showDashboard(true); refresh(); }
