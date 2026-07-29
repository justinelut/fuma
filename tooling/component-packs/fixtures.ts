import {
  hashContract,
  sealComponentPackRelease,
  sha256,
  type ComponentPackRelease,
  type GeneratedClientDraft,
  type GeneratedClientValidation,
  type OwnerArtifactConfirmation,
  type PermissionDisclosure,
  type PromotionEvidence,
} from './contracts'
import { confirmRestrictedClientArtifact, promoteReviewedDistributable, type SiteActorScope } from './lifecycle'

export const NOW = '2026-07-28T16:50:50.161Z'
export const LATER = '2026-07-28T17:00:00.000Z'
export const HASH_A = sha256('fixture-a')
export const HASH_B = sha256('fixture-b')
export const HASH_C = sha256('fixture-c')

export const RESTAURANT_OWNER: SiteActorScope = {
  organizationId: 'org-restaurant', workspaceId: 'workspace-restaurant', siteId: 'site-restaurant',
  ownerKey: 'owner-restaurant', ownerGeneration: 4,
}
export const OTHER_OWNER: SiteActorScope = {
  organizationId: 'org-other', workspaceId: 'workspace-other', siteId: 'site-other',
  ownerKey: 'owner-other', ownerGeneration: 1,
}

export const COMPATIBILITY = {
  registryApiVersion: '1.0.0', minimumRuntimeVersion: '1.0.0', maximumRuntimeVersion: '1.9.9', canonicalTreeVersion: 1,
} as const

const menuProps = [
  { name: 'heading', label: 'Heading', required: true, type: 'string' as const, defaultValue: 'Our menu' },
  { name: 'layout', label: 'Layout', required: true, type: 'enum' as const, values: ['cards', 'list'], defaultValue: 'cards' },
]
const menuSlots = [{ name: 'items', label: 'Menu items', required: true, accepts: ['component' as const], maxItems: 100 }]

export function privateRestaurantRelease(version = '1.0.0', source: 'private-site-created' | 'ai-created' | 'designer-created' = 'private-site-created'): Readonly<ComponentPackRelease> {
  const componentId = source === 'ai-created' ? 'ai-specials' : source === 'designer-created' ? 'designer-menu' : 'visual-menu'
  return sealComponentPackRelease({
    manifest: {
      schemaVersion: 1, namespace: 'restaurant.owner', packId: componentId, exactVersion: version,
      displayName: source === 'ai-created' ? 'AI Daily Specials' : 'Visual Restaurant Menu', source,
      trustTier: 'private-declarative', owner: { kind: 'site', ...RESTAURANT_OWNER },
      capabilities: ['declarative.composition', 'declarative.loops', 'declarative.conditions', 'declarative.bindings', 'declarative.styles', 'declarative.tokens', 'declarative.responsive', 'declarative.animations', 'declarative.interactions'],
      permissions: [], dependencies: [],
      compatibility: COMPATIBILITY, distribution: { state: 'private', reviewId: null }, createdAt: NOW,
    },
    payload: {
      kind: 'declarative',
      components: [{
        componentId, displayName: source === 'ai-created' ? 'AI Daily Specials' : 'Visual Restaurant Menu', description: 'A responsive, data-ready restaurant menu.',
        props: menuProps, slots: menuSlots,
        variants: [{ id: 'featured', label: 'Featured cards', propOverrides: { layout: 'cards' } }],
        tree: {
          rootNodeId: 'menu-root',
          nodes: {
            'menu-root': {
              id: 'menu-root', kind: 'element', children: ['menu-loop'], props: { element: 'section' }, classes: ['restaurant-menu'],
              styles: { display: 'grid' }, tokens: { gap: 'spacing.lg', surface: 'color.surface' },
              responsiveRules: [{ breakpoint: 'mobile', styles: { gridTemplateColumns: '1fr' } }],
              animation: { preset: 'fade-up', durationMs: 300, reducedMotion: 'disable-or-simplify' },
              interaction: { trigger: 'focus', action: 'set-local-state', target: 'focused-item' },
            },
            'menu-loop': {
              id: 'menu-loop', kind: 'loop', children: ['menu-condition'], props: {}, classes: [], styles: {}, tokens: {}, responsiveRules: [],
              binding: { source: 'restaurant.menu.read', path: 'items' }, loop: { source: 'restaurant.menu.read', itemName: 'menuitem', limit: 100 },
            },
            'menu-condition': {
              id: 'menu-condition', kind: 'condition', children: [], props: { text: '{{menuitem.name}}' }, classes: ['menu-item'], styles: {}, tokens: {}, responsiveRules: [],
              condition: { binding: 'menuitem.available', operator: 'truthy' },
              interaction: { trigger: 'click', action: 'toggle', target: 'menuitem-details' },
            },
          },
        },
        propsSchemaHashSha256: hashContract(menuProps), slotsSchemaHashSha256: hashContract(menuSlots),
      }],
    },
  })
}

export function restaurantClientDraft(sourceTsx = "import React from 'react'; export function MenuClient(){ return <button className=\"rounded-lg bg-[var(--color-brand)] p-4 motion-reduce:transition-none\">Reserve</button> }"): GeneratedClientDraft {
  return {
    draftId: 'restaurant-client-draft', owner: { kind: 'site', ...RESTAURANT_OWNER }, namespace: 'restaurant.owner', packId: 'client-menu', componentId: 'reservation-button',
    targetVersion: '1.0.0', source: 'ai-created', sourceTsx, tailwindCss: '.reservation-shell { container-type: inline-size; }', props: menuProps, slots: [],
    requestedPermissions: [{ id: 'booking.create', authority: 'typed-bun-api', purpose: 'Submit a reservation through the typed Fuma booking API.', required: true }],
    exactDependencies: [], state: 'isolated-draft',
  }
}

export function passingValidation(draft: GeneratedClientDraft): GeneratedClientValidation {
  const js = Buffer.from('compiled restricted restaurant client', 'utf8').toString('base64')
  const css = Buffer.from('.rounded-lg{border-radius:.5rem}', 'utf8').toString('base64')
  const check = (name: string) => ({ passed: true, evidenceSha256: sha256(`evidence:${name}`), detail: `${name} passed in the isolated build boundary.` })
  return {
    draftId: draft.draftId, sourceHashSha256: sha256(draft.sourceTsx),
    checks: { staticSource: check('staticSource'), typeScript: check('typeScript'), build: check('build'), staticTailwind: check('staticTailwind'), accessibility: check('accessibility'), security: check('security'), csp: check('csp'), network: check('network'), dependencies: check('dependencies'), budget: check('budget') },
    budgets: { javascriptBytes: Buffer.from(js, 'base64').byteLength, cssBytes: Buffer.from(css, 'base64').byteLength, hydrationNodes: 1 },
    compiledJavaScriptBase64: js, compiledCssBase64: css,
  }
}

export function disclosureFor(draft: GeneratedClientDraft): PermissionDisclosure {
  return { draftId: draft.draftId, permissions: draft.requestedPermissions, dependencyLockSha256: hashContract(draft.exactDependencies), disclosedAt: NOW, disclosedToOwnerKey: RESTAURANT_OWNER.ownerKey }
}
export function confirmationFor(draft: GeneratedClientDraft, disclosure: PermissionDisclosure): OwnerArtifactConfirmation {
  return { draftId: draft.draftId, ownerKey: RESTAURANT_OWNER.ownerKey, ownerGeneration: RESTAURANT_OWNER.ownerGeneration, sourceHashSha256: sha256(draft.sourceTsx), disclosureSha256: hashContract(disclosure), confirmedAt: LATER, confirmation: 'approve-restricted-client-artifact' }
}

export function restrictedRestaurantRelease(): Readonly<ComponentPackRelease> {
  const draft = restaurantClientDraft(); const validation = passingValidation(draft); const disclosure = disclosureFor(draft)
  return confirmRestrictedClientArtifact({ draft, validation, disclosure, confirmation: confirmationFor(draft, disclosure), manifest: { displayName: 'Restaurant Client Menu', dependencies: [], compatibility: COMPATIBILITY, createdAt: LATER } })
}

export const REVIEW_EVIDENCE: PromotionEvidence = {
  reviewId: 'review-restaurant-001', authority: 'fuma-review-authority', provenanceSha256: HASH_A, licenseSpdx: 'MIT',
  dependencyReviewSha256: HASH_B, securityReviewSha256: HASH_C, accessibilityReviewSha256: sha256('a11y'), compatibilityReviewSha256: sha256('compat'),
  signingAuthoritySeam: 'FUMA-068', artifactAuthoritySeam: 'FUMA-067',
}

export function reviewedRestaurantRelease(version = '2.0.0'): Readonly<ComponentPackRelease> {
  return promoteReviewedDistributable({ privateRelease: privateRestaurantRelease('1.0.0'), targetVersion: version, evidence: REVIEW_EVIDENCE, createdAt: LATER })
}

export function upgradedRestaurantRelease(): Readonly<ComponentPackRelease> {
  const base = reviewedRestaurantRelease('2.0.0')
  const component = base.payload.kind === 'declarative' ? base.payload.components[0]! : neverValue()
  const props = [...component.props, { name: 'showprices', label: 'Show prices', required: false, type: 'boolean' as const, defaultValue: true }]
  return sealComponentPackRelease({
    manifest: { ...base.manifest, exactVersion: '2.1.0', permissions: [{ id: 'restaurant.menu.read', authority: 'typed-bun-api', purpose: 'Read published menu data.', required: true }], createdAt: '2026-07-28T18:00:00.000Z' },
    payload: { kind: 'declarative', components: [{ ...component, props, propsSchemaHashSha256: hashContract(props) }] },
  })
}

function neverValue(): never { throw new Error('Unexpected fixture payload kind') }
