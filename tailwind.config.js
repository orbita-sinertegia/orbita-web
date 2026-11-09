/** Paleta Órbita: #1A1A1F noche, #2D2B55 índigo, #6A5ACD violeta, #A678B9 lila, #F0D9B5 crema, #F4A62A ámbar. */
const violeta = {
  50: '#F4F2FC', 100: '#E9E5F9', 200: '#D3CCF3', 300: '#B5AAEA', 400: '#968ADF',
  500: '#7D6FD5', 600: '#6A5ACD', 700: '#5546B5', 800: '#43398F', 900: '#2D2B55', 950: '#1E1D33',
}
const lila = {
  50: '#FAF5FC', 100: '#F3E9F7', 200: '#E7D3EE', 300: '#D4B3DF', 400: '#BD93CC',
  500: '#A678B9', 600: '#8F5FA3', 700: '#774D88', 800: '#5F3F6C', 900: '#4A3354', 950: '#2E1F35',
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Las clases blue-* de la app se muestran en violeta y las purple-* (estados como "Revisar") en lila.
        blue: violeta,
        purple: lila,
        violeta,
        lila,
        noche: '#1A1A1F',
        indigo: { ...violeta, DEFAULT: '#2D2B55' },
        crema: '#F0D9B5',
        ambar: { DEFAULT: '#F4A62A', 50: '#FEF6E8', 100: '#FDEBC9', 600: '#D98C12', 700: '#B4720C' },
        primary: { 50: violeta[50], 100: violeta[100], 500: violeta[500], 600: violeta[600], 700: violeta[700], 900: violeta[900] },
        danger: { 500: '#ef4444', 600: '#dc2626' },
      },
    },
  },
  plugins: [],
}
