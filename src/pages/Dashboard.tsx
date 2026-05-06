import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Clock, Wrench, TrendingUp, Activity, CheckCircle, AlertTriangle,
  HelpCircle, ChevronDown, ChevronRight, Sparkles, ArrowRight,
  Building2, Factory,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
  BarChart, Bar, CartesianGrid,
} from 'recharts';
import { calculateKPIs, companies, workOrders, assets } from '../data/mockData';

type TimeRange = '7' | '30' | '90';

// Mock trend data
const trendData = [
  { month: '2026-01', MTBF: 280, MTTR: 5, Availability: 98 },
  { month: '2026-02', MTBF: 650, MTTR: 3, Availability: 99 },
  { month: '2026-03', MTBF: 720, MTTR: 8, Availability: 97 },
  { month: '2026-04', MTBF: 360, MTTR: 8, Availability: 97 },
];

const DONUT_COLORS: Record<string, string> = {
  Preventive: '#22c55e',
  Corrective: '#f59e0b',
  Emergency: '#ef4444',
};

const STATUS_COLORS: Record<string, string> = {
  Cancelled: '#6b7280',
  Closed: '#22c55e',
  Open: '#3b82f6',
  'In Progress': '#a855f7',
};

interface KpiCardProps {
  title: string;
  desc: string;
  value: string | number;
  link: string;
  linkText: string;
  icon: React.ReactNode;
  valueColor?: string;
}

function KpiCard({ title, desc, value, link, linkText, icon, valueColor = 'text-gray-900' }: KpiCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-1">
      <div className="flex items-start justify-between">
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        <div className="text-gray-400">{icon}</div>
      </div>
      <p className={`text-3xl font-bold mt-2 ${valueColor}`}>{value}</p>
      <p className="text-xs text-gray-400 leading-relaxed">{desc}</p>
      <Link
        to={link}
        className="text-xs text-primary font-medium flex items-center gap-1 hover:underline mt-1"
      >
        {linkText}
        <ArrowRight size={11} />
      </Link>
    </div>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const [timeRange, setTimeRange] = useState<TimeRange>('90');
  const [selectedCompany, setSelectedCompany] = useState('');
  const [kpiExpanded, setKpiExpanded] = useState(false);

  const kpis = calculateKPIs(selectedCompany || undefined);

  const kpiCards: KpiCardProps[] = [
    {
      title: t('dashboard.mtbf'),
      desc: t('dashboard.mtbfDesc'),
      value: `${kpis.mtbf}h`,
      link: '/work-orders',
      linkText: t('dashboard.viewCorrectiveWOs'),
      icon: <Clock size={18} />,
      valueColor: 'text-blue-600',
    },
    {
      title: t('dashboard.mttr'),
      desc: t('dashboard.mttrDesc'),
      value: `${kpis.mttr}h`,
      link: '/work-orders',
      linkText: t('dashboard.viewCorrectiveWOs'),
      icon: <Wrench size={18} />,
      valueColor: Number(kpis.mttr) === 0 ? 'text-green-600' : 'text-orange-500',
    },
    {
      title: t('dashboard.availability'),
      desc: t('dashboard.availabilityDesc'),
      value: `${kpis.availability}%`,
      link: '/work-orders',
      linkText: t('dashboard.viewCorrectiveWOs'),
      icon: <TrendingUp size={18} />,
      valueColor: Number(kpis.availability) >= 95 ? 'text-green-600' : 'text-red-500',
    },
    {
      title: t('dashboard.woBacklog'),
      desc: t('dashboard.woBacklogDesc'),
      value: kpis.woBacklog,
      link: '/work-orders',
      linkText: t('dashboard.workOrders'),
      icon: <Activity size={18} />,
      valueColor: kpis.woBacklog === 0 ? 'text-green-600' : 'text-gray-900',
    },
    {
      title: t('dashboard.pmCompliance'),
      desc: t('dashboard.pmComplianceDesc'),
      value: `${kpis.pmCompliance}%`,
      link: '/work-orders',
      linkText: t('dashboard.viewPreventiveWOs'),
      icon: <CheckCircle size={18} />,
      valueColor: Number(kpis.pmCompliance) >= 80 ? 'text-green-600' : 'text-orange-500',
    },
    {
      title: t('dashboard.criticalFindings'),
      desc: t('dashboard.criticalFindingsDesc'),
      value: kpis.criticalFindings,
      link: '/inspections',
      linkText: `${t('dashboard.inspectionFindings')} ${kpis.criticalFindings} →`,
      icon: <AlertTriangle size={18} />,
      valueColor: kpis.criticalFindings > 0 ? 'text-red-600' : 'text-green-600',
    },
  ];

  // WO by type
  const woByType = (() => {
    const counts: Record<string, number> = {};
    workOrders.forEach(wo => {
      const label = wo.type.charAt(0).toUpperCase() + wo.type.slice(1);
      counts[label] = (counts[label] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  })();

  // WO by status
  const woByStatus = (() => {
    const counts: Record<string, number> = {};
    workOrders.forEach(wo => {
      const label = wo.status === 'in_progress' ? 'In Progress'
        : wo.status.charAt(0).toUpperCase() + wo.status.slice(1);
      counts[label] = (counts[label] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  })();

  return (
    <div className="space-y-5">
      {/* Title row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('dashboard.title')}</h1>
          <p className="text-sm text-gray-500">{t('dashboard.welcome', { name: 'IME' })}</p>
        </div>
        <div className="flex items-center gap-2">
          {(['7', '30', '90'] as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                timeRange === range
                  ? 'bg-primary text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {t(`dashboard.days${range}`)}
            </button>
          ))}

          <button className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-primary text-primary text-sm font-medium hover:bg-blue-50 transition-colors">
            <Sparkles size={14} />
            AI Report
          </button>

          <select
            value={selectedCompany}
            onChange={(e) => setSelectedCompany(e.target.value)}
            className="px-3.5 py-1.5 rounded-lg text-sm border border-gray-200 bg-white text-gray-600"
          >
            <option value="">{t('dashboard.selectCompany')}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4">
        {kpiCards.map((card) => (
          <KpiCard key={card.title} {...card} />
        ))}
      </div>

      {/* Critical Findings Alert Banner */}
      {kpis.criticalFindings > 0 && (
        <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-5 py-3.5">
          <div className="flex items-center gap-3">
            <AlertTriangle size={18} className="text-red-500 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-700">{t('dashboard.criticalFindings')}</p>
              <p className="text-xs text-red-500">
                {kpis.criticalFindings} critical findings require immediate attention
              </p>
            </div>
          </div>
          <Link
            to="/inspections"
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg border border-red-300 text-red-600 text-sm font-medium hover:bg-red-100 transition-colors"
          >
            Actions <ArrowRight size={13} />
          </Link>
        </div>
      )}

      {/* KPI explainer accordion */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <button
          onClick={() => setKpiExpanded(!kpiExpanded)}
          className="w-full flex items-center justify-between px-5 py-3.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <span className="flex items-center gap-2">
            <HelpCircle size={15} />
            {t('dashboard.howKPIs')}
          </span>
          {kpiExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        {kpiExpanded && (
          <div className="px-5 pb-4 text-sm text-gray-500 space-y-1.5 border-t border-gray-100">
            <p><strong>MTBF</strong> — Mean Time Between Failures. Calculated from closed corrective/emergency work orders that have downtime hours recorded.</p>
            <p><strong>MTTR</strong> — Mean Time To Repair. Average downtime hours across closed corrective/emergency work orders.</p>
            <p><strong>Availability</strong> — MTBF / (MTBF + MTTR) × 100</p>
            <p><strong>WO Backlog</strong> — Count of work orders currently open or in progress.</p>
            <p><strong>PM Compliance</strong> — Closed preventive WOs / Total scheduled preventive WOs × 100</p>
          </div>
        )}
      </div>

      {/* KPI Trend Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">KPI Trend</h2>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={trendData} margin={{ top: 4, right: 16, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="Availability" stroke="#22c55e" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="MTBF" stroke="#3b82f6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="MTTR" stroke="#f59e0b" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* WO Charts row */}
      <div className="grid grid-cols-2 gap-4">
        {/* WO by Type - Donut */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-800 mb-2">Work Orders by Type</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={woByType}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={3}
                dataKey="value"
                label={({ name, value }) => `${name}: ${value}`}
                labelLine={false}
              >
                {woByType.map((entry) => (
                  <Cell key={entry.name} fill={DONUT_COLORS[entry.name] || '#94a3b8'} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* WO by Status - Bar */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-800 mb-2">Work Orders by Status</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={woByStatus} margin={{ top: 4, right: 16, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {woByStatus.map((entry) => (
                  <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#94a3b8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* KPIs by Asset Hierarchy */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">KPIs by Asset Hierarchy</h2>
        <div className="space-y-1">
          {assets.map((site) => (
            <div key={site.id}>
              <div className="flex items-center justify-between py-2 px-3 hover:bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                  <Building2 size={14} className="text-blue-500" />
                  {site.name}
                </div>
                <span className="text-xs px-2 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700 font-medium">
                  Site
                </span>
              </div>
              {site.children?.map((plant) => (
                <div key={plant.id} className="ml-6">
                  <div className="flex items-center justify-between py-2 px-3 hover:bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <Factory size={14} className="text-green-600" />
                      {plant.name}
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded border border-green-200 bg-green-50 text-green-700 font-medium">
                      Plant
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
