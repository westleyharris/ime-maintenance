import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, Building2, ClipboardList, Search,
  Calendar, BarChart3, Waves, Shield, Settings,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Sidebar() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isImeAdmin = profile?.role === 'ime_admin';

  return (
    <aside className="hidden md:flex w-[260px] bg-sidebar flex-col justify-between shrink-0">
      <nav className="px-3 pt-3">
        {/* Main */}
        <div className="mb-1">
          <p className="text-[10.5px] font-semibold tracking-widest text-blue-300/50 px-3 mb-1 mt-2">
            {t('nav.main')}
          </p>
          {[
            { to: '/', icon: LayoutDashboard, label: 'nav.dashboard' },
            { to: '/assets', icon: Building2, label: 'nav.assets' },
          ].map(item => <SidebarLink key={item.to} {...item} t={t} />)}
        </div>

        {/* Operations */}
        <div className="mb-1">
          <p className="text-[10.5px] font-semibold tracking-widest text-blue-300/50 px-3 mb-1 mt-4">
            {t('nav.operations')}
          </p>
          {[
            { to: '/work-orders', icon: ClipboardList, label: 'nav.workOrders' },
            { to: '/inspections', icon: Search, label: 'nav.inspections' },
            { to: '/pm-calendar', icon: Calendar, label: 'nav.pmCalendar' },
          ].map(item => <SidebarLink key={item.to} {...item} t={t} />)}
        </div>

        {/* Analytics */}
        <div className="mb-1">
          <p className="text-[10.5px] font-semibold tracking-widest text-blue-300/50 px-3 mb-1 mt-4">
            {t('nav.analytics')}
          </p>
          {[
            { to: '/reports', icon: BarChart3, label: 'nav.reports' },
            { to: '/ultrasound', icon: Waves, label: 'nav.ultrasound' },
          ].map(item => <SidebarLink key={item.to} {...item} t={t} />)}
        </div>

        {/* Administration — ime_admin only */}
        {isImeAdmin && (
          <div className="mb-1">
            <p className="text-[10.5px] font-semibold tracking-widest text-blue-300/50 px-3 mb-1 mt-4">
              {t('nav.administration')}
            </p>
            <SidebarLink to="/admin" icon={Shield} label="nav.adminPanel" t={t} />
          </div>
        )}

        <div className="border-t border-white/10 mt-4 pt-2">
          <SidebarLink to="/settings" icon={Settings} label="nav.settings" t={t} />
        </div>
      </nav>

      <div className="px-6 py-4 text-[11px] text-blue-300/40">
        {t('common.version')}
      </div>
    </aside>
  );
}

function SidebarLink({
  to, icon: Icon, label, t,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  t: (k: string) => string;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] font-medium transition-colors ${
          isActive
            ? 'bg-sidebar-active text-white'
            : 'text-blue-200/75 hover:bg-sidebar-hover hover:text-white'
        }`
      }
    >
      <Icon size={17} strokeWidth={1.8} />
      {t(label)}
    </NavLink>
  );
}
