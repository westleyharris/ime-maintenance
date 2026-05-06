/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        sidebar: '#152754',
        'sidebar-hover': '#1e3468',
        'sidebar-active': '#2a4080',
        'header-bg': '#ffffff',
        'page-bg': '#eef2f7',
        'card-bg': '#ffffff',
        'card-border': '#e2e8f0',
        primary: '#1e3a8a',
        'primary-light': '#3b5bdb',
      },
    },
  },
  plugins: [],
};
