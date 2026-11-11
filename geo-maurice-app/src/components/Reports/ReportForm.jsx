import { useEffect, useState } from 'react';
import { X, MapPin, Camera, Lock, Clock } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';
import { REPORT_CATEGORIES, postReport, ReportRejectedError, ReportDeferredError } from '../../reports/api';
import { compressPhoto } from '../../reports/photo';
import { addToOutbox } from '../../reports/outbox';
import './Reports.css';

const kb = (bytes) => Math.round(bytes / 1024);

/**
 * Panneau « Nouveau signalement » : feuille du bas sur mobile, carte à droite sur ordinateur.
 * La position est choisie sur la carte (ReportPicker) ou par GPS.
 */
export function ReportForm({ position, setPosition, onClose, onDone }) {
    const { t } = useLanguage();
    const [category, setCategory] = useState('');
    const [description, setDescription] = useState('');
    const [photo, setPhoto] = useState(null); // { blob, url, info }
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [sending, setSending] = useState(false);

    useEffect(() => () => { if (photo?.url) URL.revokeObjectURL(photo.url); }, [photo]);

    const locate = () => {
        if (!navigator.geolocation) { setStatus(t('locationUnavailable')); return; }
        setStatus(t('locating'));
        navigator.geolocation.getCurrentPosition(
            (pos) => { setStatus(''); setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, fromGps: true }); },
            () => setStatus(t('locationUnavailable')),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
        );
    };

    const onPhoto = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setError('');
        try {
            const { blob, width, height } = await compressPhoto(file);
            setPhoto({ blob, url: URL.createObjectURL(blob), info: t('photoInfo')(width, height, kb(blob.size), kb(file.size)) });
        } catch {
            setPhoto(null);
            setError(t('photoError'));
        }
    };

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        if (!position) return setError(t('errPosition'));
        if (!category) return setError(t('errCategory'));
        if (description.trim().length < 5) return setError(t('errDescription'));

        const report = { category, description: description.trim(), lat: position.lat, lng: position.lng, photo: photo?.blob || null };
        setSending(true);
        try {
            await postReport(report);
            onDone(t('sentThanks'));
        } catch (err) {
            if (err instanceof ReportRejectedError) {
                setError(err.message);
            } else {
                // Pas de réseau, ou trop d'envois pour le moment : on garde le signalement pour plus tard
                await addToOutbox(report);
                onDone(t(err instanceof ReportDeferredError ? 'savedLater' : 'savedOffline'));
            }
        } finally {
            setSending(false);
        }
    };

    return (
        <section className="report-sheet" aria-labelledby="report-title">
            <header className="report-sheet-head">
                <h2 id="report-title">{t('newReport')}</h2>
                <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}><X size={20} /></button>
            </header>

            <form onSubmit={submit} noValidate>
                <fieldset>
                    <legend>{t('stepWhere')}</legend>
                    <p className={`hint ${position ? 'ok' : ''}`}>
                        {status || (position ? t('placedAt')(position.lat.toFixed(4), position.lng.toFixed(4)) : t('placeHint'))}
                    </p>
                    <button type="button" className="btn-outline" onClick={locate}><MapPin size={16} /> {t('useMyLocation')}</button>
                </fieldset>

                <fieldset>
                    <legend>{t('stepWhat')}</legend>
                    <label htmlFor="report-category">{t('problemType')}</label>
                    <select id="report-category" value={category} onChange={(e) => setCategory(e.target.value)} required>
                        <option value="">{t('choose')}</option>
                        {REPORT_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{t(`rcat_${c.id}`)}</option>)}
                    </select>
                    <label htmlFor="report-description">{t('description')}</label>
                    <textarea
                        id="report-description" rows={3} maxLength={500} value={description}
                        placeholder={t('descriptionPlaceholder')} onChange={(e) => setDescription(e.target.value)}
                    />
                    <span className="hint counter">{description.length}/500</span>
                </fieldset>

                <fieldset>
                    <legend>{t('stepPhoto')}</legend>
                    {photo ? (
                        <div className="photo-preview">
                            <img src={photo.url} alt="" />
                            <span className="hint">{photo.info}</span>
                            <button type="button" className="link-btn" onClick={() => setPhoto(null)}>{t('removePhoto')}</button>
                        </div>
                    ) : (
                        <label className="btn-outline file-btn">
                            <Camera size={16} /> {t('takePhoto')}
                            <input type="file" accept="image/*" capture="environment" onChange={onPhoto} hidden />
                        </label>
                    )}
                </fieldset>

                <p className="note"><Lock size={14} /> {t('privacyNote')}</p>
                <p className="note"><Clock size={14} /> {t('moderationNote')}</p>

                <p className="form-error" role="alert">{error}</p>
                <button type="submit" className="btn-submit" disabled={sending}>{sending ? t('sending') : t('send')}</button>
            </form>
        </section>
    );
}
