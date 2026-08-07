/**
 * The starter template every new tenant site begins as.
 *
 * The property that decides whether this is any good: **our own reader must be able to
 * open every module in it.** If `app/page.tsx` falls outside the accepted subset then a
 * tenant opens the builder on day one and the canvas is empty, which reads as the product
 * being broken. So the starter is written in exactly the subset the engine round-trips, and
 * a test asserts that by running the real reader over every module.
 *
 * Emitted as data — a path-to-content map — rather than written directly, so the same
 * set can go to disk for a build, into the module store for editing, or into an assertion.
 *
 * Kept deliberately small. A starter with ten pages is ten things a tenant has to delete
 * before their site is theirs, and every one of them is a place for our example copy to
 * end up in production.
 */

import { packageJsonFor } from './libraryBaseline'

export type StarterFile = Readonly<{
  path: string
  content: string
  /**
   * True when the file is an editable module rather than configuration.
   *
   * The distinction matters: modules go into the tenant's workspace where the canvas and
   * the AI can edit them, configuration goes to disk for the build and is not something a
   * designer should be handed.
   */
  module: boolean
}>

/** Files that make a buildable Next site the canvas can immediately edit. */
export function starterFiles(siteName: string): readonly StarterFile[] {
  return Object.freeze([
    config('package.json', `${JSON.stringify(packageJsonFor(siteName), null, 2)}\n`),
    config('tsconfig.json', TSCONFIG),
    config('next.config.ts', NEXT_CONFIG),
    config('postcss.config.mjs', POSTCSS_CONFIG),
    config('app/globals.css', globalsCss()),
    config('lib/utils.ts', UTILS),
    module_('app/layout.tsx', layoutTsx(siteName)),
    module_('app/page.tsx', PAGE),
    module_('components/Hero.tsx', HERO),
  ])
}

/** Only the editable modules, for seeding a tenant's workspace. */
export function starterModules(siteName: string): readonly StarterFile[] {
  return Object.freeze(starterFiles(siteName).filter((file) => file.module))
}

function config(path: string, content: string): StarterFile {
  return Object.freeze({ path, content, module: false })
}

function module_(path: string, content: string): StarterFile {
  return Object.freeze({ path, content, module: true })
}

/**
 * `moduleResolution: bundler` because Next bundles rather than resolving like Node, and
 * `jsx: preserve` because Next compiles JSX itself.
 */
const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "jsx": "preserve",
    "module": "esnext",
    "moduleResolution": "bundler",
    "allowJs": false,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "skipLibCheck": true,
    "paths": {
      "@/*": ["./*"]
    },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`

const NEXT_CONFIG = `import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // A type error fails the build deliberately: a site that ships with a type error is a
  // site with a bug nobody saw.
  //
  // There is no eslint key here because Next 16 removed it from NextConfig. Including one
  // reads fine against the documentation and fails against the actual types, which is why
  // this file is compiled against the real installed Next rather than reviewed by eye.
  typescript: { ignoreBuildErrors: false },
}

export default nextConfig
`

const POSTCSS_CONFIG = `const config = {
  plugins: ['@tailwindcss/postcss'],
}

export default config
`

/**
 * The utility every shadcn component calls.
 *
 * `twMerge` is what makes a className prop override a component's own classes instead of
 * both being emitted and the winner decided by Tailwind's source order.
 */
const UTILS = `import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
`

/**
 * The stylesheet.
 *
 * `@theme inline` maps shadcn's semantic names onto the tokens, which is what lets
 * `bg-primary` follow a token change rather than being a fixed colour. The light and dark
 * blocks are the same names with different values, so a component never needs to know
 * which mode it is in.
 */
function globalsCss(): string {
  return `@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
`
}

/**
 * The root layout.
 *
 * `suppressHydrationWarning` on `<html>` is required by next-themes: it sets the class
 * before React hydrates, so the server and client markup differ by design and React would
 * otherwise report it as an error on every page load.
 *
 * Written in the reader's accepted subset so a designer can edit the shared chrome on the
 * canvas rather than only in code.
 */
function layoutTsx(siteName: string): string {
  const title = siteName.replace(/'/g, "\\'")
  return `import type { Metadata } from 'next'
import { ThemeProvider } from 'next-themes'
import './globals.css'

export const metadata: Metadata = {
  title: '${title}',
  description: 'Built with Fuma.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html /* @fuma layout-html */ lang="en" suppressHydrationWarning>
      <body /* @fuma layout-body */ className="min-h-screen antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
`
}

/**
 * The home page.
 *
 * One section, composed from a component, so the starter demonstrates the shape the engine
 * wants — pages compose components — rather than a single wall of markup a tenant then
 * copies the style of.
 */
const PAGE = `import { Hero } from '@/components/Hero'

export default function Page() {
  return (
    <main /* @fuma page-main */ className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <Hero />
    </main>
  )
}
`

/**
 * The one starter component.
 *
 * Named export, which is shadcn's convention and what the reader accepts for a component
 * file. Animated, so the tenant can see the animation panel do something on their own site
 * rather than reading that the feature exists.
 */
const HERO = `'use client'

import * as motion from 'motion/react-client'

export function Hero() {
  return (
    <section /* @fuma hero-root */ className="flex flex-col gap-4">
      <motion.h1
        /* @fuma hero-title */
        className="text-4xl font-semibold tracking-tight text-foreground md:text-6xl"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        Your site starts here
      </motion.h1>
      <p /* @fuma hero-copy */ className="text-lg text-muted-foreground">
        Edit this on the canvas or in code. Both are the same file.
      </p>
    </section>
  )
}
`
