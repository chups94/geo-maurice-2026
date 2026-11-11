import { useEffect, useMemo, useRef } from 'react';
import { CircleMarker, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { categoryColor } from '../../reports/api';
import { useLanguage } from '../../i18n/LanguageContext';

const pinIcon = L.divIcon({ className: 'report-pin', html: '<span></span>', iconSize: [30, 30], iconAnchor: [15, 30] });

/** Signalements validés, affichés en pastilles colorées par catégorie. */
export function ReportsLayer({ reports, visible, picking, focusId }) {
    const { t, lang } = useLanguage();
    const markers = useRef({});
    const map = useMap();
    const locale = lang === 'en' ? 'en-GB' : 'fr-FR';

    // Ouvre un signalement demandé (lien admin « Voir sur la carte » ou liste)
    useEffect(() => {
        if (!focusId) return;
        const f = reports.find((r) => r.properties.id === focusId);
        if (!f) return;
        const [lng, lat] = f.geometry.coordinates;
        map.flyTo([lat, lng], 16);
        setTimeout(() => markers.current[focusId]?.openPopup(), 600);
    }, [focusId, reports, map]);

    if (!visible) return null;
    return reports.map((f) => {
        const p = f.properties;
        const [lng, lat] = f.geometry.coordinates;
        const date = new Date(p.published_at || p.created_at).toLocaleDateString(locale, { dateStyle: 'medium' });
        return (
            <CircleMarker
                key={p.id}
                ref={(m) => { if (m) markers.current[p.id] = m; }}
                center={[lat, lng]}
                radius={9}
                pathOptions={{ color: '#ffffff', weight: 2, fillColor: categoryColor(p.category), fillOpacity: 1 }}
                interactive={!picking}
            >
                <Popup maxWidth={280}>
                    <div className="report-popup">
                        <strong>{t(`rcat_${p.category}`)}</strong>
                        <em>{t('reportedOn')(date)}</em>
                        <p>{p.description}</p>
                        {/* La photo n'est téléchargée qu'à l'ouverture de la bulle */}
                        {p.photo_url && <img src={p.photo_url} alt="" loading="lazy" />}
                    </div>
                </Popup>
            </CircleMarker>
        );
    });
}

/** Choix de la position d'un nouveau signalement (clic sur la carte + repère déplaçable). */
export function ReportPicker({ picking, position, onPick }) {
    const map = useMap();
    useMapEvents({
        click(e) { if (picking) onPick(e.latlng); },
    });

    useEffect(() => {
        const el = map.getContainer();
        el.classList.toggle('picking', picking);
        return () => el.classList.remove('picking');
    }, [picking, map]);

    // Recentre la carte quand la position vient du GPS
    useEffect(() => {
        if (position?.fromGps) map.flyTo([position.lat, position.lng], Math.max(map.getZoom(), 15));
    }, [position, map]);

    const handlers = useMemo(() => ({
        dragend(e) { const ll = e.target.getLatLng(); onPick(ll); },
    }), [onPick]);

    if (!picking || !position) return null;
    return <Marker position={[position.lat, position.lng]} icon={pinIcon} draggable eventHandlers={handlers} zIndexOffset={1000} />;
}
