import { useTranslation } from 'react-i18next';
import { Globe, LogOut, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

const roleBadge: Record<string, { label: string; className: string }> = {
  ime_admin:     { label: 'IME Admin',     className: 'bg-sidebar text-white' },
  company_admin: { label: 'Company Admin', className: 'bg-blue-100 text-blue-800' },
  plant_manager: { label: 'Plant Manager', className: 'bg-green-100 text-green-800' },
};

export default function Header() {
  const { t, i18n } = useTranslation();
  const { profile, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'es' : 'en';
    i18n.changeLanguage(newLang);
    localStorage.setItem('ime-lang', newLang);
  };

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : profile?.email?.slice(0, 2).toUpperCase() ?? 'IA';

  const badge = profile ? (roleBadge[profile.role] ?? roleBadge.plant_manager) : null;

  return (
    <header className="h-[60px] bg-white border-b border-gray-200 flex items-center w-full z-10 shadow-sm">
      {/* Logo zone — same width as sidebar so they align */}
      <div className="w-[260px] shrink-0 flex items-center gap-2.5 px-5">
        <img
          src="/logo.png"
          alt="IME Logo"
          className="w-9 h-9"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
        <span className="text-[15px] font-bold text-sidebar tracking-tight leading-none">
          {t('header.platformName')}
        </span>
      </div>

      <div className="flex-1" />

      {/* Right controls */}
      <div className="flex items-center gap-3 pr-6">
        <Globe size={17} className="text-gray-400" />
        <button
          onClick={toggleLanguage}
          className="text-sm font-semibold text-gray-700 hover:text-primary transition-colors"
        >
          {i18n.language === 'en' ? 'EN' : 'ES'}
        </button>

        {/* User dropdown */}
        {profile ? (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 hover:bg-gray-50 rounded-lg px-2 py-1 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-sidebar text-white flex items-center justify-center text-xs font-bold shrink-0">
                {initials}
              </div>
              <div className="flex flex-col items-start leading-none">
                <span className="text-[13px] font-semibold text-gray-800">
                  {profile.full_name ?? profile.email}
                </span>
                {badge && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded mt-0.5 ${badge.className}`}>
                    {badge.label}
                  </span>
                )}
              </div>
              <ChevronDown size={14} className="text-gray-400 ml-1" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-48 bg-white rounded-xl border border-gray-200 shadow-lg py-1 z-50">
                <div className="px-4 py-2.5 border-b border-gray-100">
                  <p className="text-xs font-semibold text-gray-800 truncate">{profile.email}</p>
                  {badge && (
                    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded mt-1 ${badge.className}`}>
                      {badge.label}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => { setMenuOpen(false); signOut(); }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut size={14} />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-sidebar text-white flex items-center justify-center text-xs font-bold">
            IA
          </div>
        )}
      </div>
    </header>
  );
}
