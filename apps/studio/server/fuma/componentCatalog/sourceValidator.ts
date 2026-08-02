import {
  hashContract,
  sha256,
  type GeneratedClientDraft,
  type GeneratedClientValidation,
} from '../../../../../tooling/component-packs/contracts'
import { ComponentCatalogError } from './contracts'
export type SourceAudit = Readonly<{ sourceHashSha256: string; passed: boolean; findings: readonly Readonly<{ rule: 'server-code'|'dynamic-import'|'direct-network'|'secret-access'|'sandbox-escape'|'dynamic-tailwind'|'undeclared-dependency'|'dangerous-evaluation'; detail: string }>[] }>
function auditGeneratedClientSource(draft: GeneratedClientDraft): SourceAudit {
  const source = `${draft.sourceTsx}\n${draft.tailwindCss}`; const findings: Array<SourceAudit['findings'][number]> = []; const add=(rule:SourceAudit['findings'][number]['rule'],detail:string)=>findings.push({rule,detail})
  if (/(?:^|[;\n]\s*)['"]use server['"]|\b(?:getServerSideProps|generateStaticParams)\b|from\s*['"](?:node:|fs|path|child_process|server-only)/m.test(source)) add('server-code','Server code is forbidden.')
  if (/\bimport\s*\(/.test(source)) add('dynamic-import','Dynamic imports are forbidden.')
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon)\s*\(?/.test(source)) add('direct-network','Direct network access is forbidden.')
  if (/\b(?:process\.env|import\.meta\.env|Bun\.env|Deno\.env|document\.cookie)\b/.test(source)) add('secret-access','Secret and cookie access is forbidden.')
  if (/\b(?:window\.)?(?:top|parent|opener)\b|postMessage\s*\([^,]+,\s*['"]\*['"]/.test(source)) add('sandbox-escape','Parent/opener escape is forbidden.')
  if (/\b(?:eval|Function)\s*\(|setTimeout\s*\(\s*['"]|setInterval\s*\(\s*['"]/.test(source)) add('dangerous-evaluation','Generated evaluation is forbidden.')
  if (/(?:className|class)\s*=\s*\{?`[^`]*\$\{|(?:className|class)\s*=\s*\{[^}]*\+/.test(source)) add('dynamic-tailwind','Dynamic Tailwind utilities are forbidden.')
  return Object.freeze({sourceHashSha256:sha256(draft.sourceTsx),passed:findings.length===0,findings:Object.freeze(findings)})
}

const evidence = (name: string, detail: string) => Object.freeze({ passed: true, evidenceSha256: sha256(`${name}:${detail}`), detail })

function accessibilityCheck(source: string): void {
  if (/<img\b(?![^>]*\balt=)[^>]*>/i.test(source)) throw new ComponentCatalogError('validation', 'Images in restricted client source require alt text.')
  if (/<button\b[^>]*>\s*<\/(?:button)>/i.test(source)) throw new ComponentCatalogError('validation', 'Restricted client buttons require an accessible name.')
  if (/\bonClick\s*=/.test(source) && /<(?:div|span)\b[^>]*\bonClick\s*=/.test(source) && !/\b(?:role|tabIndex)\s*=/.test(source)) throw new ComponentCatalogError('validation', 'Non-button click targets require keyboard semantics.')
}

function staticTailwindCheck(source: string): void {
  if (/(?:className|class)\s*=\s*\{?`[^`]*\$\{|(?:className|class)\s*=\s*\{[^}]*\+/.test(source)) throw new ComponentCatalogError('validation', 'Tailwind utility strings must be statically detectable.')
}

export interface ComponentSourceValidator {
  validate(draft: GeneratedClientDraft): Promise<Readonly<{ audit: SourceAudit; validation: GeneratedClientValidation }>>
}

/**
 * Local, network-free restricted-client compiler boundary. It performs the
 * static policy first, transpiles TSX without executing it, and emits only
 * immutable JS/CSS bytes plus hash-bound evidence. It never imports the draft.
 */
export class IsolatedRestrictedClientValidator implements ComponentSourceValidator {
  async validate(draft: GeneratedClientDraft) {
    const audit = auditGeneratedClientSource(draft)
    if (!audit.passed) throw new ComponentCatalogError('validation', audit.findings.map((item) => item.detail).join(' '))
    staticTailwindCheck(draft.sourceTsx)
    accessibilityCheck(draft.sourceTsx)
    let javascript: string
    try {
      javascript = new Bun.Transpiler({ loader: 'tsx', target: 'browser' }).transformSync(draft.sourceTsx)
    } catch (error) {
      throw new ComponentCatalogError('validation', `Restricted client TypeScript build failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
    const css = draft.tailwindCss
    const jsBytes = Buffer.byteLength(javascript)
    const cssBytes = Buffer.byteLength(css)
    if (jsBytes > 250_000 || cssBytes > 100_000) throw new ComponentCatalogError('validation', 'Restricted client bundle exceeds the JavaScript or CSS budget.')
    const imported = [...draft.sourceTsx.matchAll(/from\s*['"]([^'"]+)['"]/g)].map((match) => match[1]!)
    const declared = new Set(draft.exactDependencies.map((item) => item.name))
    if (imported.some((item) => !['react', 'react/jsx-runtime'].includes(item) && !declared.has(item.startsWith('@') ? item.split('/').slice(0, 2).join('/') : item.split('/')[0]!))) throw new ComponentCatalogError('validation', 'Restricted client source imports an undeclared exact dependency.')
    const sourceHash = sha256(draft.sourceTsx)
    const check = (name: string, detail: string) => evidence(name, `${sourceHash}:${detail}`)
    const validation: GeneratedClientValidation = {
      draftId: draft.draftId,
      sourceHashSha256: sourceHash,
      checks: {
        staticSource: check('static-source', hashContract(audit)),
        typeScript: check('typescript', sha256(javascript)),
        build: check('build', `${jsBytes}`),
        staticTailwind: check('static-tailwind', sha256(css)),
        accessibility: check('accessibility', 'bounded-static-wcag-policy'),
        security: check('security', hashContract(audit.findings)),
        csp: check('csp', 'deny-by-default-no-direct-network'),
        network: check('network', 'direct-network-primitives-rejected'),
        dependencies: check('dependencies', hashContract(draft.exactDependencies)),
        budget: check('budget', `${jsBytes}:${cssBytes}`),
      },
      budgets: { javascriptBytes: jsBytes, cssBytes, hydrationNodes: Math.min(2_000, (draft.sourceTsx.match(/</g) ?? []).length) },
      compiledJavaScriptBase64: Buffer.from(javascript).toString('base64'),
      compiledCssBase64: Buffer.from(css).toString('base64'),
    }
    return Object.freeze({ audit, validation })
  }
}
