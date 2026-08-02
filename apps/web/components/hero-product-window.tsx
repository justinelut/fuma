/**
 * Hero artifact — the page's signature.
 *
 * Fuma's real differentiator is that published output stays readable: semantic HTML and
 * compact CSS with none of the editor's machinery in the page. So the hero shows that claim
 * being kept — the rendered page beside the markup it emitted. A generic app screenshot could
 * belong to any builder; this diptych only works for a product whose output is genuinely clean.
 *
 * Atmosphere: one blue bloom behind one rim-lit panel. The boldness is spent here, so
 * everything around it stays quiet.
 *
 * Honesty: sample site content only. No customer data, metrics or third-party marks.
 */

const SOURCE = [
  '<main>',
  '  <h1>Interiors made for how',
  '      you actually live.</h1>',
  '  <p>An independent studio working in',
  '     warm materials and daylight.</p>',
  '  <ul class="work">',
  '    <li><img src="/kilimani.avif"',
  '             alt="Kilimani apartment"></li>',
  '  </ul>',
  '</main>',
] as const

export function HeroProductWindow() {
  return <figure className="fuma-bloom fuma-rise mt-16 sm:mt-20" style={{ animationDelay: '220ms' }}>
    <div className="fuma-rimlit overflow-hidden rounded-2xl bg-card/80 backdrop-blur-sm">
      {/* Editor chrome */}
      <div className="flex items-center gap-4 border-b border-border/80 px-4 py-3">
        <p className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <span aria-hidden="true" className="live-indicator size-1.5 rounded-full" />
          atelier-nia.co.ke
        </p>
        <span className="ml-auto rounded-md bg-live-soft px-2.5 py-1 font-mono text-[0.7rem] font-medium text-live">Published</span>
      </div>

      <div className="grid min-w-0 lg:grid-cols-2">
        {/* Left — what you built */}
        <div className="min-w-0 border-b border-border/80 p-5 sm:p-8 lg:border-b-0 lg:border-r">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-signal-bright">What you built</p>
          <div className="fuma-rimlit mt-5 overflow-hidden rounded-xl bg-primary text-primary-foreground">
            <div className="flex items-center justify-between border-b border-primary-foreground/10 px-4 py-3">
              <span className="font-display text-sm font-semibold tracking-tight">Atelier Nia</span>
              <span aria-hidden="true" className="flex gap-3 text-[0.7rem] text-primary-foreground/50"><span>Work</span><span>Studio</span></span>
            </div>
            <div className="px-4 py-6 sm:px-6">
              <h3 className="max-w-[15ch] font-display text-[clamp(1.25rem,2.4vw,1.85rem)] font-semibold leading-[1.04] tracking-[-0.03em]">Interiors made for how you actually live.</h3>
              <p className="mt-3 max-w-[38ch] text-[0.8125rem] leading-relaxed text-primary-foreground/60">An independent studio working in warm materials and daylight.</p>
              <div aria-hidden="true" className="mt-5 grid grid-cols-2 gap-3">
                {['bg-brand-peach', 'bg-brand-sky'].map((tone) => <div className={`aspect-[5/4] rounded-lg ${tone}`} key={tone} />)}
              </div>
            </div>
          </div>
        </div>

        {/* Right — what shipped */}
        <div className="min-w-0 p-5 sm:p-8">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-signal-bright">What shipped</p>
          <pre className="signal-inset mt-5 overflow-x-auto rounded-xl border border-signal-line bg-code-surface p-4 font-mono text-[0.78rem] leading-[1.8] sm:p-5"><code>
            {SOURCE.map((line) => <span className="block text-code-foreground" key={line}>{line}</span>)}
          </code></pre>
          <ul className="mt-5 grid gap-2 font-mono text-[0.72rem] text-muted-foreground sm:grid-cols-2">
            {['No framework runtime', 'No builder attributes', 'No editor markup', 'No div soup'].map((item) => <li className="flex items-center gap-2" key={item}>
              <span aria-hidden="true" className="text-live">—</span>{item}
            </li>)}
          </ul>
        </div>
      </div>
    </div>
    <figcaption className="mt-4 font-mono text-xs text-muted-foreground">Illustrative sample site. No customer data, availability or performance claim.</figcaption>
  </figure>
}
