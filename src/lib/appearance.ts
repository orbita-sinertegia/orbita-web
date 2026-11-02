export type AppearanceTheme = 'light' | 'dark' | 'system'
export type TextSize = 'normal' | 'large'

export interface AppearancePreferences {
  theme: AppearanceTheme
  compact: boolean
  textSize: TextSize
}

export function readAppearance(): AppearancePreferences {
  const theme = localStorage.getItem('sinertegia-theme') as AppearanceTheme | null
  const textSize = localStorage.getItem('sinertegia-text-size') as TextSize | null
  return {
    theme: theme === 'dark' || theme === 'system' ? theme : 'light',
    compact: localStorage.getItem('sinertegia-compact') === 'true',
    textSize: textSize === 'large' ? 'large' : 'normal',
  }
}

export function applyAppearance(preferences: AppearancePreferences) {
  const root = document.documentElement
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  root.classList.toggle('ui-compact', preferences.compact)
  root.classList.toggle('ui-large-text', preferences.textSize === 'large')
  root.classList.toggle('ui-dark', preferences.theme === 'dark' || (preferences.theme === 'system' && prefersDark))
}

export function saveAppearance(preferences: AppearancePreferences) {
  localStorage.setItem('sinertegia-theme', preferences.theme)
  localStorage.setItem('sinertegia-compact', String(preferences.compact))
  localStorage.setItem('sinertegia-text-size', preferences.textSize)
  applyAppearance(preferences)
}
