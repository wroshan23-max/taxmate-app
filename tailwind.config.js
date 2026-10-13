/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef2f9',
          100: '#d8e2f0',
          500: '#2558a8',
          600: '#1a3c6e',
          700: '#142e55',
          800: '#0e2040',
          900: '#080f1e',
        },
        gold: {
          400: '#f0b832',
          500: '#e8a020',
          600: '#c4821a',
        },
        success: '#1a7a4a',
        danger: '#c0392b',
      },
      fontFamily: {
        sans: ['Segoe UI', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
