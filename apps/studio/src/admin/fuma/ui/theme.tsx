/**
 * Theme switching for hosted surfaces.
 *
 * `next-themes` owns the persisted choice and the class on the document root,
 * which is what the `dark` variant in `hosted.css` keys off. It is mounted only
 * around hosted platform surfaces: the builder keeps its own appearance
 * preferences and must not have a second writer on the same element.
 *
 * `storageKey` is namespaced for the same reason.
 */
import { ThemeProvider, useTheme } from 'next-themes'
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface HostedThemeProviderProps {
  children: ReactNode
  /** Theme applied when the visitor has expressed no preference. */
  defaultTheme?: 'light' | 'dark' | 'system'
}

export function HostedThemeProvider({
  children,
  defaultTheme = 'light',
}: HostedThemeProviderProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={defaultTheme}
      enableSystem
      disableTransitionOnChange
      storageKey="fuma.hosted.theme"
    >
      {children}
    </ThemeProvider>
  )
}

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.4v1.5M8 13.1v1.5M1.4 8h1.5M13.1 8h1.5M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <path
        d="M13 9.9A5.5 5.5 0 0 1 6.1 3a5.6 5.6 0 1 0 6.9 6.9Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export interface ThemeToggleProps {
  className?: string
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={cn(
        'inline-flex items-center justify-center rounded-full p-1.5 transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        className,
      )}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}
