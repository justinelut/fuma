import { packageNameFromImportSpecifier } from '@core/site-runtime'
import type { NextSourceDiagnosticCategory } from './nextSourceContracts'

export const NEXT_SOURCE_POLICY_VERSION = 'fuma-next-16.2.9-react-19.2.5/1' as const

export const NEXT_SOURCE_INSTALLED_VERSIONS = Object.freeze({
  next: '16.2.9',
  react: '19.2.5',
  'react-dom': '19.2.5',
  '@radix-ui/react-slot': '1.3.3',
  'class-variance-authority': '0.7.1',
  clsx: '2.1.1',
  'lucide-react': '1.26.0',
  'tailwind-merge': '3.6.0',
})

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dns', 'events', 'fs',
  'http', 'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'stream',
  'tls', 'url', 'util', 'vm', 'worker_threads', 'zlib',
])

const PROVIDER_PACKAGES = new Set([
  '@aws-sdk/client-s3', '@sendgrid/mail', '@stripe/stripe-js', 'firebase',
  'firebase-admin', 'nodemailer', 'paystack', 'resend', 'stripe',
])

const SUPPORTED_NEXT_SPECIFIERS = new Set([
  'next', 'next/head', 'next/image', 'next/link', 'next/navigation',
])

const REMAPPABLE_NEXT_SPECIFIERS = new Map([
  ['next/font/google', 'Replace with Fuma typography and local font assets.'],
  ['next/font/local', 'Replace with Fuma typography and local font assets.'],
  ['next/router', 'Replace with the installed next/navigation public API.'],
  ['next/script', 'Move the script to Fuma’s reviewed site-script authority.'],
])

const SERVER_NEXT_SPECIFIERS = new Set([
  'next/cache', 'next/headers', 'next/server', 'next/config',
])

const SUPPORTED_REACT_SPECIFIERS = new Set([
  'react', 'react/compiler-runtime', 'react/jsx-dev-runtime', 'react/jsx-runtime',
])

const SUPPORTED_REACT_DOM_SPECIFIERS = new Set([
  'react-dom', 'react-dom/client',
])

const ROOT_ONLY_PACKAGES = new Set([
  '@radix-ui/react-slot', 'class-variance-authority', 'clsx', 'lucide-react',
  'tailwind-merge',
])

export interface NextSourceImportPolicyDecision {
  policy: 'local' | 'supported' | 'remappable' | 'blocked'
  packageName?: string
  installedVersion?: string
  diagnosticCategory?: NextSourceDiagnosticCategory
  message?: string
  deterministicFix?: string
}

function withoutNodeProtocol(specifier: string): string {
  return specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier
}

function isLocalSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@/')
}

function decisionForNext(specifier: string): NextSourceImportPolicyDecision {
  const base = { packageName: 'next', installedVersion: NEXT_SOURCE_INSTALLED_VERSIONS.next }
  if (SUPPORTED_NEXT_SPECIFIERS.has(specifier)) return { ...base, policy: 'supported' }

  const deterministicFix = REMAPPABLE_NEXT_SPECIFIERS.get(specifier)
  if (deterministicFix) {
    return {
      ...base,
      policy: 'remappable',
      diagnosticCategory: 'unsupported-next-api',
      message: `Next.js API "${specifier}" requires a deterministic Fuma rewrite.`,
      deterministicFix,
    }
  }

  if (SERVER_NEXT_SPECIFIERS.has(specifier) || specifier.startsWith('next/server/')) {
    return {
      ...base,
      policy: 'blocked',
      diagnosticCategory: 'server-authority-required',
      message: `Next.js server API "${specifier}" cannot execute during or after source import.`,
    }
  }

  return {
    ...base,
    policy: 'blocked',
    diagnosticCategory: 'unsupported-next-api',
    message: `Next.js API "${specifier}" is not in policy ${NEXT_SOURCE_POLICY_VERSION}.`,
  }
}

export function classifyNextSourceImport(specifier: string): NextSourceImportPolicyDecision {
  if (isLocalSpecifier(specifier)) return { policy: 'local' }

  const builtin = withoutNodeProtocol(specifier).split('/')[0] ?? ''
  if (specifier.startsWith('node:') || NODE_BUILTINS.has(builtin)) {
    return {
      policy: 'blocked',
      packageName: specifier,
      diagnosticCategory: 'server-authority-required',
      message: `Node server API "${specifier}" requires an existing Fuma backend authority.`,
    }
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) {
    return {
      policy: 'blocked',
      diagnosticCategory: 'unsupported-dependency',
      message: `External module URL "${specifier}" is not an installed Fuma dependency.`,
    }
  }

  const packageName = packageNameFromImportSpecifier(specifier) ?? specifier
  if (PROVIDER_PACKAGES.has(packageName) || packageName.startsWith('@stripe/')) {
    return {
      policy: 'blocked',
      packageName,
      diagnosticCategory: 'provider-sdk-denied',
      message: `Provider SDK "${packageName}" must be adapted to an existing Fuma authority.`,
    }
  }

  if (packageName === 'next') return decisionForNext(specifier)
  if (packageName === 'react') {
    const installedVersion = NEXT_SOURCE_INSTALLED_VERSIONS.react
    if (SUPPORTED_REACT_SPECIFIERS.has(specifier)) {
      return { policy: 'supported', packageName, installedVersion }
    }
    return {
      policy: 'blocked', packageName, installedVersion,
      diagnosticCategory: specifier.includes('server')
        ? 'server-authority-required'
        : 'unsupported-dependency',
      message: `React API "${specifier}" is not in policy ${NEXT_SOURCE_POLICY_VERSION}.`,
    }
  }
  if (packageName === 'react-dom') {
    const installedVersion = NEXT_SOURCE_INSTALLED_VERSIONS['react-dom']
    if (SUPPORTED_REACT_DOM_SPECIFIERS.has(specifier)) {
      return { policy: 'supported', packageName, installedVersion }
    }
    return {
      policy: 'blocked', packageName, installedVersion,
      diagnosticCategory: specifier.includes('server') || specifier.includes('static')
        ? 'server-authority-required'
        : 'unsupported-dependency',
      message: `React DOM API "${specifier}" is not in policy ${NEXT_SOURCE_POLICY_VERSION}.`,
    }
  }

  const installedVersion = NEXT_SOURCE_INSTALLED_VERSIONS[
    packageName as keyof typeof NEXT_SOURCE_INSTALLED_VERSIONS
  ]
  if (installedVersion && ROOT_ONLY_PACKAGES.has(packageName) && specifier === packageName) {
    return { policy: 'supported', packageName, installedVersion }
  }

  if (packageName === 'server-only') {
    return {
      policy: 'blocked', packageName,
      diagnosticCategory: 'server-authority-required',
      message: 'The server-only marker requires backend adaptation.',
    }
  }

  return {
    policy: 'blocked', packageName,
    diagnosticCategory: 'unsupported-dependency',
    message: `Package "${packageName}" is not installed and allowed by ${NEXT_SOURCE_POLICY_VERSION}.`,
  }
}

export function installedNextSourcePackageVersion(packageName: string): string | undefined {
  return NEXT_SOURCE_INSTALLED_VERSIONS[
    packageName as keyof typeof NEXT_SOURCE_INSTALLED_VERSIONS
  ]
}

export function isProviderPackage(packageName: string): boolean {
  return PROVIDER_PACKAGES.has(packageName) || packageName.startsWith('@stripe/')
}
