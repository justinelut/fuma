'use client'

export default function ErrorBoundary({ reset }: Readonly<{ error: Error & { digest?: string }; reset(): void }>) {
  return <main role="alert"><h1>Site temporarily unavailable</h1><button type="button" onClick={reset}>Try again</button></main>
}
