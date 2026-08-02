import { satisfies, validRange } from 'semver'
import { extractRuntimeImportSpecifiers } from '@core/site-runtime'
import { safeParseValue, Type } from '@core/utils/typeboxHelpers'
import type { FileMap } from './types'
import {
  NextSourceAnalysisReportSchema,
  NextSourceAnalysisRequestSchema,
  type NextSourceAnalysisReport,
  type NextSourceAnalysisRequest,
  type NextSourceAssetEvidence,
  type NextSourceConfigurationEvidence,
  type NextSourceDependencyEvidence,
  type NextSourceDiagnostic,
  type NextSourceDiagnosticCategory,
  type NextSourceFileEvidence,
  type NextSourceImport,
  type NextSourceInteractionBinding,
  type NextSourceInteractionEvidence,
  type NextSourceModule,
  type NextSourcePackageEvidence,
  type NextSourceStyleEvidence,
} from './nextSourceContracts'
import {
  NEXT_SOURCE_POLICY_VERSION,
  classifyNextSourceImport,
  installedNextSourcePackageVersion,
  isProviderPackage,
} from './nextSourcePolicy'
import { isReviewedNextSourceInteractionBinding } from './nextSourceInteractionBindings'
import { discoverNextSourceRoutes } from './nextSourceRoutes'
import { assertSafeNextSourceFileMap, inventoryNextSourceFiles, nextSourceSha256 } from './nextSourceAnalysisFiles'
import { analyzeNextSourceStaticClasses } from './nextSourceStaticClasses'

const ANALYZER_VERSION = 'fuma-next-source-analyzer/1' as const
const SOURCE_EXTENSION = /\.(?:js|jsx|ts|tsx|mjs|cjs|mdx)$/
const RESOLUTION_EXTENSIONS = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mdx', '.json', '.css']
const LOCKFILE = /(?:^|\/)(?:bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/
const decoder = new TextDecoder()
const encoder = new TextEncoder()

const StringRecordSchema = Type.Record(Type.String({ minLength: 1 }), Type.String({ minLength: 1 }))
const PackageJsonInputSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  packageManager: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  scripts: Type.Optional(StringRecordSchema),
  dependencies: Type.Optional(StringRecordSchema),
  optionalDependencies: Type.Optional(StringRecordSchema),
  peerDependencies: Type.Optional(StringRecordSchema),
  devDependencies: Type.Optional(StringRecordSchema),
}, { additionalProperties: true })

interface PendingDiagnostic {
  category: NextSourceDiagnosticCategory
  severity?: 'blocking' | 'warning'
  path: string
  line?: number
  start?: number
  end?: number
  specifier?: string
  message: string
  deterministicFix?: string
}

type UnboundDiagnostic = Omit<NextSourceDiagnostic,
  'policyVersion' | 'sourceHashSha256' | 'bindingHashSha256' | 'destination' | 'sourceRevision'>

function lineAt(source: string, offset: number): number {
  let line = 1
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1
  }
  return line
}

interface SourceImportEntry {
  specifier: string
  kind: NextSourceImport['kind']
  start: number
  end: number
}

function isCodeOffset(source: string, target: number): boolean {
  let index = 0
  while (index < target) {
    const char = source[index]
    const next = source[index + 1]
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index + 2)
      if (end === -1 || end >= target) return false
      index = end + 1
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      if (end === -1 || end + 2 > target) return false
      index = end + 2
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char
      index += 1
      while (index < source.length) {
        if (source[index] === '\\') index += 2
        else if (source[index] === quote) { index += 1; break }
        else index += 1
      }
      if (index > target) return false
      continue
    }
    index += 1
  }
  return true
}

function extractNextSourceImports(source: string): SourceImportEntry[] {
  const entries: SourceImportEntry[] = extractRuntimeImportSpecifiers(source)
    .map((entry) => ({ ...entry }))
  const typeImport = /\b(import|export)\s+type\b[^;]*?\bfrom\s*(['"])([^'"\r\n]+)\2/g
  for (const match of source.matchAll(typeImport)) {
    if (!isCodeOffset(source, match.index)) continue
    const specifier = match[3]!
    const start = match.index + match[0].lastIndexOf(specifier)
    entries.push({
      specifier,
      kind: match[1] === 'export' ? 'type-reexport' : 'type-static',
      start,
      end: start + specifier.length,
    })
  }
  const staticRequire = /\brequire\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)/g
  for (const match of source.matchAll(staticRequire)) {
    if (!isCodeOffset(source, match.index)) continue
    const specifier = match[2]!
    const start = match.index + match[0].lastIndexOf(specifier)
    entries.push({ specifier, kind: 'require', start, end: start + specifier.length })
  }
  return entries.sort((left, right) => left.start - right.start || left.end - right.end)
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

function normalizeRelativePath(path: string): string | null {
  const output: string[] = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (output.length === 0) return null
      output.pop()
    } else {
      output.push(segment)
    }
  }
  return output.join('/')
}

function resolveLocalImport(fromPath: string, specifier: string, paths: Set<string>): string | undefined {
  const clean = specifier.split(/[?#]/, 1)[0] ?? specifier
  const bases: string[] = []
  if (clean.startsWith('@/')) {
    bases.push(clean.slice(2), `src/${clean.slice(2)}`)
  } else if (clean.startsWith('/')) {
    bases.push(clean.slice(1))
  } else {
    const normalized = normalizeRelativePath(`${dirname(fromPath)}/${clean}`)
    if (normalized) bases.push(normalized)
  }

  for (const base of bases) {
    for (const extension of RESOLUTION_EXTENSIONS) {
      const direct = `${base}${extension}`
      if (paths.has(direct)) return direct
      const index = `${base}/index${extension}`
      if (extension && paths.has(index)) return index
    }
  }
  return undefined
}

function findNonLiteralDynamicImports(source: string): number[] {
  const offsets: number[] = []
  let index = 0
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]
    if (char === '/' && next === '/') {
      index = source.indexOf('\n', index + 2)
      if (index === -1) break
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      index = end === -1 ? source.length : end + 2
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char
      index += 1
      while (index < source.length) {
        if (source[index] === '\\') index += 2
        else if (source[index] === quote) { index += 1; break }
        else index += 1
      }
      continue
    }
    if (source.startsWith('import', index) && !/[A-Za-z0-9_$]/.test(source[index - 1] ?? '')) {
      let cursor = index + 'import'.length
      while (/\s/.test(source[cursor] ?? '')) cursor += 1
      if (source[cursor] === '(') {
        cursor += 1
        while (/\s/.test(source[cursor] ?? '')) cursor += 1
        if (source[cursor] !== '"' && source[cursor] !== "'") offsets.push(index)
      }
    }
    index += 1
  }
  return offsets
}

function diagnostic(input: PendingDiagnostic): UnboundDiagnostic {
  const severity = input.severity ?? 'blocking'
  const discriminator = input.specifier ?? input.message
  return {
    id: `${input.category}:${input.path}:${input.line ?? 0}:${discriminator}`,
    category: input.category,
    severity,
    path: input.path,
    ...(input.line === undefined ? {} : { line: input.line }),
    ...(input.start === undefined || input.end === undefined ? {} : { span: { start: input.start, end: input.end } }),
    ...(input.specifier === undefined ? {} : { specifier: input.specifier }),
    message: input.message,
    ...(input.deterministicFix === undefined ? {} : { deterministicFix: input.deterministicFix }),
  }
}

function analyzeModule(
  path: string,
  source: string,
  file: NextSourceFileEvidence,
  sourcePaths: Set<string>,
  diagnostics: UnboundDiagnostic[],
): NextSourceModule {
  const imports: NextSourceImport[] = []
  for (const entry of extractNextSourceImports(source)) {
    const decision = classifyNextSourceImport(entry.specifier)
    const line = lineAt(source, entry.start)
    const resolvedPath = decision.policy === 'local'
      ? resolveLocalImport(path, entry.specifier, sourcePaths)
      : undefined
    const effectivePolicy = entry.kind === 'dynamic' ? 'blocked' : decision.policy
    imports.push({
      specifier: entry.specifier,
      kind: entry.kind,
      policy: effectivePolicy,
      ...(decision.packageName === undefined ? {} : { packageName: decision.packageName }),
      ...(decision.installedVersion === undefined ? {} : { installedVersion: decision.installedVersion }),
      ...(resolvedPath === undefined ? {} : { resolvedPath }),
      line,
    })

    if (entry.kind === 'dynamic') {
      diagnostics.push(diagnostic({
        category: 'dynamic-import-denied', path, line, specifier: entry.specifier,
        message: `Dynamic import "${entry.specifier}" requires a deterministic static rewrite.`,
      }))
    } else if (decision.diagnosticCategory && decision.message) {
      diagnostics.push(diagnostic({
        category: decision.diagnosticCategory, path, line, specifier: entry.specifier,
        message: decision.message, deterministicFix: decision.deterministicFix,
      }))
    }
    if (decision.policy === 'local' && !resolvedPath) {
      diagnostics.push(diagnostic({
        category: 'unresolved-local-import', path, line, specifier: entry.specifier,
        message: `Local import "${entry.specifier}" does not resolve inside the ingested source map.`,
      }))
    }
  }

  for (const offset of findNonLiteralDynamicImports(source)) {
    diagnostics.push(diagnostic({
      category: 'dynamic-import-denied', path, line: lineAt(source, offset),
      message: 'Computed dynamic imports cannot be proven against the installed dependency policy.',
    }))
  }
  for (const match of source.matchAll(/(?:process\.env|import\.meta\.env)(?:\.[A-Za-z_$][\w$]*)?/g)) {
    diagnostics.push(diagnostic({
      category: 'secret-or-environment-access', path, line: lineAt(source, match.index),
      message: 'Imported source cannot read environment variables or secrets.',
    }))
  }
  for (const offset of analyzeNextSourceStaticClasses(source).dynamicOffsets) {
    diagnostics.push(diagnostic({
      category: 'dynamic-tailwind-denied', path, line: lineAt(source, offset),
      message: 'Computed class names cannot be included in the deterministic Tailwind inventory.',
      deterministicFix: 'Replace computed class fragments with a finite map of complete static class strings.',
    }))
  }
  if (/^[\s;]*["']use server["']/m.test(source) || /\bgetServerSideProps\b/.test(source)) {
    diagnostics.push(diagnostic({
      category: 'server-authority-required', path,
      message: 'Imported server actions and request-time server functions require an existing Fuma authority.',
    }))
  }

  return { path, sizeBytes: file.sizeBytes, sha256: file.sha256, imports }
}

function packageEvidence(
  fileMap: FileMap,
  paths: string[],
  diagnostics: UnboundDiagnostic[],
): NextSourcePackageEvidence {
  const lockfiles = paths.filter((path) => LOCKFILE.test(path))
  const manifests = paths.filter((path) => path === 'package.json' || path.endsWith('/package.json'))
    .sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))
  const path = manifests[0]
  if (!path) {
    return { present: false, dependencies: [], scriptNames: [], lockfiles, scriptsExecuted: false, packagesInstalled: false }
  }

  let raw: unknown
  try {
    raw = JSON.parse(decoder.decode(fileMap.files[path]!.bytes))
  } catch {
    diagnostics.push(diagnostic({ category: 'invalid-manifest', path, message: 'package.json is not valid JSON.' }))
    return { present: true, path, dependencies: [], scriptNames: [], lockfiles, scriptsExecuted: false, packagesInstalled: false }
  }
  const parsed = safeParseValue(PackageJsonInputSchema, raw)
  if (!parsed.ok) {
    diagnostics.push(diagnostic({ category: 'invalid-manifest', path, message: 'package.json dependency and script fields must contain string values.' }))
    return { present: true, path, dependencies: [], scriptNames: [], lockfiles, scriptsExecuted: false, packagesInstalled: false }
  }

  const dependencies: NextSourceDependencyEvidence[] = []
  const sections = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'] as const
  for (const section of sections) {
    const entries = parsed.value[section] ?? {}
    for (const [name, requestedVersion] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
      if (section === 'devDependencies') {
        dependencies.push({ section, name, requestedVersion, policy: 'evidence-only' })
        continue
      }
      const decision = classifyNextSourceImport(name)
      const installedVersion = installedNextSourcePackageVersion(name)
      let policy: NextSourceDependencyEvidence['policy'] = decision.policy === 'local' ? 'blocked' : decision.policy
      if (policy === 'supported' && installedVersion) {
        const range = validRange(requestedVersion)
        if (!range || !satisfies(installedVersion, range)) policy = 'blocked'
      }
      dependencies.push({
        section, name, requestedVersion, policy,
        ...(installedVersion === undefined ? {} : { installedVersion }),
      })
    }
  }

  return {
    present: true,
    path,
    ...(parsed.value.name === undefined ? {} : { name: parsed.value.name }),
    ...(parsed.value.packageManager === undefined ? {} : { packageManager: parsed.value.packageManager }),
    dependencies,
    scriptNames: Object.keys(parsed.value.scripts ?? {}).sort(),
    lockfiles,
    scriptsExecuted: false,
    packagesInstalled: false,
  }
}

function reachableDependencyDiagnostics(
  modules: readonly NextSourceModule[],
  packageReport: NextSourcePackageEvidence,
  diagnostics: UnboundDiagnostic[],
): void {
  const blocked = new Map(packageReport.dependencies
    .filter(({ section, policy }) => section !== 'devDependencies' && policy === 'blocked')
    .map((dependency) => [dependency.name, dependency]))
  for (const module of modules) {
    for (const imported of module.imports) {
      if (!imported.packageName) continue
      const dependency = blocked.get(imported.packageName)
      if (!dependency) continue
      const reason = dependency.installedVersion
        ? `Reachable import "${imported.specifier}" requests ${dependency.name}@${dependency.requestedVersion}, which does not accept installed ${dependency.installedVersion}.`
        : `Reachable import "${imported.specifier}" is not installed and allowed by ${NEXT_SOURCE_POLICY_VERSION}.`
      diagnostics.push(diagnostic({
        category: isProviderPackage(dependency.name) ? 'provider-sdk-denied' : 'unsupported-dependency',
        path: module.path,
        line: imported.line,
        specifier: imported.specifier,
        message: reason,
      }))
    }
  }
}

function isFrameworkRuntimeRoot(path: string): boolean {
  return /^(?:src\/)?app\/(?:.*\/)?(?:layout|template|default|loading)\.(?:js|jsx|ts|tsx|mjs|cjs|mdx)$/.test(path)
    || /^(?:src\/)?pages\/(?:_app|_document|_error)\.(?:js|jsx|ts|tsx|mjs|cjs|mdx)$/.test(path)
}

function reachableModulePaths(
  modules: readonly NextSourceModule[],
  routes: readonly NextSourceAnalysisReport['routes'][number][],
): Set<string> {
  const moduleByPath = new Map(modules.map((module) => [module.path, module]))
  const reachable = new Set<string>()
  const queue = [
    ...routes.map(({ sourcePath }) => sourcePath),
    ...modules.map(({ path }) => path).filter(isFrameworkRuntimeRoot),
  ]
  for (let index = 0; index < queue.length; index += 1) {
    const path = queue[index]!
    if (reachable.has(path)) continue
    reachable.add(path)
    const module = moduleByPath.get(path)
    if (!module) continue
    for (const imported of module.imports) {
      if (!imported.resolvedPath || imported.kind === 'type-static' || imported.kind === 'type-reexport') continue
      if (!reachable.has(imported.resolvedPath)) queue.push(imported.resolvedPath)
    }
  }
  return reachable
}

function routeDiagnostics(
  routes: NextSourceAnalysisReport['routes'],
  diagnostics: UnboundDiagnostic[],
): void {
  const byRoute = new Map<string, typeof routes>()
  for (const route of routes) {
    if (route.kind === 'route-handler') {
      diagnostics.push(diagnostic({
        category: 'server-authority-required', path: route.sourcePath,
        message: `Route handler "${route.route}" cannot execute as imported server code.`,
      }))
    } else if (route.kind === 'metadata' && SOURCE_EXTENSION.test(route.sourcePath)) {
      diagnostics.push(diagnostic({
        category: 'server-authority-required', path: route.sourcePath,
        message: `Executable metadata route "${route.route}" must be projected through an existing Fuma metadata or feed authority.`,
      }))
    } else if (route.kind === 'system') {
      diagnostics.push(diagnostic({
        category: 'unsupported-next-api', path: route.sourcePath,
        message: `Next.js system surface "${route.route}" must be adapted to the canonical Fuma fallback or error template.`,
        deterministicFix: 'Project this system component into the corresponding Fuma fallback or error template.',
      }))
    }
    const current = byRoute.get(route.route) ?? []
    current.push(route)
    byRoute.set(route.route, current)
  }
  for (const [route, entries] of byRoute) {
    if (entries.length < 2) continue
    for (const entry of entries) {
      diagnostics.push(diagnostic({
        category: 'route-conflict', path: entry.sourcePath,
        message: `Route "${route}" is declared by multiple imported modules.`,
      }))
    }
  }
}

function sortDiagnostics(items: UnboundDiagnostic[]): UnboundDiagnostic[] {
  const deduped = new Map(items.map((item) => [item.id, item]))
  return [...deduped.values()].sort((left, right) =>
    left.path.localeCompare(right.path) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    left.category.localeCompare(right.category) ||
    left.id.localeCompare(right.id),
  )
}

const ASSET_EXTENSION = /\.(?:avif|gif|ico|jpe?g|png|svg|webp|woff2?|ttf|otf|eot|mp3|m4a|ogg|wav|mp4|webm)$/i
const CSS_EXTENSION = /\.css$/i
const NEXT_CONFIG = /(?:^|\/)next\.config\.(?:js|mjs|cjs|ts)$/
const MIDDLEWARE = /(?:^|\/)middleware\.(?:js|jsx|ts|tsx|mjs|cjs)$/
const TAILWIND_CONFIG = /(?:^|\/)tailwind\.config\.(?:js|mjs|cjs|ts)$/

function assetKind(path: string): NextSourceAssetEvidence['kind'] {
  if (/\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i.test(path)) return 'image'
  if (/\.(?:woff2?|ttf|otf|eot)$/i.test(path)) return 'font'
  if (/\.(?:mp3|m4a|ogg|wav)$/i.test(path)) return 'audio'
  if (/\.(?:mp4|webm)$/i.test(path)) return 'video'
  return 'other'
}

function staticClassNames(source: string): string[] {
  const names = new Set(analyzeNextSourceStaticClasses(source).staticClassNames)
  for (const match of source.matchAll(/(?:className|class)\s*=\s*["']([^"']*)["']/g)) {
    for (const name of (match[1] ?? '').split(/\s+/)) if (name) names.add(name)
  }
  for (const match of source.matchAll(/(?:clsx|cn|cva)\s*\([^)]*?["']([^"']+)["']/g)) {
    for (const name of (match[1] ?? '').split(/\s+/)) if (name) names.add(name)
  }
  return [...names].sort()
}

function inventoryStyles(fileMap: FileMap, paths: string[]): NextSourceStyleEvidence[] {
  const styles: NextSourceStyleEvidence[] = []
  for (const path of paths) {
    if (CSS_EXTENSION.test(path)) {
      const source = decoder.decode(fileMap.files[path]!.bytes)
      const customProperties = [...new Set([...source.matchAll(/--([A-Za-z0-9_-]+)\s*:/g)].map((match) => `--${match[1]}`))].sort()
      styles.push({ path, kind: 'css', staticClassNames: [], customProperties })
      continue
    }
    if (SOURCE_EXTENSION.test(path)) {
      const names = staticClassNames(decoder.decode(fileMap.files[path]!.bytes))
      if (names.length > 0) styles.push({ path, kind: 'tailwind', staticClassNames: names, customProperties: [] })
    }
  }
  return styles
}

function inventoryInteractions(
  fileMap: FileMap,
  paths: string[],
  diagnostics: UnboundDiagnostic[],
  requestedBindings: readonly NextSourceInteractionBinding[],
): NextSourceInteractionEvidence[] {
  const bindingById = new Map<string, NextSourceInteractionBinding>()
  for (const binding of requestedBindings) {
    if (bindingById.has(binding.interactionId) || !isReviewedNextSourceInteractionBinding(binding)) {
      throw new Error('Invalid or duplicate reviewed interaction binding request.')
    }
    bindingById.set(binding.interactionId, binding)
  }
  const consumedBindings = new Set<string>()
  const rules: readonly Readonly<{ kind: NextSourceInteractionEvidence['kind']; pattern: RegExp; category: NextSourceDiagnosticCategory }>[] = [
    { kind: 'content', pattern: /\b(?:getStaticProps|getServerSideProps|graphql|contentful|sanity|ghost|usePosts|contentQuery)\b|["']\/api\/(?:posts|content|articles)/i, category: 'unbound-content-interaction' },
    { kind: 'member', pattern: /\b(?:member|account|signIn|signOut|session|auth)\b/i, category: 'unbound-member-interaction' },
    { kind: 'subscription', pattern: /\b(?:subscribe|subscription|checkout|paywall|paidAccess|payment)\b/i, category: 'unbound-subscription-interaction' },
    { kind: 'form', pattern: /<(?:form|input|textarea|select)\b|\bonSubmit\s*=/i, category: 'unbound-form-interaction' },
    { kind: 'podcast', pattern: /<(?:audio|source)\b|\b(?:podcast|enclosure|rss|episode|showNotes|transcript)\b/i, category: 'unbound-podcast-interaction' },
  ]
  const interactions: NextSourceInteractionEvidence[] = []
  for (const path of paths.filter((candidate) => SOURCE_EXTENSION.test(candidate))) {
    const source = decoder.decode(fileMap.files[path]!.bytes)
    for (const rule of rules) {
      const match = rule.pattern.exec(source)
      if (!match) continue
      const line = lineAt(source, match.index)
      const id = `${rule.kind}:${path}:${line}`
      const requestedBinding = bindingById.get(id)
      const boundAuthority = requestedBinding?.kind === rule.kind ? requestedBinding.authority : null
      if (boundAuthority) consumedBindings.add(id)
      interactions.push({ id, kind: rule.kind, path, line, boundAuthority })
      if (!boundAuthority) diagnostics.push(diagnostic({
        category: rule.category,
        path,
        line,
        start: match.index,
        end: match.index + match[0].length,
        message: `${rule.kind} interaction is not bound to an existing reviewed Fuma authority.`,
        deterministicFix: `Configure a ${rule.kind} mapping or intentionally remove this interaction.`,
      }))
    }
  }
  if (consumedBindings.size !== bindingById.size) {
    throw new Error('Reviewed interaction binding does not match the exact analyzed source graph.')
  }
  return interactions.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.kind.localeCompare(right.kind))
}

function configurationEvidence(
  fileMap: FileMap,
  paths: string[],
  diagnostics: UnboundDiagnostic[],
): NextSourceConfigurationEvidence {
  const nextConfigPaths = paths.filter((path) => NEXT_CONFIG.test(path))
  const middlewarePaths = paths.filter((path) => MIDDLEWARE.test(path))
  const tailwindConfigPaths = paths.filter((path) => TAILWIND_CONFIG.test(path))
  for (const path of middlewarePaths) diagnostics.push(diagnostic({
    category: 'server-authority-required', path,
    message: 'Imported Next.js middleware cannot execute and must be mapped to an existing Fuma authority.',
  }))
  for (const path of nextConfigPaths) {
    const source = decoder.decode(fileMap.files[path]!.bytes)
    if (/\b(?:webpack|turbopack|plugins?|with[A-Z][A-Za-z]+)\b/.test(source)) diagnostics.push(diagnostic({
      category: 'server-authority-required', path,
      message: 'Next.js configuration plugins and bundler callbacks are evidence only and cannot execute.',
    }))
  }
  for (const path of tailwindConfigPaths) {
    const source = decoder.decode(fileMap.files[path]!.bytes)
    if (/\bplugins?\s*:|\brequire\s*\(|\bimport\s+/.test(source)) diagnostics.push(diagnostic({
      category: 'dynamic-tailwind-denied', path,
      message: 'Tailwind plugins and executable configuration cannot run; only statically discovered classes are supported.',
    }))
  }
  return { nextConfigPaths, middlewarePaths, tailwindConfigPaths, configurationExecuted: false }
}

export async function analyzeNextSource(
  fileMap: FileMap,
  request: NextSourceAnalysisRequest,
): Promise<NextSourceAnalysisReport> {
  const checkedRequest = safeParseValue(NextSourceAnalysisRequestSchema, request)
  if (!checkedRequest.ok) throw new Error('Invalid scoped Next.js source-analysis request.')

  const paths = assertSafeNextSourceFileMap(fileMap)
  const files = await inventoryNextSourceFiles(fileMap, paths)
  const sourceHashSha256 = await nextSourceSha256(encoder.encode(JSON.stringify(
    files.map((file) => [file.path, file.sizeBytes, file.sha256]),
  )))
  const reviewedInteractionBindings = [...(checkedRequest.value.interactionBindings ?? [])]
    .sort((left, right) => left.interactionId.localeCompare(right.interactionId)
      || left.kind.localeCompare(right.kind)
      || left.authority.localeCompare(right.authority))
  const bindingHashSha256 = await nextSourceSha256(encoder.encode(JSON.stringify({
    destination: checkedRequest.value.destination,
    interactionBindings: reviewedInteractionBindings,
    policyVersion: NEXT_SOURCE_POLICY_VERSION,
    provenance: checkedRequest.value.provenance,
    sourceHashSha256,
  })))

  const diagnostics: UnboundDiagnostic[] = []
  const sourcePaths = new Set(paths)
  const fileByPath = new Map(files.map((file) => [file.path, file]))
  const allModules: NextSourceModule[] = []
  const moduleDiagnostics = new Map<string, UnboundDiagnostic[]>()
  for (const path of paths.filter((candidate) => SOURCE_EXTENSION.test(candidate))) {
    const localDiagnostics: UnboundDiagnostic[] = []
    allModules.push(analyzeModule(
      path,
      decoder.decode(fileMap.files[path]!.bytes),
      fileByPath.get(path)!,
      sourcePaths,
      localDiagnostics,
    ))
    moduleDiagnostics.set(path, localDiagnostics)
  }

  const routes = discoverNextSourceRoutes(paths)
  const reachablePaths = reachableModulePaths(allModules, routes)
  const modules = allModules.filter(({ path }) => reachablePaths.has(path))
  for (const { path } of modules) diagnostics.push(...(moduleDiagnostics.get(path) ?? []))
  routeDiagnostics(routes, diagnostics)
  const packageReport = packageEvidence(fileMap, paths, diagnostics)
  reachableDependencyDiagnostics(modules, packageReport, diagnostics)
  const configuration = configurationEvidence(fileMap, paths, diagnostics)
  const stylePaths = paths.filter((path) => !SOURCE_EXTENSION.test(path) || reachablePaths.has(path))
  const styles = inventoryStyles(fileMap, stylePaths)
  const assets: NextSourceAssetEvidence[] = paths.filter((path) => ASSET_EXTENSION.test(path)).map((path) => {
    const file = fileByPath.get(path)!
    return { path, kind: assetKind(path), sizeBytes: file.sizeBytes, sha256: file.sha256 }
  })
  const interactions = inventoryInteractions(
    fileMap,
    modules.map(({ path }) => path),
    diagnostics,
    checkedRequest.value.interactionBindings ?? [],
  )
  const finalDiagnostics: NextSourceDiagnostic[] = sortDiagnostics(diagnostics).map((item) => ({
    ...item,
    policyVersion: NEXT_SOURCE_POLICY_VERSION,
    sourceHashSha256,
    bindingHashSha256,
    destination: checkedRequest.value.destination,
    sourceRevision: checkedRequest.value.provenance.revision ?? null,
  }))
  const routers = new Set(routes.map((route) => route.router))
  const router = routers.size === 2 ? 'mixed' : routers.has('app') ? 'app' : routers.has('pages') ? 'pages' : 'none'

  const report: NextSourceAnalysisReport = {
    schemaVersion: 1,
    analyzerVersion: ANALYZER_VERSION,
    policyVersion: NEXT_SOURCE_POLICY_VERSION,
    destination: checkedRequest.value.destination,
    provenance: checkedRequest.value.provenance,
    sourceHashSha256,
    bindingHashSha256,
    router,
    files,
    routes,
    modules,
    packageEvidence: packageReport,
    configurationEvidence: configuration,
    styles,
    assets,
    interactions,
    diagnostics: finalDiagnostics,
    importedCodeExecuted: false,
    blocking: finalDiagnostics.some((item) => item.severity === 'blocking'),
  }
  const checkedReport = safeParseValue(NextSourceAnalysisReportSchema, report)
  if (!checkedReport.ok) throw new Error('Next.js source analyzer produced an invalid report.')
  return report
}
