import { useTranslation } from 'react-i18next';
import { Plus, Play, Calendar } from 'lucide-react';
import { pmSchedules } from '../data/mockData';

export default function PMCalendar() {
  const { t } = useTranslation();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('pmCalendar.title')}</h1>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-card-border bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Play size={16} />
            {t('pmCalendar.generateWorkOrders')}
          </button>
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-light">
            <Plus size={16} />
            {t('pmCalendar.createSchedule')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {pmSchedules.map((schedule) => (
          <div
            key={schedule.id}
            className="bg-card-bg rounded-xl border border-card-border p-5"
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900">{schedule.name}</h3>
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                  schedule.status === 'active'
                    ? 'bg-primary text-white'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {schedule.status === 'active' ? t('pmCalendar.active') : t('pmCalendar.inactive')}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <Calendar size={14} />
              {t('pmCalendar.every', { days: schedule.frequencyDays })}
            </div>
            <p className="text-sm text-gray-500 mb-3">
              {t('pmCalendar.next', { date: schedule.nextDate })}
            </p>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded border border-card-border text-xs font-medium text-gray-600">
                preventive
              </span>
              <span className="px-2.5 py-1 rounded border border-card-border text-xs font-medium text-gray-600">
                {schedule.priority}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
