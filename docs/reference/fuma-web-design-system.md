# Fuma public web — measured design system

Every value here was **measured from a live reference site**, not chosen by eye. Measurements
taken at 1440×900 via computed styles. This file is the single source of truth for the public
marketing site; if a component disagrees with this document, the component is wrong.

## Reference measurements (1440px viewport)

| Site | Background | h1 px / lh / weight / tracking | h2 px / lh / weight | Body px / lh | Container | Section gap | Page height |
|---|---|---|---|---|---|---|---|
| framer.com | `rgb(0,0,0)` | 54 / 1.0 / 500 / −0.04em | 44 / 1.1 / 500 | 18 / 1.35 | 1200 | 819–3117 | 10851 |
| vercel.com | `rgb(250,250,250)` | 64 / 1.0 / 400 / −0.06em | 56 / 1.0 / 450 | 16 / 1.5 | 1448 | 826–929 | 5389 |
| linear.app | `rgb(8,9,10)` | 64 / 1.0 / 510 / −0.022em | 48 / 1.0 / 510 | 15 / 1.6 | 1436 | 1078–1234 | 10898 |
| supabase.com | light | 46 / 1.0 / 500 | — | 16 / 1.5 | 1280 | — | 7691 |
| resend.com | `rgb(0,0,0)` | 96 / 1.0 / 400 / −0.01em | 56 / 1.2 / 400 | 18 / 1.5 | 1280 | 523–1172 | 12272 |

### What the data says

- **Line-height 1.0 on display type is universal.** All five sites.
- **Display weight is 400–510, never 600+.** Heavy display type is the clearest amateur tell.
- **Body copy is 15–18px at 1.5–1.6 line-height** in a muted grey, never full-contrast white.
- **Containers cluster at 1200–1280px**; the two outliers use full-bleed grids inside.
- **Sections are 800–1200px apart.** Generous vertical rhythm is what makes these pages feel
  considered. Tight stacking is the second-clearest amateur tell.
- **Dark-site pages run 10,800–12,300px** with 10–14 substantial sections.

## Fuma tokens (derived)

```
Ground          #000000              pure black, matching the dark references
Raised panel    #0a0a0a
Inset surface   rgba(255,255,255,0.06)
Hairline        rgba(255,255,255,0.12)
Text            #ffffff
Muted text      rgba(255,255,255,0.62)
Signal          #3f6bff              electric blue; ALL interaction and emphasis
Signal bright   #6f92ff              glow and hover
Live            #8ef2c6              mint; published/live STATE only, never decorative
```

```
display-xl   clamp(2.875rem, 5.6vw, 4.75rem)  lh 1.0   weight 500   tracking −0.022em
display-lg   clamp(2rem, 3.4vw, 3rem)        lh 1.05  weight 500   tracking −0.022em
display-md   clamp(1.5rem, 2.2vw, 1.875rem)  lh 1.15  weight 500   tracking −0.02em
lede         1.125rem                        lh 1.55  weight 400   muted
body         1rem                            lh 1.6   weight 400
small        0.875rem                        lh 1.55
mono         0.8125rem                       lh 1.7
eyebrow      0.75rem  uppercase  tracking 0.14em  mono
```

```
Container       max-width 1280px, gutter 1rem mobile / 2rem desktop
Section padding mobile 3.5rem / desktop 5rem on each section edge. Adjacent sections therefore
                produce an effective 7rem mobile / 10rem desktop rhythm before content height.
Spacing base    8px scale
Radius          8px controls, 12px panels, 16px large surfaces
Button visual   h 2.125rem (34px) from 640px upward, padding-x 0.875rem (14px), radius 8px,
                weight 500. Mobile controls and links acting as buttons retain a 44px hit area.
```

## Typeface

The references use licensed faces (GT Walsheim, Geist, Domaine). Fuma uses freely licensed
substitutes: **Plus Jakarta Sans** for display, **Inter** for body, **JetBrains Mono** for code
and data. This is a deliberate substitution, not a match.

## Forbidden patterns

Checked before any section ships:

- No display type at weight 600 or heavier.
- No gradient buttons, gradient text, or gradient hero washes.
- No emoji as iconography.
- No drop-shadow card grids; use hairlines, or bloom on the single signature panel only.
- No `01 / 02 / 03` numbering unless the content is genuinely sequential.
- No section titled "Features", "Services" or "Why choose us" — name what it does.
- No invented metrics, uptime figures, performance scores, customer counts or star ratings.
- No customer names or logos we do not have written permission to show.
- No competitor product names; refer to vendor categories.
- No fabricated HTML mockups standing in for product UI — use real screenshots of the running
  Studio, or a generated asset, and label it.
- Mint is reserved for published/live state.

## Product imagery rule

Marketing imagery must come from the **real running Instatic Studio**, captured at 2× and
cropped to the relevant area, stored under `apps/web/public/product/`. Where a real capture is
impossible, use a clearly labelled generated asset. Hand-built HTML imitations of product UI
are not permitted — they are the single largest source of the templated look.
