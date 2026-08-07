/**
 * Task 59: plugin ABI v2 and the sandbox boundary.
 *
 * The claim the whole design rests on - that v1's backend is sandboxed while `editor.code` runs
 * unsandboxed in the admin window - is asserted against the shipped declarations.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MIGRATION,
  PRESERVED_FROM_V1,
  TIERS,
  capabilitiesOf,
  requiresAdminPrivilegeToRender,
  reviewBoundary,
} from '../../core/plugin-sdk/abiV2'

const STUDIO = join(import.meta.dir, '..', '..', '..')

describe('what v1 actually is, read from the shipped code', () => {
  it('the backend sandbox really does bound heap, stack and time', () => {
    const limits = readFileSync(join(STUDIO, 'server/plugins/quickjs/limits.ts'), 'utf8')
    expect(limits).toContain('DEFAULT_MEMORY_LIMIT_BYTES')
    expect(limits).toContain('DEFAULT_STACK_SIZE_BYTES')
    expect(limits).toContain('DEFAULT_EVAL_TIMEOUT_MS')
  })

  it('and editor.code really is declared UNSANDBOXED admin-window code', () => {
    // This is the asymmetry the task exists to close, so it is evidenced rather than described.
    const permissions = readFileSync(join(STUDIO, 'src/core/plugin-sdk/types/permissions.ts'), 'utf8')
    expect(permissions).toContain('Unsandboxed admin-window code')
    expect(permissions).toContain('admin API with')
    expect(permissions).toContain("'editor.code',")
  })

  it('the permission itself says every other permission gates only an API surface', () => {
    // Which is what makes the rest of the list advisory for a plugin holding this one.
    const permissions = readFileSync(join(STUDIO, 'src/core/plugin-sdk/types/permissions.ts'), 'utf8')
    expect(permissions).toContain('gates whether the plugin')
  })
})

describe('the three tiers state what each can reach', () => {
  it('the backend sandbox cannot render and cannot act as the admin', () => {
    const backend = capabilitiesOf('backend-sandbox')
    expect(backend.rendersUi).toBe(false)
    expect(backend.actsAsTheAdmin).toBe(false)
    expect(backend.resourceBounded).toBe(true)
  })

  it('the admin window can do both, which is the problem', () => {
    const admin = capabilitiesOf('admin-window')
    expect(admin.rendersUi).toBe(true)
    expect(admin.actsAsTheAdmin).toBe(true)
    expect(admin.readsAdminStorage).toBe(true)
    expect(admin.resourceBounded).toBe(false)
  })

  it('the frame tier separates the two: it renders WITHOUT the admin identity', () => {
    // This separation is the entire content of v2.
    const frame = capabilitiesOf('ui-frame')
    expect(frame.rendersUi).toBe(true)
    expect(frame.actsAsTheAdmin).toBe(false)
    expect(frame.readsAdminStorage).toBe(false)
  })

  it('exactly one tier acts as the admin', () => {
    expect(TIERS.filter((tier) => tier.actsAsTheAdmin)).toHaveLength(1)
  })

  it('an unknown tier throws rather than reporting no capability', () => {
    // Reporting an unknown tier as harmless is how a surface gets admitted by omission.
    expect(() => capabilitiesOf('whatever' as never)).toThrow()
  })
})

describe('the one rule v2 adds', () => {
  it('under v1, rendering requires admin privilege', () => {
    expect(requiresAdminPrivilegeToRender(1)).toBe(true)
  })

  it('under v2 it does not', () => {
    expect(requiresAdminPrivilegeToRender(2)).toBe(false)
  })
})

describe('the boundary review', () => {
  const sound = {
    version: 2 as const,
    tier: 'ui-frame' as const,
    needsUi: true,
    messagesValidated: true,
    ownOrigin: true,
  }

  it('a sound v2 UI surface reports nothing', () => {
    expect(reviewBoundary(sound)).toHaveLength(0)
  })

  it('a UI surface in the backend sandbox is refused, with the real reason', () => {
    const problems = reviewBoundary({ ...sound, tier: 'backend-sandbox' })
    expect(problems.map((p) => p.code)).toContain('cannot-render-here')
    expect(problems[0]!.message).toContain('WASM VM')
  })

  it('the admin window is refused under v2', () => {
    const problems = reviewBoundary({ ...sound, tier: 'admin-window' })
    expect(problems.map((p) => p.code)).toContain('admin-window-under-v2')
  })

  it('and the reason names the consequence: other permissions become advisory', () => {
    const problems = reviewBoundary({ ...sound, tier: 'admin-window' })
    const message = problems.find((p) => p.code === 'admin-window-under-v2')!.message
    expect(message).toContain('advisory')
  })

  it('A SAME-ORIGIN FRAME IS NOT A BOUNDARY, and that is caught', () => {
    // The mistake that looks like isolation and is not: the frame reaches the parent directly.
    const problems = reviewBoundary({ ...sound, ownOrigin: false })
    expect(problems.map((p) => p.code)).toContain('frame-shares-admin-origin')
    expect(problems[0]!.message).toContain('parent document')
  })

  it('unvalidated messages are flagged, because the frame is the untrusted side', () => {
    const problems = reviewBoundary({ ...sound, messagesValidated: false })
    expect(problems.map((p) => p.code)).toContain('messages-unvalidated')
    expect(problems[0]!.message).toContain('moves the privilege back')
  })

  it('the backend sandbox is not asked to validate messages it does not send', () => {
    const problems = reviewBoundary({
      version: 2,
      tier: 'backend-sandbox',
      needsUi: false,
      messagesValidated: false,
      ownOrigin: false,
    })
    expect(problems).toHaveLength(0)
  })

  it('reports every problem rather than stopping at the first', () => {
    const problems = reviewBoundary({ ...sound, ownOrigin: false, messagesValidated: false })
    expect(problems).toHaveLength(2)
  })

  it('v1 in the admin window is NOT flagged, because that is what v1 permits', () => {
    // A review that condemns the version it is not governing would be noise.
    const problems = reviewBoundary({ ...sound, version: 1, tier: 'admin-window' })
    expect(problems).toHaveLength(0)
  })
})

describe('what v2 preserves without change', () => {
  it('the backend sandbox, unchanged', () => {
    expect(PRESERVED_FROM_V1.backendSandbox).toContain('QuickJS-WASM')
  })

  it('network only by grant, one host at a time', () => {
    expect(PRESERVED_FROM_V1.networkByGrant).toContain('one host at a time')
  })

  it('and the reason states these are already enforced rather than documented', () => {
    // Re-deciding the part of v1 that was right is the commonest way a version bump regresses.
    expect(PRESERVED_FROM_V1.reason).toContain('enforced rather than documented')
  })

  it('the permission list really does describe the network grant that way', () => {
    const permissions = readFileSync(join(STUDIO, 'src/core/plugin-sdk/types/permissions.ts'), 'utf8')
    expect(permissions.toLowerCase()).toContain('network')
  })
})

describe('the migration is sequenced rather than declared', () => {
  it('editor.code cannot be removed yet, and the reason is capability not caution', () => {
    expect(MIGRATION.permission).toBe('editor.code')
    expect(MIGRATION.cannotBeRemovedYet).toContain('no other tier that can render')
  })

  it('the frame tier is proven BY USE before the permission is deprecated', () => {
    // A tier proven only by design is one whose gaps are found by the first author to try it.
    expect(MIGRATION.sequence[1]).toContain('Rebuild one real editor extension')
    expect(MIGRATION.sequence[1]).toContain('proven by use')
  })

  it('deprecation comes before retirement', () => {
    const deprecate = MIGRATION.sequence.findIndex((step) => step.includes('deprecated'))
    const retire = MIGRATION.sequence.findIndex((step) => step.includes('Retire'))
    expect(deprecate).toBeGreaterThan(-1)
    expect(retire).toBeGreaterThan(deprecate)
  })

  it('and the cost of moving sooner is stated', () => {
    expect(MIGRATION.whyNotSooner).toContain('capability gap')
  })
})
