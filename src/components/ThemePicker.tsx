import { useTheme } from '../lib/theme'
import { MoonIcon, SunIcon } from './Icons'

export function ThemePicker() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <SunIcon size={15} /> : <MoonIcon size={15} />}
      <span className="theme-toggle__label">{isDark ? 'Light' : 'Dark'}</span>
    </button>
  )
}
