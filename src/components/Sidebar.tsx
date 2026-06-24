import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, Building2, ClipboardList, Search,
  BarChart3, Waves, Shield, Settings, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Sidebar() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isImeAdmin = profile?.role === 'ime_admin';

  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('sidebar-collapsed') === 'true';
  });

  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  };

  return (
    <aside
      className={`hidden md:flex ${collapsed ? 'w-[64px]' : 'w-[260px]'} bg-sidebar flex-col justify-between shrink-0 transition-all duration-300 ease-in-out overflow-hidden`}
    >
      <nav className="px-2 pt-3">
        {/* Toggle button */}
        <div className={`flex mb-2 ${collapsed ? 'justify-center' : 'justify-end pr-1'}`}>
          <button
            onClick={toggle}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded-lg text-blue-200/50 hover:bg-sidebar-hover hover:text-white transition-colors"
          >
            {collapsed ? <ChevronRight size={16} strokeWidth={2} /> : <ChevronLeft size={16} strokeWidth={2} />}
          </button>
        </div>

        {/* Main */}
        <div className="mb-1">
          {!collapsed && (
            <p className="text-[10.5px] font-semibold tracking-widest text-blue-300/50 px-3 mb-1 mt-2">
              {t('nav.main')}
            </p>
          )}
          {collapsed && <div className="mt-2" />}
          {[
            { to: '/', icon: LayoutDashboard, label: 'nav.dashboard' },
            { to: '/assets', icon: Building2, label: 'nav.assets' },
          ].map(item => (
            <SidebarLink key={item.to} {...item} t={t} collapsed={collapsed} />
          ))}
        </div>

        {/* Operations */}
        <div className="mb-1">
          {!collapsed ? (
            <p className="text-[10.5px] font-semibold tracking-widest text-blue-300/50 px-3 mb-1 mt-4">
              {t('nav.operations')}
            </p>
          ) : (
            <div className="border-t border-white/10 my-2" />
          )}
          {[
            { to: '/work-orders', icon: ClipboardList, label: 'nav.workOrders' },
            { to: '/findings', icon: Search, label: 'nav.inspections' },
          ].map(item => (
            <SidebarLink key={item.to} {...item} t={t} collapsed={collapsed} />
          ))}
        </div>

        {/* Analytics */}
        <div className="mb-1">
          {!collapsed ? (
            <p className="text-[10.5px] font-semibold tracking-widest text-blue-300/50 px-3 mb-1 mt-4">
              {t('nav.analytics')}
            </p>
          ) : (
            <div className="border-t border-white/10 my-2" />
          )}
          {[
            { to: '/reports', icon: BarChart3, label: 'nav.reports' },
            { to: '/ultrasound', icon: Waves, label: 'nav.ultrasound' },
          ].map(item => (
            <SidebarLink key={item.to} {...item} t={t} collapsed={collapsed} />
          ))}
        </div>

        {/* Administration — ime_admin only */}
        {isImeAdmin && (
          <div className="mb-1">
            {!collapsed ? (
              <p className="text-[10.5px] font-semibold tracking-widest text-blue-300/50 px-3 mb-1 mt-4">
                {t('nav.administration')}
              </p>
            ) : (
              <div className="border-t border-white/10 my-2" />
            )}
            <SidebarLink to="/admin" icon={Shield} label="nav.adminPanel" t={t} collapsed={collapsed} />
          </div>
        )}

        <div className="border-t border-white/10 mt-4 pt-2">
          <SidebarLink to="/settings" icon={Settings} label="nav.settings" t={t} collapsed={collapsed} />
        </div>
      </nav>

      {!collapsed && (
        <div className="px-6 py-4 text-[11px] text-blue-300/40">
          {t('common.version')}
        </div>
      )}
    </aside>
  );
}

function SidebarLink({
  to, icon: Icon, label, t, collapsed,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  t: (k: string) => string;
  collapsed: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      title={collapsed ? t(label) : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] font-medium transition-colors ${
          collapsed ? 'justify-center' : ''
        } ${
          isActive
            ? 'bg-sidebar-active text-white'
            : 'text-blue-200/75 hover:bg-sidebar-hover hover:text-white'
        }`
      }
    >
      <Icon size={17} strokeWidth={1.8} className="shrink-0" />
      {!collapsed && (
        <span className="whitespace-nowrap overflow-hidden">{t(label)}</span>
      )}
    </NavLink>
  );
}
