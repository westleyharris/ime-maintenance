import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Upload, Pencil, Trash2 } from 'lucide-react';
import { workOrders } from '../data/mockData';

const priorityColors: Record<string, string> = {
  low: 'bg-blue-100 text-blue-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

const statusColors: Record<string, string> = {
  open: 'bg-blue-50 text-blue-700',
  in_progress: 'bg-purple-50 text-purple-700',
  closed: 'bg-green-50 text-green-700',
  cancelled: 'bg-gray-100 text-gray-600',
};

const typeColors: Record<string, string> = {
  preventive: 'bg-gray-100 text-gray-700',
  corrective: 'bg-gray-100 text-gray-700',
  emergency: 'bg-red-50 text-red-700',
};

export default function WorkOrders() {
  const { t } = useTranslation();
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterType, setFilterType] = useState('');

  const filtered = workOrders.filter((wo) => {
    if (filterStatus && wo.status !== filterStatus) return false;
    if (filterPriority && wo.priority !== filterPriority) return false;
    if (filterType && wo.type !== filterType) return false;
    return true;
  });

  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      open: t('workOrders.open'),
      in_progress: t('workOrders.inProgress'),
      closed: t('workOrders.closed'),
      cancelled: t('workOrders.cancelled'),
    };
    return map[s] || s;
  };

  const typeLabel = (ty: string) => {
    const map: Record<string, string> = {
      preventive: t('workOrders.preventive'),
      corrective: t('workOrders.corrective'),
      emergency: t('workOrders.emergency'),
    };
    return map[ty] || ty;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('workOrders.title')}</h1>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-card-border bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Upload size={16} />
            {t('workOrders.importCSV')}
          </button>
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-light">
            <Plus size={16} />
            {t('workOrders.createWorkOrder')}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-4 py-2 rounded-lg text-sm border border-card-border bg-white text-gray-600"
        >
          <option value="">{t('workOrders.filterStatus')}</option>
          <option value="open">{t('workOrders.open')}</option>
          <option value="in_progress">{t('workOrders.inProgress')}</option>
          <option value="closed">{t('workOrders.closed')}</option>
          <option value="cancelled">{t('workOrders.cancelled')}</option>
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="px-4 py-2 rounded-lg text-sm border border-card-border bg-white text-gray-600"
        >
          <option value="">{t('workOrders.filterPriority')}</option>
          <option value="low">{t('workOrders.low')}</option>
          <option value="medium">{t('workOrders.medium')}</option>
          <option value="high">{t('workOrders.high')}</option>
          <option value="critical">{t('workOrders.critical')}</option>
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-4 py-2 rounded-lg text-sm border border-card-border bg-white text-gray-600"
        >
          <option value="">{t('workOrders.filterType')}</option>
          <option value="preventive">{t('workOrders.preventive')}</option>
          <option value="corrective">{t('workOrders.corrective')}</option>
          <option value="emergency">{t('workOrders.emergency')}</option>
        </select>
      </div>

      <div className="bg-card-bg rounded-xl border border-card-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border">
              <th className="text-left px-5 py-3 font-semibold text-gray-700">{t('workOrders.woNumber')}</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-700">{t('workOrders.type')}</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-700">{t('workOrders.priority')}</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-700">{t('workOrders.status')}</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-700">{t('workOrders.description')}</th>
              <th className="text-right px-5 py-3 font-semibold text-gray-700">{t('workOrders.downtimeHours')}</th>
              <th className="text-right px-5 py-3 font-semibold text-gray-700">{t('workOrders.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((wo) => (
              <tr key={wo.id} className="border-b border-card-border last:border-b-0 hover:bg-gray-50">
                <td className="px-5 py-3 text-primary font-medium">{wo.woNumber}</td>
                <td className="px-5 py-3">
                  <span className={`px-2.5 py-1 rounded text-xs font-medium ${typeColors[wo.type]}`}>
                    {typeLabel(wo.type)}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <span className={`px-2.5 py-1 rounded text-xs font-medium ${priorityColors[wo.priority]}`}>
                    {t(`workOrders.${wo.priority}`)}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <span className={`px-2.5 py-1 rounded text-xs font-medium ${statusColors[wo.status]}`}>
                    {statusLabel(wo.status)}
                  </span>
                </td>
                <td className="px-5 py-3 text-gray-600 max-w-[300px] truncate">{wo.description}</td>
                <td className="px-5 py-3 text-right text-gray-600">
                  {wo.downtimeHours ?? '--'}
                </td>
                <td className="px-5 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button className="flex items-center gap-1 px-3 py-1.5 rounded border border-card-border text-xs font-medium text-gray-600 hover:bg-gray-50">
                      <Pencil size={12} />
                      {t('workOrders.edit')}
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
