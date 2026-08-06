/**
 * shadcn-style primitives for hosted dashboards.
 *
 * Written against the hosted Tailwind tokens rather than pulled in wholesale:
 * Studio has no Radix dependency, and the surfaces here need presentation
 * primitives, not overlay behaviour. Anything interactive keeps native
 * semantics so keyboard and screen-reader behaviour comes for free.
 *
 * Instatic's own chrome is untouched — these are only used by hosted platform
 * surfaces under `src/admin/fuma`.
 */
import { cva, type VariantProps } from 'class-variance-authority'
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from 'react'
import { cn } from './cn'

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'text-sm font-medium transition-colors select-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2',
    'disabled:pointer-events-none disabled:opacity-55',
  ),
  {
    variants: {
      variant: {
        solid: 'bg-dash-ink text-dash-surface hover:bg-dash-ink/90 focus-visible:outline-dash-ink',
        accent: 'bg-dash-accent text-white hover:brightness-110 focus-visible:outline-dash-ink',
        quiet: 'text-dash-ink-soft hover:bg-dash-rail hover:text-dash-ink focus-visible:outline-dash-ink',
        outline: 'border border-dash-hairline bg-dash-card text-dash-ink hover:bg-dash-rail focus-visible:outline-dash-ink',
        ghostDark: 'bg-ghost-card text-ghost-ink hover:bg-ghost-hairline focus-visible:outline-ghost-ink',
      },
      size: {
        sm: 'h-8 rounded-full px-3 text-[0.8125rem]',
        md: 'h-10 rounded-full px-4',
        lg: 'h-11 rounded-full px-5',
        icon: 'size-10 rounded-full',
        iconSm: 'size-8 rounded-full',
      },
    },
    defaultVariants: { variant: 'solid', size: 'md' },
  },
)

export type ButtonProps =
  ButtonHTMLAttributes<HTMLButtonElement>
  & VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      type={props.type ?? 'button'}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export type ButtonLinkProps =
  AnchorHTMLAttributes<HTMLAnchorElement>
  & VariantProps<typeof buttonVariants>

export function ButtonLink({ className, variant, size, ...props }: ButtonLinkProps) {
  return <a className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** `warm` is the ivory card the reference uses to break up the white grid. */
  tone?: 'plain' | 'warm' | 'ink'
}

export function Card({ className, tone = 'plain', ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-bento)] p-5',
        tone === 'plain' && 'bg-dash-card',
        tone === 'warm' && 'bg-dash-card-warm',
        tone === 'ink' && 'bg-dash-ink text-dash-surface',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-start justify-between gap-3', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold tracking-tight', className)} {...props} />
}

export function CardCaption({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs leading-relaxed text-dash-ink-muted', className)} {...props} />
}

/* -------------------------------------------------------------------------- */
/* Badge                                                                      */
/* -------------------------------------------------------------------------- */

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full text-xs font-medium',
  {
    variants: {
      variant: {
        solid: 'bg-dash-ink text-dash-surface',
        accent: 'bg-dash-accent text-white',
        outline: 'border border-dash-hairline text-dash-ink-soft',
        rail: 'bg-dash-rail text-dash-ink-soft',
      },
      size: {
        sm: 'h-6 px-2.5',
        md: 'h-8 px-3.5',
      },
    },
    defaultVariants: { variant: 'outline', size: 'sm' },
  },
)

export type BadgeProps =
  HTMLAttributes<HTMLSpanElement>
  & VariantProps<typeof badgeVariants>

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                   */
/* -------------------------------------------------------------------------- */

export interface ProgressProps {
  value: number
  label: string
  className?: string
  tone?: 'accent' | 'ink'
}

export function Progress({ value, label, className, tone = 'accent' }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-dash-rail', className)}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn(
          'h-full rounded-full',
          tone === 'accent' ? 'bg-dash-accent' : 'bg-dash-ink',
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Separator                                                                  */
/* -------------------------------------------------------------------------- */

export function Separator({ className, ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr className={cn('border-0 border-t border-dash-hairline', className)} {...props} />
}

/* -------------------------------------------------------------------------- */
/* Avatar                                                                     */
/* -------------------------------------------------------------------------- */

export interface AvatarProps {
  name: string
  className?: string
  src?: string | null
}

/**
 * Initials avatar. No network fetch and no identicon service: the hosted shell
 * should not leak a staff email hash to a third party to draw a circle.
 */
export function Avatar({ name, className, src }: AvatarProps) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full',
        'bg-dash-rail text-xs font-semibold text-dash-ink-soft',
        className,
      )}
    >
      {src
        ? <img className="size-full object-cover" src={src} alt="" />
        : <span aria-hidden="true">{initials || '·'}</span>}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Stat                                                                       */
/* -------------------------------------------------------------------------- */

export interface StatProps {
  value: ReactNode
  label: string
  icon?: ReactNode
  className?: string
}

export function Stat({ value, label, icon, className }: StatProps) {
  return (
    <div className={cn('text-right', className)}>
      <p className="text-[2rem] leading-none font-semibold tracking-tight text-dash-ink">
        {value}
      </p>
      <p className="mt-2 flex items-center justify-end gap-1.5 text-xs text-dash-ink-muted">
        {icon}
        {label}
      </p>
    </div>
  )
}
