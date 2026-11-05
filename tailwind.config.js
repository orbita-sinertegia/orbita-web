import colors from 'tailwindcss/colors'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Marca Órbita: las clases blue-* de la app se muestran en morado, y las purple-*
        // (estados como "Revisar") en fucsia para seguir distinguiéndose.
        blue: colors.purple,
        purple: colors.fuchsia,
        primary: {
          50: '#faf5ff',
          100: '#f3e8ff',
          500: '#a855f7',
          600: '#9333ea',
          700: '#7e22ce',
          900: '#581c87',
        },
        danger: {
          500: '#ef4444',
          600: '#dc2626',
        },
      },
    },
  },
  plugins: [],
}
