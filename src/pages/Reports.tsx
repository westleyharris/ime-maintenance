import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { companies } from '../data/mockData';

export default function Reports() {
  const { t } = useTranslation();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedCompany, setSelectedCompany] = useState('');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('reports.title')}</h1>
        <select
          value={selectedCompany}
          onChange={(e) => setSelectedCompany(e.target.value)}
          className="px-4 py-2 rounded-lg text-sm border border-card-border bg-white text-gray-600"
        >
          <option value="">{t('reports.selectCompany')}</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="bg-card-bg rounded-xl border border-card-border p-6 max-w-lg">
        <h2 className="text-lg font-semibold text-gray-900 mb-5">{t('reports.exportCSV')}</h2>
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">{t('reports.from')}</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-card-border text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">{t('reports.to')}</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-card-border text-sm"
            />
          </div>
        </div>
        <button
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary/50 text-white text-sm font-medium cursor-not-allowed"
          disabled
        >
          <Download size={16} />
          {t('reports.exportCSV')}
        </button>
      </div>
    </div>
  );
}
