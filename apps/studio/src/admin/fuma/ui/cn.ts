import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merges conditional class lists and resolves Tailwind conflicts last-wins. */
export function cn(...inputs: readonly ClassValue[]): string {
  return twMerge(clsx(inputs))
}
