import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Search, ClipboardList, Building2,
  Waves, BarChart3, Settings, Shield, MoreHorizontal, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// The four screens a phone user actually works from. Findings and Work Orders
// used to be unreachable on mobile — there is no sidebar at this breakpoint.
const PRIMARY = [
  { to: '/',            icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/findings',    icon: Search,          label: 'Findings'  },
  { to: '/work-orders', icon: ClipboardList,   label: 'Work Orders' },
  { to: '/assets',      icon: Building2,       label: 'Assets'    },
];

export default function MobileNav() {
  const { profile } = useAuth();
  const isImeAdmin = profile?.role === 'ime_admin';
  const { pathname } = useLocation();
  const [showMore, setShowMore] = useState(false);

  const secondary = [
    { to: '/ultrasound', icon: Waves,     label: 'Ultrasound' },
    { to: '/reports',    icon: BarChart3, label: 'Reports'    },
    ...(isImeAdmin ? [{ to: '/admin', icon: Shield, label: 'Admin Panel' }] : []),
    { to: '/settings',   icon: Settings,  label: 'Settings'   },
  ];

  const moreIsActive = secondary.some(s => pathname.startsWith(s.to));

  return (
    <>
      {/* "More" sheet — holds the screens that don't fit the 5-tab bar */}
      {showMore && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setShowMore(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            // pb clears the fixed nav bar below, which paints over the sheet
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-4 pb-24 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-gray-900">More</p>
              <button onClick={() => setShowMore(false)} className="p-2 -mr-2 rounded-lg text-gray-400 hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {secondary.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setShowMore(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3.5 rounded-xl border text-sm font-semibold transition-colors ${
                      isActive
                        ? 'border-primary/30 bg-primary/5 text-primary'
                        : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`
                  }
                >
                  <Icon size={18} />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 flex md:hidden safe-bottom">
        {PRIMARY.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 min-w-0 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-semibold transition-colors ${
                isActive ? 'text-primary' : 'text-gray-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={21} strokeWidth={isActive ? 2.2 : 1.8} />
                <span className="truncate max-w-full px-0.5">{label}</span>
              </>
            )}
          </NavLink>
        ))}

        <button
          onClick={() => setShowMore(true)}
          className={`flex-1 min-w-0 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-semibold transition-colors ${
            moreIsActive || showMore ? 'text-primary' : 'text-gray-400'
          }`}
        >
          <MoreHorizontal size={21} strokeWidth={moreIsActive || showMore ? 2.2 : 1.8} />
          <span className="truncate max-w-full px-0.5">More</span>
        </button>
      </nav>
    </>
  );
}
