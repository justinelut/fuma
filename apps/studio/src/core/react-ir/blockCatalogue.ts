/**
 * The shipped block set.
 *
 * Built from the components a generated site actually receives (task 71's tenant set) plus bare
 * elements for structure. Task 61 established that structure is right as bare elements - wrapping a
 * `section` in a component adds indirection the canvas cannot style - so a block is a small tree of
 * elements holding shadcn components where there is something to configure.
 *
 * VARIANTS ARE SEPARATE BLOCKS, following task 89: a block is copied on insert, so there is no live
 * definition for a prop to switch on. The cost is that fixing one variant does not reach its siblings,
 * which is the cost task 89 already accepted.
 */
import type { BlockDefinition } from './blockLibrary'
import type { ReactIrNode } from './nodes'

/** An element node with Tailwind class tokens. */
function el(
  id: string,
  tag: string,
  classTokens: readonly string[],
  children: readonly string[] = [],
): ReactIrNode {
  return { id, kind: 'element', tag, attributes: {}, classTokens: [...classTokens], children: [...children] } as ReactIrNode
}

/** A text node. */
function text(id: string, value: string): ReactIrNode {
  return { id, kind: 'text', value, children: [] } as ReactIrNode
}

/** A component node naming one of the tenant's own shadcn files. */
function cmp(
  id: string,
  symbol: string,
  file: string,
  children: readonly string[] = [],
): ReactIrNode {
  return {
    id,
    kind: 'component',
    component: { id: `ui.${file}`, symbol, source: `@/components/ui/${file}` },
    children: [...children],
  } as ReactIrNode
}

function nodesOf(...list: readonly ReactIrNode[]): Record<string, ReactIrNode> {
  const map: Record<string, ReactIrNode> = {}
  for (const node of list) map[node.id] = node
  return map
}

/**
 * Hero, centred.
 *
 * The call to action is a Button rather than a styled anchor, so its variant and size are the canvas
 * controls task 72 derives - a hand-styled link offers nothing to configure.
 */
const HERO_CENTRED: BlockDefinition = {
  id: 'hero.centred',
  name: 'Hero — centred',
  category: 'hero',
  description: 'A centred headline, supporting line and one call to action. For a landing page whose single next step is obvious.',
  variantOf: null,
  rootId: 'hero-root',
  subtree: nodesOf(
    el('hero-root', 'section', ['py-24', 'px-6', 'text-center'], ['hero-title', 'hero-copy', 'hero-cta']),
    el('hero-title', 'h1', ['text-4xl', 'sm:text-6xl', 'font-semibold', 'tracking-tight'], ['hero-title-text']),
    text('hero-title-text', 'A headline worth the visit'),
    el('hero-copy', 'p', ['mt-6', 'text-lg', 'text-muted-foreground', 'max-w-2xl', 'mx-auto'], ['hero-copy-text']),
    text('hero-copy-text', 'One or two lines saying what this is and who it is for.'),
    el('hero-cta', 'div', ['mt-10', 'flex', 'gap-3', 'justify-center'], ['hero-button']),
    cmp('hero-button', 'Button', 'button', ['hero-button-text']),
    text('hero-button-text', 'Get started'),
  ),
}

/**
 * Hero, split.
 *
 * A variant rather than a prop on the centred one: the two differ in their TREE (a media column beside
 * the copy), and expressing that as a prop would mean one block carrying both layouts and a flag.
 */
const HERO_SPLIT: BlockDefinition = {
  id: 'hero.split',
  name: 'Hero — split',
  category: 'hero',
  description: 'Copy on one side, room for an image on the other. For a product whose appearance is part of the argument.',
  variantOf: 'hero.centred',
  rootId: 'split-root',
  subtree: nodesOf(
    el('split-root', 'section', ['py-24', 'px-6', 'grid', 'gap-12', 'lg:grid-cols-2', 'lg:items-center'], ['split-copy-col', 'split-media']),
    el('split-copy-col', 'div', [], ['split-title', 'split-copy', 'split-cta']),
    el('split-title', 'h1', ['text-4xl', 'sm:text-5xl', 'font-semibold', 'tracking-tight'], ['split-title-text']),
    text('split-title-text', 'A headline worth the visit'),
    el('split-copy', 'p', ['mt-6', 'text-lg', 'text-muted-foreground'], ['split-copy-text']),
    text('split-copy-text', 'One or two lines saying what this is and who it is for.'),
    el('split-cta', 'div', ['mt-8', 'flex', 'gap-3'], ['split-button']),
    cmp('split-button', 'Button', 'button', ['split-button-text']),
    text('split-button-text', 'Get started'),
    el('split-media', 'div', ['aspect-video', 'rounded-lg', 'bg-muted'], []),
  ),
}

/** Three cards. Card is in the tenant set and carries the panel styling, so the block does not restate it. */
const FEATURES_THREE: BlockDefinition = {
  id: 'features.three',
  name: 'Features — three cards',
  category: 'features',
  description: 'Three side-by-side cards. For the three things somebody should know before deciding.',
  variantOf: null,
  rootId: 'features-root',
  subtree: nodesOf(
    el('features-root', 'section', ['py-20', 'px-6'], ['features-heading', 'features-grid']),
    el('features-heading', 'h2', ['text-3xl', 'font-semibold', 'tracking-tight', 'text-center'], ['features-heading-text']),
    text('features-heading-text', 'What you get'),
    el('features-grid', 'div', ['mt-12', 'grid', 'gap-6', 'md:grid-cols-3'], ['feature-a', 'feature-b', 'feature-c']),
    ...featureCard('feature-a', 'The first thing'),
    ...featureCard('feature-b', 'The second thing'),
    ...featureCard('feature-c', 'The third thing'),
  ),
}

/** One card, built from Card and its parts so the block composes rather than restyling a div. */
function featureCard(prefix: string, title: string): readonly ReactIrNode[] {
  return [
    cmp(prefix, 'Card', 'card', [`${prefix}-header`, `${prefix}-content`]),
    cmp(`${prefix}-header`, 'CardHeader', 'card', [`${prefix}-title`]),
    cmp(`${prefix}-title`, 'CardTitle', 'card', [`${prefix}-title-text`]),
    text(`${prefix}-title-text`, title),
    cmp(`${prefix}-content`, 'CardContent', 'card', [`${prefix}-body`]),
    el(`${prefix}-body`, 'p', ['text-sm', 'text-muted-foreground'], [`${prefix}-body-text`]),
    text(`${prefix}-body-text`, 'A sentence saying what it does and why it matters.'),
  ]
}

/** A call to action with two buttons, the second secondary so the pair reads as a choice. */
const CTA_BANNER: BlockDefinition = {
  id: 'cta.banner',
  name: 'Call to action — banner',
  category: 'call-to-action',
  description: 'A closing prompt with a primary and a secondary action. For the end of a page, where somebody has decided or has a question.',
  variantOf: null,
  rootId: 'cta-root',
  subtree: nodesOf(
    el('cta-root', 'section', ['py-20', 'px-6', 'text-center', 'bg-muted', 'rounded-lg'], ['cta-title', 'cta-actions']),
    el('cta-title', 'h2', ['text-3xl', 'font-semibold', 'tracking-tight'], ['cta-title-text']),
    text('cta-title-text', 'Ready when you are'),
    el('cta-actions', 'div', ['mt-8', 'flex', 'gap-3', 'justify-center', 'flex-wrap'], ['cta-primary', 'cta-secondary']),
    cmp('cta-primary', 'Button', 'button', ['cta-primary-text']),
    text('cta-primary-text', 'Get started'),
    cmp('cta-secondary', 'Button', 'button', ['cta-secondary-text']),
    text('cta-secondary-text', 'Talk to us'),
  ),
}

/** A quote. Avatar is in the tenant set, so the attribution is composed rather than a styled circle. */
const TESTIMONIAL_QUOTE: BlockDefinition = {
  id: 'testimonial.quote',
  name: 'Testimonial — single quote',
  category: 'testimonial',
  description: 'One quote with an attribution. For a claim that carries more weight in somebody else&apos;s words.',
  variantOf: null,
  rootId: 'quote-root',
  subtree: nodesOf(
    el('quote-root', 'section', ['py-20', 'px-6', 'max-w-3xl', 'mx-auto', 'text-center'], ['quote-body', 'quote-attribution']),
    // A blockquote rather than a div, because the meaning is part of the markup.
    el('quote-body', 'blockquote', ['text-2xl', 'font-medium', 'leading-relaxed'], ['quote-body-text']),
    text('quote-body-text', 'A sentence in their words about what changed.'),
    el('quote-attribution', 'div', ['mt-8', 'flex', 'items-center', 'gap-3', 'justify-center'], ['quote-avatar', 'quote-name']),
    cmp('quote-avatar', 'Avatar', 'avatar', []),
    el('quote-name', 'p', ['text-sm', 'text-muted-foreground'], ['quote-name-text']),
    text('quote-name-text', 'Their name, their role'),
  ),
}

/** Pricing, using Badge to mark the recommended tier rather than a hand-styled pill. */
const PRICING_TIERS: BlockDefinition = {
  id: 'pricing.tiers',
  name: 'Pricing — two tiers',
  category: 'pricing',
  description: 'Two tiers with one marked recommended. For a choice between a starting point and the full thing.',
  variantOf: null,
  rootId: 'pricing-root',
  subtree: nodesOf(
    el('pricing-root', 'section', ['py-20', 'px-6'], ['pricing-heading', 'pricing-grid']),
    el('pricing-heading', 'h2', ['text-3xl', 'font-semibold', 'tracking-tight', 'text-center'], ['pricing-heading-text']),
    text('pricing-heading-text', 'Pricing'),
    el('pricing-grid', 'div', ['mt-12', 'grid', 'gap-6', 'md:grid-cols-2', 'max-w-4xl', 'mx-auto'], ['tier-free', 'tier-paid']),
    ...tier('tier-free', 'Starter', false),
    ...tier('tier-paid', 'Studio', true),
  ),
}

function tier(prefix: string, name: string, recommended: boolean): readonly ReactIrNode[] {
  const headerChildren = recommended
    ? [`${prefix}-title`, `${prefix}-badge`]
    : [`${prefix}-title`]
  const nodes: ReactIrNode[] = [
    cmp(prefix, 'Card', 'card', [`${prefix}-header`, `${prefix}-content`]),
    cmp(`${prefix}-header`, 'CardHeader', 'card', headerChildren),
    cmp(`${prefix}-title`, 'CardTitle', 'card', [`${prefix}-title-text`]),
    text(`${prefix}-title-text`, name),
    cmp(`${prefix}-content`, 'CardContent', 'card', [`${prefix}-price`, `${prefix}-cta`]),
    el(`${prefix}-price`, 'p', ['text-3xl', 'font-semibold'], [`${prefix}-price-text`]),
    text(`${prefix}-price-text`, 'Your price'),
    cmp(`${prefix}-cta`, 'Button', 'button', [`${prefix}-cta-text`]),
    text(`${prefix}-cta-text`, 'Choose'),
  ]
  if (recommended) {
    nodes.push(cmp(`${prefix}-badge`, 'Badge', 'badge', [`${prefix}-badge-text`]))
    nodes.push(text(`${prefix}-badge-text`, 'Recommended'))
  }
  return nodes
}

/**
 * The shipped set.
 *
 * Deliberately small. Every block is one somebody has to read past in the picker, and a library of
 * forty near-identical heroes makes choosing harder than building - so this covers the sections a page
 * genuinely repeats and leaves the rest to be saved from real work.
 */
export const BLOCK_CATALOGUE: readonly BlockDefinition[] = Object.freeze([
  HERO_CENTRED,
  HERO_SPLIT,
  FEATURES_THREE,
  CTA_BANNER,
  TESTIMONIAL_QUOTE,
  PRICING_TIERS,
])

/** Blocks grouped for the picker, in the order a page is usually built. */
export const BLOCK_CATEGORY_ORDER: readonly BlockDefinition['category'][] = Object.freeze([
  'hero',
  'features',
  'testimonial',
  'pricing',
  'call-to-action',
  'contact',
  'footer',
])

export function blocksInCategory(category: BlockDefinition['category']): readonly BlockDefinition[] {
  return Object.freeze(BLOCK_CATALOGUE.filter((b) => b.category === category))
}
