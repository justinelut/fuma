/**
 * The shared-document bug must not spread while it is being fixed.
 *
 * `SELF_HOST_SITE_ID` (`'default'`) is the historical composition scope for a self-hosted
 * install, which has one site. Used in a hosted deployment it means every site reads and writes
 * ONE CMS document, so editing one site overwrites another and nothing reports a conflict —
 * both writes are valid writes to the same row.
 *
 * Converting every call site is mechanical but touches publish, import, export, setup, plugins
 * and the MCP tools. While that proceeds, this gate holds the line: the list of files allowed to
 * name the legacy constant is a RATCHET. It may shrink as conversion proceeds; a new entry
 * fails the test. That is the difference between a bug being paid down and a bug spreading.
 */

import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SERVER_ROOT = join(import.meta.dir, '../../../server')

/**
 * Files that may still name the legacy constant, with why.
 *
 * ONLY REMOVE FROM THIS LIST. Each removal is a call site converted to the resolver.
 */
const LEGACY_SCOPE_ALLOWED = Object.freeze<Readonly<Record<string, string>>>({
  'selfHost.ts':
    'Declares the constant. This is the one place the historical value is defined.',
  'router.ts':
    'Setup redirect for a self-hosted install, which genuinely has one site.',
  'handlers/cms/setup.ts':
    'First-run setup of a self-hosted install, before any tenant scope exists.',
  'ai/mcp/tools/publishTool.ts':
    'Names the legacy scope EXPLICITLY at the call site. MCP carries scope on the session rather '
    + 'than a URL, so the gap is made visible here instead of hidden behind a default.',
  'ai/mcp/tools/documentTools.ts':
    'Names the legacy scope EXPLICITLY at the call site, for the same reason as publishTool: the '
    + 'MCP session is the scope source and that plumbing is not built yet.',
  'ai/mcp/tools/contextTool.ts':
    'MCP reads site context. Scope must come from the MCP session rather than a URL, so this '
    + 'conversion differs from the HTTP handlers.',
  'ai/mcp/tools/styleTools.ts':
    'MCP reads and writes design tokens, so an agent could restyle a site it was not pointed at.',
})

function walk(directory: string, prefix = ''): readonly string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry)
    const relative = prefix === '' ? entry : `${prefix}/${entry}`
    if (statSync(absolute).isDirectory()) {
      found.push(...walk(absolute, relative))
      continue
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue
    found.push(relative)
  }
  return found
}

/**
 * Files whose CODE names the constant.
 *
 * Comment mentions are excluded deliberately: a file that explains the migration is documenting
 * the problem, not participating in it, and counting those would push authors towards silence.
 */
function filesNamingLegacyScope(): readonly string[] {
  return walk(SERVER_ROOT).filter((relative) => {
    const source = readFileSync(join(SERVER_ROOT, relative), 'utf8')
    return source
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim()
        return !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/*')
      })
      .some((line) => line.includes('SELF_HOST_SITE_ID'))
  })
}

describe('the legacy self-host scope does not spread', () => {
  it('is named only by files that are known and justified', () => {
    const unexpected = filesNamingLegacyScope()
      .filter((relative) => !(relative in LEGACY_SCOPE_ALLOWED))
    expect(unexpected).toEqual([])
  })

  it('has a reason recorded for every allowed file', () => {
    // A call site nobody can justify is one nobody can safely convert either.
    for (const [file, reason] of Object.entries(LEGACY_SCOPE_ALLOWED)) {
      expect(reason.length).toBeGreaterThan(20)
      expect(file.endsWith('.ts')).toBe(true)
    }
  })

  it('lists no file that has already been converted', () => {
    // Otherwise the ratchet stops ratcheting: a stale entry silently re-permits a call site.
    const naming = new Set(filesNamingLegacyScope())
    const stale = Object.keys(LEGACY_SCOPE_ALLOWED).filter((file) => !naming.has(file))
    expect(stale).toEqual([])
  })
})

describe('the replacement seam exists and cannot fall back', () => {
  const scopeSource = readFileSync(
    join(SERVER_ROOT, 'fuma/editor/siteDocumentScope.ts'), 'utf8',
  )
  const resolverSource = readFileSync(
    join(SERVER_ROOT, 'fuma/editor/siteDocumentResolver.ts'), 'utf8',
  )

  it('does not import the legacy constant', () => {
    // It re-declares the value deliberately, so importing it would tie the fix to the thing it
    // replaces and make the constant look load-bearing in new code.
    expect(scopeSource).not.toContain("from '../../selfHost'")
    expect(resolverSource).not.toContain('selfHost')
  })

  it('refuses rather than defaulting, in hosted mode', () => {
    // The presence of these refusal reasons is what makes a fallback impossible to add quietly.
    for (const reason of ['missing-scope', 'unauthorized-scope', 'reserved-site-id']) {
      expect(scopeSource).toContain(reason)
    }
  })

  it('states why a fallback would be worse than the bug', () => {
    expect(scopeSource.toLowerCase()).toContain('cross-tenant')
  })

  it('keeps authorisation out of the decision module', () => {
    // The decision logic stays testable without a database, and there is exactly one place
    // where "this caller may edit this site" is established.
    expect(scopeSource).not.toContain('DbClient')
    expect(resolverSource).toContain('SiteScopeAuthorizer')
  })
})

describe('the fix is actually activated at the startup root', () => {
  const startup = readFileSync(join(SERVER_ROOT, 'index.ts'), 'utf8')

  it('registers the hosted resolver', () => {
    // Without this registration every converted handler falls back to the legacy document and
    // the whole fix is inert — silently, because nothing errors and every write still succeeds.
    expect(startup).toContain('setHostedSiteDocumentResolver(')
  })

  it('derives the scope from the authorization authority, not the query string', () => {
    // Trusting the query would let any signed-in staff user reach another tenant's design by
    // editing ?siteId=, which is worse than the shared-document bug it replaces.
    const registration = startup.slice(startup.indexOf('setHostedSiteDocumentResolver('))
    expect(registration).toContain('loadExactSiteAuthorization')
  })

  it('treats a missing authorization row as no access', () => {
    const registration = startup.slice(startup.indexOf('setHostedSiteDocumentResolver('))
    expect(registration).toContain('authorization === null ? null : scope')
  })

  it('propagates a refusal as null rather than the legacy document', () => {
    const registration = startup.slice(startup.indexOf('setHostedSiteDocumentResolver('))
    const body = registration.slice(0, registration.indexOf('\n  })'))
    expect(body).toContain('resolution.ok ? resolution.documentId : null')
    expect(body).not.toContain('SELF_HOST_SITE_ID')
  })
})

describe('publish is serialized per site, not process-wide', () => {
  const publishSource = readFileSync(join(SERVER_ROOT, 'publish/publishSite.ts'), 'utf8')
  const stateSource = readFileSync(join(SERVER_ROOT, 'publish/sitePublishState.ts'), 'utf8')

  it('locks on the site rather than the whole process', () => {
    // A process-wide lock makes one tenant's publish wait for every other tenant's, which becomes
    // a hard blocker once publishing runs a per-tenant build.
    expect(publishSource).toContain('withSitePublishLock(')
    expect(publishSource).not.toContain('withPublishLock(')
  })

  it('keys the version by site so one tenant cannot invalidate another cache', () => {
    expect(stateSource).toContain('publishVersionFor')
    expect(stateSource).toContain('new Map<string, number>()')
  })

  it('states why version entries are never evicted', () => {
    // Recreating an evicted entry restarts it at 0, and entries cached at a higher version then
    // compare as newer than current — the site serves retracted content with no way to flush it.
    expect(stateSource).toContain('NEVER GO BACKWARDS')
  })

  it('does not reintroduce a shared mutable version in the per-site module', () => {
    // `let publishVersion = 0` is exactly the shape this module exists to replace.
    expect(stateSource).not.toMatch(/^let\s+publishVersion\s*=/m)
  })
})
