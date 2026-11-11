import { useEffect, useState } from 'react';
import { TileLayer, useMap } from 'react-leaflet';
import { leafletLayer } from 'protomaps-leaflet';

// Fond de carte local (île Maurice + Rodrigues), servi par notre serveur.
// Voir server/scripts/download-tiles.js (npm run tiles).
const TILES_URL = '/tiles/maurice.pmtiles';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function VectorBaseMap() {
    const map = useMap();
    useEffect(() => {
        const layer = leafletLayer({
            url: TILES_URL,
            flavor: 'light',
            lang: 'fr',
            maxDataZoom: 15,
            attribution: `${ATTRIBUTION} · <a href="https://protomaps.com">Protomaps</a>`,
        });
        layer.backgroundColor = '#80deea'; // hors de la zone extraite : couleur de la mer
        layer.addTo(map);
        layer.bringToBack();
        return () => { map.removeLayer(layer); };
    }, [map]);
    return null;
}

/**
 * Utilise le fond local s'il est présent, sinon les tuiles OpenStreetMap en ligne.
 */
export default function BaseMapLayer() {
    const [source, setSource] = useState(null); // 'local' | 'osm'

    useEffect(() => {
        fetch(TILES_URL, { method: 'HEAD' })
            .then((r) => setSource(r.ok ? 'local' : 'osm'))
            .catch(() => setSource('osm'));
    }, []);

    if (source === 'local') return <VectorBaseMap />;
    if (source === 'osm') {
        return <TileLayer attribution={`${ATTRIBUTION} contributors`} url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />;
    }
    return null;
}
