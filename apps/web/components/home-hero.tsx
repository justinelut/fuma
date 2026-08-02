import type { Route } from 'next'
import Link from 'next/link'
import { MotionProductCanvasIsland } from '@/components/motion-product-canvas'
import { ProductShot } from '@/components/section-kit'

/**
 * Homepage hero.
 *
 * Fuma is a closed, owned platform. The signature canvas below uses authentic committed captures
 * of the running product; its first scene is server-rendered and remains meaningful without
 * JavaScript, while the narrow client island only changes which real product stage is in view.
 */

const assurances = [
  ['One platform', 'Design, content and publishing together'],
  ['Clean output', 'Semantic HTML and compact CSS'],
  ['1.1 kB', 'The only runtime a visitor loads'],
] as const

const canvasStyles = {
  canvas: 'fuma-rise fuma-pool mt-12 sm:mt-14',
  tabs: 'mb-4 flex flex-wrap gap-2 border-b border-line-soft pb-3',
  tab: 'relative inline-flex min-h-11 items-center rounded-control px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground aria-[selected=true]:text-foreground',
  indicator: 'absolute inset-x-4 -bottom-3.5 h-px bg-signal-bright',
  panel: 'min-w-0',
} as const

export function HomeHero() {
  return <section className="section fuma-glow !pb-0 pt-14 sm:pt-20">
    <h1 className="fuma-rise max-w-[20ch] font-display text-display-xl text-balance">
      The whole life of a site, in one place.
    </h1>

    <p className="fuma-rise mt-8 max-w-xl text-lede text-muted-foreground text-pretty" style={{ animationDelay: '70ms' }}>
      Design on a real canvas, keep your content beside it, and publish without assembling a stack.
      What reaches the visitor is markup you would be happy to have written yourself.
    </p>

    <div className="fuma-rise mt-10 flex flex-row flex-wrap items-center gap-3" style={{ animationDelay: '140ms' }}>
      <Link
        className="control-primary inline-flex min-h-11 items-center rounded-control bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors sm:min-h-0 sm:h-[2.125rem]"
        href={'/start?kind=sign_up&source=home' as Route}
      >Start building</Link>
      <Link
        className="control-secondary inline-flex min-h-11 items-center rounded-control px-4 text-sm font-medium transition-colors sm:min-h-0 sm:h-[2.125rem]"
        href={'/features' as Route}
      >See the platform</Link>
    </div>

    <MotionProductCanvasIsland
      scenes={[
        {
          id: 'design',
          label: 'Design',
          content: <ProductShot
            alt="The Fuma Pages workspace, showing a studio site being designed across breakpoint frames"
            caption="The real Fuma Pages workspace. Breakpoint frames are edited side by side."
            priority
            src="/product/site.webp"
          />,
        },
        {
          id: 'content',
          label: 'Content',
          content: <ProductShot
            alt="The Fuma Content workspace showing the Posts collection and the writing surface"
            caption="The real Content workspace in the running Fuma Studio."
            src="/product/content.webp"
          />,
        },
        {
          id: 'operate',
          label: 'Operate',
          content: <ProductShot
            alt="The Fuma dashboard showing site statistics, an activity feed and status widgets on a configurable grid"
            caption="The real Fuma dashboard, arranged per user."
            src="/product/dashboard.webp"
          />,
        },
      ]}
      styles={canvasStyles}
    />

    <dl className="fuma-rise mt-12 flex flex-wrap gap-x-12 gap-y-4 border-t border-border pt-6" style={{ animationDelay: '190ms' }}>
      {assurances.map(([label, detail]) => <div className="flex items-baseline gap-2.5" key={label}>
        <dt className="text-sm font-medium">{label}</dt>
        <dd className="text-sm text-muted-foreground">{detail}</dd>
      </div>)}
    </dl>
  </section>
}
