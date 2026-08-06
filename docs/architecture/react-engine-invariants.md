# React engine invariants

The rules the visual builder's React conversion is built on. Each is enforced by
`apps/studio/src/__tests__/architecture/react-engine-invariants.test.ts` where it
is mechanically checkable, and stated here where it is a design commitment that
only becomes testable once the code it governs exists.

Changing an invariant means changing this document and its gate in the same
commit. A gate that no longer matches this list is a bug in one of them.

## Invariant 1 — no HTML string authoring

No authoring path emits or accepts HTML strings. The canonical representation is
a React node tree; the canonical serialisation is typed TSX. This replaces
`ModuleDefinition.render(props, renderedChildren) => { html }`, the
`site_insert_html` and `site_replace_node_html` agent tools, and HTML read-back
through the publisher.

The legacy publisher and legacy plugin modules keep emitting HTML during
migration. They are explicitly labelled legacy and are not an authoring path.

## Invariant 2 — Tailwind is the only styling vocabulary

Styling is Tailwind utility classes. There is no hand-authored CSS in an
authoring path and no second bespoke variable system to maintain.

**Honest exception.** Tailwind v4's `@theme` compiles design tokens *to* CSS
custom properties — that is its mechanism, not a workaround. "No CSS variables"
therefore means no hand-edited variable system, not zero custom properties in the
output. Core Framework continues to generate token values and emits them as
Tailwind theme namespaces.

**Named escape hatch.** Ambient selector rules, `@keyframes`, `@font-face`,
resets and user stylesheets cannot be expressed as node class tokens. They live
in an explicitly labelled CSS lane, not smuggled into class strings.

## Invariant 3 — canonical page source is typed TSX

Generated source is TypeScript with a props interface, deterministic formatting,
and stable editor identifiers preserved as source anchors plus a sidecar map from
node id to AST span. Deterministic output is what makes diffs reviewable and
round-trip possible.

## Invariant 4 — arbitrary developer code is opaque, never guessed at

The builder reads back a documented subset of TSX. Anything outside it is
preserved as an opaque code node: renderable, selectable, movable, with a typed
prop surface, and never internally reverse-engineered.

This is the Framer contract. React is Turing-complete, so a total inverse from
arbitrary source to an editable tree does not exist. Claiming otherwise would be
false, so the product states the boundary instead.

## Invariant 5 — one animation library

Motion is the animation library. Its declarative surface — `initial`, `animate`,
`exit`, `transition`, `variants`, and the `while*` gesture props — is stored as
data, which is what lets the canvas edit it and the generator emit it.

Motion+ components (`AnimateNumber`, `Carousel`, `Cursor`, `ScrambleText`,
`Ticker`, `Typewriter`) are paid. Nothing may depend on them.

## Invariant 6 — one validation library per side of the boundary

Fuma's own code validates with TypeBox at every untyped boundary. Generated
tenant site code validates with Zod, which is what pairs with the shadcn form
primitive and what the model writes most reliably.

These must not mix. Zod does not belong in `apps/studio`; TypeBox does not belong
in generated site forms. `FUMA-032` already fails Studio for carrying a second
validation library, and it is correct to do so.

## Invariant 7 — one icon library

Lucide, which is what shadcn ships and is designed around. Pinned to one version
across the monorepo. Pixelarticons remains the existing builder chrome set; the
two never mix inside one surface.
