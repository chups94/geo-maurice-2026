// Accès à l'API des signalements (/api/v1).
// API_BASE vide = même serveur que l'application. Pour une future application
// mobile native, définir VITE_API_BASE=https://geomaurice.exemple.mu au build.
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

// Mêmes identifiants et couleurs que le serveur (server/server.js)
export const REPORT_CATEGORIES = [
    { id: 'inondation', color: '#3b82f6' },
    { id: 'erosion', color: '#ef4444' },
    { id: 'glissement', color: '#a16207' },
    { id: 'cyclone', color: '#a855f7' },
    { id: 'secheresse', color: '#f59e0b' },
    { id: 'pollution', color: '#65a30d' },
    { id: 'autre', color: '#64748b' },
];
export const categoryColor = (id) => REPORT_CATEGORIES.find((c) => c.id === id)?.color || '#64748b';

export const apiUrl = (path) => `${API_BASE}/api/v1${path}`;

/** Signalements validés, en GeoJSON. */
export async function fetchReports() {
    const res = await fetch(apiUrl('/reports'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export class ReportRejectedError extends Error {}
/** Refus temporaire (trop d'envois depuis cette connexion) : à réessayer plus tard. */
export class ReportDeferredError extends Error {}

/**
 * Envoie un signalement. Lève ReportRejectedError si le serveur refuse
 * définitivement (données invalides), ReportDeferredError s'il demande de
 * réessayer plus tard (429), ou une TypeError en cas d'absence de réseau.
 */
export async function postReport({ category, description, lat, lng, photo }) {
    const body = new FormData();
    body.append('category', category);
    body.append('description', description);
    body.append('lat', String(lat));
    body.append('lng', String(lng));
    if (photo) body.append('photo', photo, 'photo.jpg');
    const res = await fetch(apiUrl('/reports'), { method: 'POST', body });
    const json = await res.json().catch(() => ({}));
    if (res.status === 429 || res.status === 408) throw new ReportDeferredError(json.message || 'Réessayez plus tard.');
    if (res.status >= 400 && res.status < 500) throw new ReportRejectedError(json.message || 'Envoi refusé.');
    if (!res.ok) throw new TypeError(`HTTP ${res.status}`); // erreur serveur : on réessaiera
    return json;
}
