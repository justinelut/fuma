# Hosted dashboard design reference

Each product profile gets its own dashboard with its own navigation. A route is a
page: selecting it replaces the content region. Nothing stacks.

Reference images live beside this file and are the source of truth:

- `design/ghost-publication-dashboard.webp` — Publication profile
- `design/dribbble-website-dashboard.png` — Website and Bookings profiles

The Instatic builder is out of scope. A provisioned site keeps the full Instatic
app for design and content authoring; the hosted dashboard never reimplements it.

## Publication profile — Ghost model

Dark, sidebar-led, analytics-first.

**Shell**

- Left sidebar, fixed ~185px, near-black surface, separated by a hairline.
- Sidebar head: circular brand mark, wordmark, search icon.
- Primary items with 16px monoline icons: Dashboard, View site.
- Grouped section `Posts` with a trailing `+` action and indented children:
  Drafts, Scheduled, Published, Free posts, Paid posts, Newsletters. Coloured
  status dots sit right-aligned on the paid/free/newsletter rows.
- Following groups: Pages, Tags, Members (right-aligned count), Offers.
- Footer: avatar with disclosure, settings icon, light/dark toggle.
- Content region: page title at ~30px/600 with a right-aligned range control
  (`Past 30 days`).

**Content blocks, top to bottom**

1. Three KPI cells in one bordered card: label ~12px muted, value ~28px/600,
   delta in green with an arrow glyph.
2. Chart card: metric selector, magenta area chart with vertical gradient fade,
   dashed crosshair plus floating tooltip on hover, date bounds at both bottom
   corners.
3. Three cells: MRR with purple sparkline; subscriptions bar chart with
   New/Canceled legend dots; horizontal stacked mix bar with Monthly/Annual.
4. Engagement row: two percentages with qualifying captions and one absolute
   subscriber count.
5. Table card with tab switcher (`Recent posts`, `Member activity`), uppercase
   ~11px column heads, and inline progress bars in the rate column.

**Palette**

- Surfaces: `#0f0f0f` sidebar, `#151515` cards, `#2a2a2a` borders.
- Text: near-white primary, ~62% white secondary.
- Accents: magenta primary series, purple secondary series, green deltas.
- Radius 6–8px, dense 12–16px rhythm.

## Website and Bookings profiles — Dribbble model

Light, top-navigation, bento cards.

**Shell**

- Rounded application surface (~24px) on a neutral backdrop, warm ivory
  gradient washing from top-left.
- Top bar: outlined brand pill at left; centre pill-group navigation where the
  active item is a solid black pill with white text and the rest are quiet
  labels; right cluster of settings pill, notification circle, avatar circle.
- Greeting headline ~40px/600.
- Metric strip: pill chips mixing solid black, signature yellow, striped
  progress, and outline; right side shows three large counts with small icons
  and captions.

**Bento grid**

- Mixed spans on a 4-column grid, cards at 16–20px radius with soft shadows.
- Card vocabulary observed: media card with overlaid name/role and a value pill;
  metric card with bar chart, highlighted bar, and floating value tooltip;
  circular progress card with transport controls; segmented progress card with a
  nested dark checklist listing icon, title, timestamp, and completion state;
  accordion list with expandable rows and a thumbnail plus overflow menu; week
  calendar with month switcher, weekday columns, hour rows, and event chips in
  both dark and light treatments.

**Palette**

- Surfaces: ivory `#f7f3e8` wash, white cards, near-black `#111` for emphasis.
- Signature yellow `#f5c842` marks the primary series and active progress.
- Generous 20–24px padding, soft shadows, no hard borders.

**Bookings** reuses this shell with booking-specific cards: today's schedule as
the week calendar, utilisation as circular progress, and a service list as the
accordion. It is a separate dashboard with its own navigation, not a tab.

## Navigation contract

- One route renders one page inside the content region.
- Setup guidance is its own route, never appended beneath another page.
- Navigation is driven by the profile registry so Website, Publication, and
  Bookings expose different items rather than one shared list.
