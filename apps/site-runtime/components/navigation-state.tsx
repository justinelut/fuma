'use client'

import { usePathname } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

const NavigationStateContext = createContext<Readonly<{ visits: number; noteVisit(): void }> | null>(null)

export function NavigationStateProvider({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname()
  const [visits, setVisits] = useState(0)
  const noteVisit = useCallback(() => setVisits((current) => current + 1), [])
  const value = useMemo(() => Object.freeze({ visits, noteVisit }), [noteVisit, visits])
  useEffect(() => {
    const frame = requestAnimationFrame(noteVisit)
    return () => cancelAnimationFrame(frame)
  }, [noteVisit, pathname])
  return (
    <NavigationStateContext value={value}>
      <output hidden data-fuma-navigation-visits={visits}>{visits}</output>
      {children}
    </NavigationStateContext>
  )
}

export function useNavigationState() {
  const value = useContext(NavigationStateContext)
  if (!value) throw new Error('Navigation state is outside its site layout.')
  return value
}
