import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Pencil, Trash2 } from 'lucide-react';
import { inspectionFindings } from '../data/mockData';

const severityColors: Record<string, string> = {
  warning: 'bg-yellow-100 text-yellow-700',
  critical: 'bg-red-100 text-red-700',
};

const findingTypeColors: Record<string, string> = {
  visual: 'bg-blue-50 text-blue-700',
  vibration: 'bg-purple-50 text-purple-700',
  thermal: 'bg-orange-50 text-orange-700',
  ultrasound: 'bg-green-50 text-green-700',
};

export default function Inspections() {
  const { t } = useTranslation();
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');

  const filtered = inspectionFindings.filter((f) => {
    if (filterSeverity && f.severity !== filterSeverity) return false;
    if (filterStatus && f.status !== filterStatus) return false;
    if (filterType && f.findingType !== filterType) return false;
    return true;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('inspections.title')}</h1>
        <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-card-border bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
          <Upload size={16} />
          {t('inspections.importCSV')}
        </button>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
          className="px-4 py-2 rounded-lg text-sm border border-card-border bg-white text-gray-600"
        >
          <option value="">{t('inspections.severity')}</option>
          <option value="warning">{t('inspections.warning')}</option>
          <option value="critical">{t('inspections.critical')}</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-4 py-2 rounded-lg text-sm border border-card-border bg-white text-gray-600"
        >
          <option value="">{t('inspections.status')}</option>
          <option value="open">{t('inspections.open')}</option>
          <option value="closed">{t('inspections.closed')}</option>
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-4 py-2 rounded-lg text-sm border border-card-border bg-white text-gray-600"
        >
          <option value="">{t('inspections.findingType')}</option>
          <option value="visual">{t('inspections.visual')}</option>
          <option value="vibration">{t('inspections.vibration')}</option>
        </select>
      </div>

      <div className="bg-card-bg rounded-xl border border-card-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border">
              <th className="text-left px-5 py-3 font-semibold text-gray-700">{t('inspections.severity')}</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-700">{t('inspections.findingType')}</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-700">{t('inspections.description')}</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-700">{t('inspections.status')}</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-700">{t('inspections.recommendation')}</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-700">{t('inspections.reInspectionDate')}</th>
              <th className="text-right px-5 py-3 font-semibold text-gray-700">{t('inspections.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => (
              <tr key={f.id} className="border-b border-card-border last:border-b-0 hover:bg-gray-50">
                <td className="px-5 py-3">
                  <span className={`px-2.5 py-1 rounded text-xs font-medium ${severityColors[f.severity]}`}>
                    {f.severity === 'warning' ? t('inspections.warning') : t('inspections.critical')}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <span className={`px-2.5 py-1 rounded text-xs font-medium ${findingTypeColors[f.findingType]}`}>
                    {f.findingType === 'visual' ? t('inspections.visual') : t('inspections.vibration')}
                  </span>
                </td>
                <td className="px-5 py-3 text-gray-600 max-w-[280px] truncate">{f.description}</td>
                <td className="px-5 py-3">
                  <span className="text-xs font-medium text-gray-600">{f.status}</span>
                </td>
                <td className="px-5 py-3 text-gray-600 max-w-[200px] truncate">{f.recommendation}</td>
                <td className="px-5 py-3 text-gray-600">{f.reInspectionDate || '--'}</td>
                <td className="px-5 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button className="flex items-center gap-1 px-3 py-1.5 rounded border border-card-border text-xs font-medium text-gray-600 hover:bg-gray-50">
                      <Pencil size={12} />
                      {t('inspections.edit')}
                    </button>
                    <button className="p-1.5 text-gray-400 hover:text-red-500">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
