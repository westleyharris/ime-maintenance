import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Users, Wrench, ClipboardList, Plus } from 'lucide-react';
import { companies, users, assets, workOrders } from '../data/mockData';
import { countAssetsByType } from '../data/mockData';

export default function Admin() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'companies' | 'audit'>('companies');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  const assetCounts = countAssetsByType(assets);
  const totalAssets = Object.values(assetCounts).reduce((a, b) => a + b, 0);
  const openWOs = workOrders.filter(wo => wo.status === 'open' || wo.status === 'in_progress').length;

  const companyUsers = selectedCompanyId
    ? users.filter(u => u.companyId === selectedCompanyId)
    : [];

  const stats = [
    { icon: Building2, value: companies.length, label: t('admin.companies') },
    { icon: Users, value: users.length, label: t('admin.users') },
    { icon: Wrench, value: totalAssets, label: t('admin.assets') },
    { icon: ClipboardList, value: openWOs, label: t('admin.workOrders') },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('admin.title')}</h1>

      <div className="grid grid-cols-4 gap-5 mb-6">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-card-bg rounded-xl border border-card-border p-5 flex items-center gap-4">
            <stat.icon size={24} className="text-primary" />
            <div>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              <p className="text-sm text-gray-500">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 mb-5">
        <button
          onClick={() => setActiveTab('companies')}
          className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
            activeTab === 'companies'
              ? 'text-gray-900 border-primary'
              : 'text-gray-400 border-transparent hover:text-gray-600'
          }`}
        >
          {t('admin.companies')}
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
            activeTab === 'audit'
              ? 'text-gray-900 border-primary'
              : 'text-gray-400 border-transparent hover:text-gray-600'
          }`}
        >
          {t('admin.auditLog')}
        </button>
      </div>

      {activeTab === 'companies' && (
        <div className="grid grid-cols-2 gap-5">
          <div className="bg-card-bg rounded-xl border border-card-border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{t('admin.companies')}</h2>
              <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-light">
                <Plus size={14} />
                {t('admin.createCompany')}
              </button>
            </div>
            {companies.map((company) => (
              <button
                key={company.id}
                onClick={() => setSelectedCompanyId(company.id)}
                className={`w-full text-left flex items-center justify-between px-4 py-3 rounded-lg mb-2 border transition-colors ${
                  selectedCompanyId === company.id
                    ? 'border-primary bg-blue-50'
                    : 'border-card-border hover:bg-gray-50'
                }`}
              >
                <div>
                  <p className="text-sm font-semibold text-gray-900">{company.name}</p>
                  <p className="text-xs text-gray-500">{company.industry} - {company.country}</p>
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                  {company.status}
                </span>
              </button>
            ))}
          </div>

          <div className="bg-card-bg rounded-xl border border-card-border p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('admin.users')}</h2>
            {selectedCompanyId ? (
              companyUsers.length > 0 ? (
                companyUsers.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between px-4 py-3 rounded-lg mb-2 border border-card-border"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{user.name}</p>
                      <p className="text-xs text-gray-500">{user.email}</p>
                    </div>
                    <span className="text-xs text-gray-500 font-medium">{user.role}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-400">No users found</p>
              )
            ) : (
              <p className="text-sm text-gray-400">{t('admin.selectCompany')}</p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="bg-card-bg rounded-xl border border-card-border p-8 flex items-center justify-center">
          <p className="text-sm text-gray-400">Audit log coming soon</p>
        </div>
      )}
    </div>
  );
}
