import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyAppearance, readAppearance } from './lib/appearance'

applyAppearance(readAppearance())

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const preferences = readAppearance()
  if (preferences.theme === 'system') applyAppearance(preferences)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
