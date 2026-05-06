import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en';
import es from './es';

const savedLang = localStorage.getItem('ime-lang') || 'en';

i18n.use(initReactI18next).init({
  resources: {
    en,
    es,
  },
  lng: savedLang,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
