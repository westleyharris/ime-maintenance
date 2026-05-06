import { useTranslation } from 'react-i18next';
import { Activity, Settings2 } from 'lucide-react';

export default function Vibration() {
  const { t } = useTranslation();

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <Activity size={28} className="text-gray-700" />
          <h1 className="text-2xl font-bold text-gray-900">{t('vibrationPage.title')}</h1>
        </div>
        <div className="flex items-center gap-4">
          <button className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-primary">
            <Activity size={16} />
            {t('vibrationPage.equipment')}
          </button>
          <button className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-primary">
            <Settings2 size={16} />
            {t('vibrationPage.vibrationProfiles')}
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-6">{t('vibrationPage.subtitle')}</p>

      <div className="bg-card-bg rounded-xl border border-card-border p-12 flex flex-col items-center justify-center">
        <Activity size={48} className="text-gray-300 mb-4" />
        <p className="text-sm text-gray-400">{t('vibrationPage.noData')}</p>
      </div>
    </div>
  );
}
