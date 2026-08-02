export const DEFAULT_LOCAL_DATABASE_URL =
  'postgres://instatic:instatic@127.0.0.1:5433/instatic'

export function isPostgresDatabaseUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'postgres:' || url.protocol === 'postgresql:'
  } catch {
    return false
  }
}
