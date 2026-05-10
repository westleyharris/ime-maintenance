import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';

const roleBadge: Record<string, string> = {
  ime_admin:     'IME Admin',
  company_admin: 'Company Admin',
  plant_manager: 'Plant Manager',
};

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  const setLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('ime-lang', lang);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('settings.title')}</h1>

      <div className="max-w-lg space-y-6">
        {/* Profile */}
        <div className="bg-card-bg rounded-xl border border-card-border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('settings.profile')}</h2>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-400">{t('settings.name')}</p>
              <p className="text-sm font-medium text-gray-900">{profile?.full_name || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">{t('settings.email')}</p>
              <p className="text-sm font-medium text-gray-900">{profile?.email || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">{t('settings.role')}</p>
              <p className="text-sm font-medium text-gray-900">
                {profile ? (roleBadge[profile.role] ?? profile.role) : '—'}
              </p>
            </div>
          </div>
        </div>

        {/* Language */}
        <div className="bg-card-bg rounded-xl border border-card-border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('settings.language')}</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLanguage('en')}
              className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                i18n.language === 'en'
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t('settings.english')}
            </button>
            <button
              onClick={() => setLanguage('es')}
              className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                i18n.language === 'es'
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t('settings.spanish')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
