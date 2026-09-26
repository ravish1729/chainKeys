import { useState } from 'react'

export type Theme = 'dark' | 'light'

const KEY = 'chainkeys-theme'

export function getTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* private mode */
  }
  return 'dark'
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* private mode */
  }
}

export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(getTheme)

  function choose(next: Theme) {
    setTheme(next)
    applyTheme(next)
  }

  return (
    <div className="theme-switch" role="group" aria-label="Color theme">
      <button type="button" className={theme === 'dark' ? 'on' : ''} onClick={() => choose('dark')}>
        Dark
      </button>
      <button type="button" className={theme === 'light' ? 'on' : ''} onClick={() => choose('light')}>
        Light
      </button>
    </div>
  )
}
