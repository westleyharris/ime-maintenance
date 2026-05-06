import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';

export default function Header() {
  const { t, i18n } = useTranslation();

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'es' : 'en';
    i18n.changeLanguage(newLang);
    localStorage.setItem('ime-lang', newLang);
  };

  return (
    <header className="h-[60px] bg-white border-b border-gray-200 flex items-center w-full z-10 shadow-sm">
      {/* Logo zone — same width as sidebar so they align */}
      <div className="w-[260px] shrink-0 flex items-center gap-2.5 px-5">
        {/* Hexagon logo — swap src to /logo.svg once you drop the file in public/ */}
        <img
          src="/logo.png"
          alt="IME Logo"
          className="w-9 h-9"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
        {/* Fallback placeholder shown until logo.svg is present */}
        <span className="text-[15px] font-bold text-sidebar tracking-tight leading-none">
          {t('header.platformName')}
        </span>
      </div>

      {/* Spacer */}
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
        <div className="w-8 h-8 rounded-full bg-sidebar text-white flex items-center justify-center text-xs font-bold">
          IA
        </div>
      </div>
    </header>
  );
}
