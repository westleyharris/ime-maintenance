import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Building2, Waves, BarChart3, Settings } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/',           icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/assets',     icon: Building2,       label: 'Assets'    },
  { to: '/ultrasound', icon: Waves,           label: 'Ultrasound'},
  { to: '/reports',    icon: BarChart3,       label: 'Reports'   },
  { to: '/settings',   icon: Settings,        label: 'Settings'  },
];

export default function MobileNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 flex md:hidden safe-bottom">
      {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-semibold transition-colors ${
              isActive ? 'text-primary' : 'text-gray-400'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
