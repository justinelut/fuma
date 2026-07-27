# `@fuma/design-tokens`

Framework-neutral public Fuma design primitives and CSS-variable generation inputs.

## Authority

This dependency-free leaf owns only:

- the public neutral and identity colors already documented in Studio's global token catalog;
- the Inter/system font stacks and a small public subset of the documented fluid type scale;
- a small public subset of the documented fluid spacing scale;
- the documented primitive radius scale; and
- namespaced CSS-variable input for the public Web app.

The values are derived from `apps/studio/src/styles/globals.css` and `docs/reference/design-tokens.md`. The package deliberately does not extract Studio surfaces, borders, semantic states, canvas affordances, shadows, z-indexes, component CSS, or behavior.

## Use

Import the primitive tables directly, or generate the public Web root declarations:

```ts
import { publicWebCssVariables, renderCssVariables } from '@fuma/design-tokens'

const css = renderCssVariables(publicWebCssVariables)
```

The renderer sorts declaration names before emitting CSS, so identical inputs produce byte-stable output regardless of object insertion order.
