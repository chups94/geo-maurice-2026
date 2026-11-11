import { useCallback, useEffect, useState } from 'react';
import { fetchReports } from './api';
import { flushOutbox } from './outbox';

const RETRY_MINUTES = 5;

/** Signalements validés + envoi automatique de la file hors connexion. */
export function useReports({ onOutboxSent } = {}) {
    const [reports, setReports] = useState([]);

    const refresh = useCallback(async () => {
        try {
            const data = await fetchReports();
            setReports(data.features || []);
        } catch {
            /* hors ligne : on garde la dernière liste */
        }
    }, []);

    useEffect(() => {
        refresh();
        const flush = async () => {
            const n = await flushOutbox();
            if (n > 0) onOutboxSent?.(n);
        };
        flush();
        window.addEventListener('online', flush);
        // Nouvel essai régulier : la file peut être retenue par la limite d'envois
        // du serveur alors que le réseau est revenu (aucune requête si la file est vide).
        const timer = setInterval(flush, RETRY_MINUTES * 60 * 1000);
        return () => { window.removeEventListener('online', flush); clearInterval(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refresh]);

    return { reports, refresh };
}
