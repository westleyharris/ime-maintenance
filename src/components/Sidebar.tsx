import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Building2,
  ClipboardList,
  Search,
  Calendar,
  BarChart3,
  Activity,
  Shield,
  Settings,
} from 'lucide-react';

const navItems = [
  {
    section: 'nav.main',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'nav.dashboard' },
      { to: '/assets', icon: Building2, label: 'nav.assets' },
    ],
  },
  {
    section: 'nav.operations',
    items: [
      { to: '/work-orders', icon: ClipboardList, label: 'nav.workOrders' },
      { to: '/inspections', icon: Search, label: 'nav.inspections' },
      { to: '/pm-calendar', icon: Calendar, label: 'nav.pmCalendar' },
    ],
  },
  {
    section: 'nav.analytics',
    items: [
      { to: '/reports', icon: BarChart3, label: 'nav.reports' },
      { to: '/vibration', icon: Activity, label: 'nav.vibration' },
    ],
  },
  {
    section: 'nav.administration',
    items: [
      { to: '/admin', icon: Shield, label: 'nav.adminPanel' },
    ],
  },
];

export default function Sidebar() {
  const { t } = useTranslation();

  return (
    <aside className="w-[260px] bg-sidebar flex flex-col justify-between shrink-0">
      <nav className="px-3 pt-3">
        {navItems.map((group) => (
          <div key={group.section} className="mb-1">
            <p className="text-[10.5px] font-semibold tracking-widest text-blue-300/50 px-3 mb-1 mt-4 first:mt-2">
              {t(group.section)}
            </p>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] font-medium transition-colors ${
                    isActive
                      ? 'bg-sidebar-active text-white'
                      : 'text-blue-200/75 hover:bg-sidebar-hover hover:text-white'
                  }`
                }
              >
                <item.icon size={17} strokeWidth={1.8} />
                {t(item.label)}
              </NavLink>
            ))}
          </div>
        ))}

        <div className="border-t border-white/10 mt-4 pt-2">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] font-medium transition-colors ${
                isActive
                  ? 'bg-sidebar-active text-white'
                  : 'text-blue-200/75 hover:bg-sidebar-hover hover:text-white'
              }`
            }
          >
            <Settings size={17} strokeWidth={1.8} />
            {t('nav.settings')}
          </NavLink>
        </div>
      </nav>

      <div className="px-6 py-4 text-[11px] text-blue-300/40">
        {t('common.version')}
      </div>
    </aside>
  );
}
