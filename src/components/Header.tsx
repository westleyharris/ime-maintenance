import { useTranslation } from 'react-i18next';
import { LogOut, ChevronDown, ChevronRight, Building2, MapPin } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useScope } from '../context/ScopeContext';

const roleBadge: Record<string, { label: string; className: string }> = {
  ime_admin:     { label: 'IME Admin',     className: 'bg-sidebar text-white' },
  company_admin: { label: 'Company Admin', className: 'bg-blue-100 text-blue-800' },
  plant_manager: { label: 'Plant Manager', className: 'bg-green-100 text-green-800' },
};

export default function Header() {
  const { t, i18n } = useTranslation();
  const { profile, signOut } = useAuth();
  const { companies, locations, selectedCompanyId, selectedLocationId, setCompany, setLocation } = useScope();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isImeAdmin = profile?.role === 'ime_admin';
  const canChangeLocation = profile?.role === 'ime_admin' || profile?.role === 'company_admin';

  const selectedCompany  = companies.find(c => c.id === selectedCompanyId);
  const selectedLocation = locations.find(l => l.id === selectedLocationId);

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'es' : 'en';
    i18n.changeLanguage(newLang);
    localStorage.setItem('ime-lang', newLang);
  };

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : profile?.email?.slice(0, 2).toUpperCase() ?? 'IA';

  const badge = profile ? (roleBadge[profile.role] ?? roleBadge.plant_manager) : null;

  return (
    <header className="bg-white border-b border-gray-200 z-10 shadow-sm shrink-0">

      {/* ── Main row ─────────────────────────────────────────────── */}
      <div className="flex items-center h-[56px] px-4 md:px-0">

        {/* Logo — full width on desktop, compact on mobile */}
        <div className="flex items-center gap-2 md:w-[260px] md:px-5 shrink-0">
          <img src="/logo.png" alt="IME Logo" className="w-8 h-8 shrink-0"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          <span className="text-[14px] font-bold text-sidebar tracking-tight leading-none">
            {t('header.platformName')}
          </span>
        </div>

        {/* Desktop scope selector */}
        {profile && (
          <div className="hidden md:flex items-center gap-1 ml-2 border-l border-gray-100 pl-4">
            <div className="flex items-center gap-1.5">
              <Building2 size={14} className="text-gray-400 shrink-0" />
              {isImeAdmin ? (
                <select value={selectedCompanyId ?? ''} onChange={e => setCompany(e.target.value || null)}
                  className="text-sm font-semibold text-gray-800 bg-transparent border-none outline-none cursor-pointer hover:text-primary pr-1 max-w-[140px]">
                  <option value="">Select company…</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              ) : (
                <span className="text-sm font-semibold text-gray-800">{selectedCompany?.name ?? '…'}</span>
              )}
            </div>

            {selectedCompanyId && (
              <>
                <ChevronRight size={14} className="text-gray-300 shrink-0" />
                <div className="flex items-center gap-1.5">
                  <MapPin size={13} className="text-gray-400 shrink-0" />
                  {canChangeLocation ? (
                    <select value={selectedLocationId ?? ''} onChange={e => setLocation(e.target.value || null)}
                      className="text-sm text-gray-600 bg-transparent border-none outline-none cursor-pointer hover:text-primary pr-1 max-w-[160px]">
                      <option value="">All locations</option>
                      {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  ) : (
                    <span className="text-sm text-gray-600">{selectedLocation?.name ?? 'All locations'}</span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex-1" />

        {/* Right controls */}
        <div className="flex items-center gap-2 md:gap-3 md:pr-6">
          <button onClick={toggleLanguage}
            className="text-xs font-bold text-gray-500 hover:text-primary transition-colors border border-gray-200 rounded px-1.5 py-0.5">
            {i18n.language === 'en' ? 'EN' : 'ES'}
          </button>

          {profile ? (
            <div className="relative" ref={menuRef}>
              <button onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 hover:bg-gray-50 rounded-lg px-1.5 py-1 transition-colors">
                <div className="w-8 h-8 rounded-full bg-sidebar text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {initials}
                </div>
                {/* Name only on desktop */}
                <div className="hidden md:flex flex-col items-start leading-none">
                  <span className="text-[13px] font-semibold text-gray-800">
                    {profile.full_name ?? profile.email}
                  </span>
                  {badge && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded mt-0.5 ${badge.className}`}>
                      {badge.label}
                    </span>
                  )}
                </div>
                <ChevronDown size={14} className="hidden md:block text-gray-400" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-52 bg-white rounded-xl border border-gray-200 shadow-lg py-1 z-50">
                  <div className="px-4 py-2.5 border-b border-gray-100">
                    <p className="text-xs font-semibold text-gray-800 truncate">{profile.email}</p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{profile.full_name}</p>
                    {badge && (
                      <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded mt-1 ${badge.className}`}>
                        {badge.label}
                      </span>
                    )}
                  </div>
                  <button onClick={() => { setMenuOpen(false); signOut(); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors">
                    <LogOut size={14} />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-sidebar text-white flex items-center justify-center text-xs font-bold">IA</div>
          )}
        </div>
      </div>

      {/* ── Mobile scope row ──────────────────────────────────────── */}
      {profile && (
        <div className="md:hidden flex items-center gap-2 px-4 py-2 bg-gray-50 border-t border-gray-100 overflow-x-auto">
          <Building2 size={13} className="text-gray-400 shrink-0" />
          {isImeAdmin ? (
            <select value={selectedCompanyId ?? ''} onChange={e => setCompany(e.target.value || null)}
              className="text-xs font-semibold text-gray-700 bg-transparent border-none outline-none max-w-[130px]">
              <option value="">Select company…</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : (
            <span className="text-xs font-semibold text-gray-700 truncate max-w-[130px]">
              {selectedCompany?.name ?? '…'}
            </span>
          )}

          {selectedCompanyId && (
            <>
              <ChevronRight size={12} className="text-gray-300 shrink-0" />
              <MapPin size={12} className="text-gray-400 shrink-0" />
              {canChangeLocation ? (
                <select value={selectedLocationId ?? ''} onChange={e => setLocation(e.target.value || null)}
                  className="text-xs text-gray-600 bg-transparent border-none outline-none max-w-[140px]">
                  <option value="">All locations</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              ) : (
                <span className="text-xs text-gray-600 truncate max-w-[140px]">
                  {selectedLocation?.name ?? 'All locations'}
                </span>
              )}
            </>
          )}
        </div>
      )}
    </header>
  );
}
