// File d'envoi hors connexion : un signalement fait sans réseau (cyclone,
// zone blanche…) est gardé sur l'appareil puis envoyé dès le retour du réseau.
import { postReport, ReportRejectedError } from './api';

const DB_NAME = 'geomaurice';
const STORE = 'outbox';

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'localId', autoIncrement: true });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function withStore(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const result = fn(tx.objectStore(STORE));
        tx.oncomplete = () => { db.close(); resolve(result?.result ?? result); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

export async function addToOutbox(report) {
    await withStore('readwrite', (s) => s.add({ ...report, savedAt: new Date().toISOString() }));
}

export async function outboxSize() {
    try { return await withStore('readonly', (s) => s.count()); } catch { return 0; }
}

/**
 * Envoie les signalements en attente. Renvoie le nombre réellement envoyés.
 * Un signalement n'est retiré de la file que s'il a été accepté par le serveur,
 * ou refusé définitivement (données invalides). Hors ligne ou limite d'envois
 * atteinte (429) : il reste dans la file et sera réessayé.
 */
let flushing = false;
export async function flushOutbox() {
    if (flushing) return 0; // un seul envoi de la file à la fois (pas de doublons)
    flushing = true;
    try {
        let items;
        try { items = await withStore('readonly', (s) => s.getAll()); } catch { return 0; }
        let sent = 0;
        for (const item of items) {
            let accepted = false;
            try {
                await postReport(item);
                accepted = true;
            } catch (err) {
                if (!(err instanceof ReportRejectedError)) break; // hors ligne ou limite atteinte : on réessaiera
                // refusé définitivement par le serveur : inutile de réessayer
            }
            await withStore('readwrite', (s) => s.delete(item.localId));
            if (accepted) sent++;
        }
        return sent;
    } finally {
        flushing = false;
    }
}
