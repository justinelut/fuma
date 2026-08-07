# Blocks, Layouts and Templates

Three names that were colliding, and one design question about what a Block actually
is. Recorded here because the answers shape the marketplace, the component library
and what an author can expect when they insert something.

## Blocks are saved node subtrees, not props-only components

A Block — a hero, a pricing table, a footer — is stored as a **subtree of React IR
nodes** that is copied into the page on insert. It is not a component with a fixed
props interface.

The alternative was tempting: make every Block a component, so a change to the Block
updates every page using it. It was rejected because it makes the common case
impossible. Somebody who inserts a hero and then wants the heading below the image,
or a third button, or the eyebrow text removed, is doing something completely
ordinary. A props-only Block either forbids that or grows a prop for every
conceivable variation until the props interface is the page.

So insertion is a copy, and rearranging afterwards is expected rather than a
violation.

### What this costs, stated plainly

**Blocks do not update retroactively.** Improving the shipped hero does not change a
site that already inserted it. That is a real loss and worth being honest about
rather than discovering later.

### Where consistency actually comes from

Not from the Block. From the **components inside it**. A Block is composed of shadcn
components and the site's own code components, and those *are* centrally updatable.
Change the Button and every Block containing one follows.

This is the right division: the Block decides arrangement, which is exactly what an
author should be free to change, and the components decide appearance and behaviour,
which is what should stay consistent.

## Page layouts are Layouts, not Templates

The word `Templates` was doing two jobs:

1. The shared chrome a page renders inside — header, footer, an outlet for content.
2. A sellable artifact: a whole designed site somebody buys.

Those are unrelated, and one word for both makes every conversation about the
marketplace ambiguous.

**Page-layout `Templates` are renamed `Layouts`.** This matches Next's own vocabulary
— `layout.tsx` is precisely this concept — so the builder and the generated code now
use one word for one thing. Under the React engine a Layout *is* a `layout.tsx`
module with an outlet, which makes the rename a correction rather than a preference.

`Templates` is freed for the sellable artifact.

## Marketplace sequencing

Export and import first; selling after payment lands.

The reason is ordering, not appetite. A template that cannot be reliably exported and
re-imported into a different site is not sellable at any price — the first buyer
whose import half-works is a support problem and a refund. Export/import is also
independently useful: it covers moving a design between one's own sites, and
duplicating a site as a starting point.

Payment infrastructure (tasks 66–68) has to be trustworthy before money moves through
it, so licensing and payouts wait on that rather than being built speculatively
alongside.

## Consequences for the engine

- A Block is serialised as a node map plus a root id, which is exactly what
  `insertNodes` already accepts — so inserting a Block is one operation and therefore
  one undo step.
- Inserted node ids must be freshly generated. `insertNodes` refuses colliding ids
  rather than renaming them, because renaming would break the references the subtree
  makes to its own children.
- A Layout is a module of kind `layout` containing an `outlet` node. The generator
  already emits `children?: ReactNode` when an outlet is present.
- A Template, once it exists, is a set of modules plus theme tokens plus content —
  not a single artifact — so its format is a manifest rather than a file.
