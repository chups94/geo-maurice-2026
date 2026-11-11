import { useLanguage } from '../../i18n/LanguageContext';
import { REPORT_CATEGORIES, categoryColor } from '../../reports/api';
import './Reports.css';

/** Onglet « Signalements » du panneau de contrôle. */
export function ReportsPanel({ reports, visible, setVisible, onFocus }) {
    const { t, lang } = useLanguage();
    const locale = lang === 'en' ? 'en-GB' : 'fr-FR';
    const recent = reports.slice(0, 8);

    return (
        <div className="panel-content reports-panel">
            <p className="hint">{t('reportsIntro')}</p>
            <label className="reports-toggle">
                <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
                <span>{t('showReports')}</span>
            </label>
            <p className="reports-count">{t('reportsCount')(reports.length)}</p>

            <ul className="reports-legend">
                {REPORT_CATEGORIES.map((c) => (
                    <li key={c.id}><span className="dot" style={{ background: c.color }} />{t(`rcat_${c.id}`)}</li>
                ))}
            </ul>

            <h4>{t('reportsRecent')}</h4>
            {recent.length === 0 ? <p className="hint">{t('reportsEmpty')}</p> : (
                <ul className="reports-list">
                    {recent.map(({ properties: p }) => (
                        <li key={p.id}>
                            <button type="button" onClick={() => onFocus(p.id)}>
                                <span className="dot" style={{ background: categoryColor(p.category) }} />
                                <span className="txt">
                                    <strong>{t(`rcat_${p.category}`)}</strong>
                                    <span>{p.description}</span>
                                </span>
                                <time>{new Date(p.published_at || p.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}</time>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
