/**
 * Creating a new organization.
 *
 * THE GAP THIS FILLS: workspaces could be created from the management page but organizations could
 * not — only renamed. Everything needed already existed server-side (Better Auth's
 * `/organization/create` is an allowed route, `authorizeOrganizationCreation` gates it and
 * `CustomerOrganizationLifecycle` adds Fuma's profile and limits), so the only thing missing was a way
 * to ask. An agency running separate client organizations, or anyone whose first organization was
 * named wrongly at signup, had no route to a second one.
 *
 * THE SLUG IS DERIVED BUT EDITABLE. Deriving it means nobody has to invent one, which is the step
 * people abandon a form on. Keeping it editable means a derived slug that reads badly can be fixed —
 * and it stops being derived the moment it is edited, because silently overwriting somebody's
 * deliberate slug on the next keystroke of the name is the more annoying failure.
 *
 * AVAILABILITY IS CHECKED BEFORE SUBMITTING. A collision found at submit time arrives as a generic
 * failure, reads as "something went wrong" rather than "that name is taken", and by then the rest of
 * the form is filled in.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button } from '@admin/fuma/ui/button'
import { getErrorMessage } from '@core/utils/errorMessage'
import type { OrganizationManagementClient } from './client'

/**
 * Better Auth's organization slug shape, matching the pattern the workspace form already enforces.
 *
 * Lowercase, digits and single hyphens, never leading or trailing. Derivation and validation share
 * this one definition so a derived slug can never fail the field's own rule.
 */
export const ORGANIZATION_SLUG_PATTERN = '[a-z0-9]+(?:-[a-z0-9]+)*'

const SLUG_RULE = new RegExp(`^${ORGANIZATION_SLUG_PATTERN}$`)

/** Longest slug accepted, so a name that is a paragraph does not produce an unusable URL. */
export const MAX_SLUG_LENGTH = 48

export function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    // Strip marks so "Café" becomes "cafe" rather than losing the letter entirely.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    // A trailing hyphen can reappear after slicing, and it would fail the pattern.
    .replace(/-+$/g, '')
}

export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= MAX_SLUG_LENGTH && SLUG_RULE.test(slug)
}

export interface CreateOrganizationProps {
  client: Pick<OrganizationManagementClient, 'createOrganization' | 'slugAvailable'>
  /**
   * Called once the organization exists.
   *
   * REQUIRED, not optional: this page is scoped to a DIFFERENT organization, so creating one and
   * staying put leaves the user with a success message and no way in. The caller has to decide where
   * they go.
   */
  onCreated: (organization: Readonly<{ id: string, name: string, slug: string }>) => void
  disabled?: boolean
}

type SlugState = 'unchecked' | 'checking' | 'available' | 'taken' | 'unknown'

export function CreateOrganization({ client, onCreated, disabled = false }: CreateOrganizationProps) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [slugState, setSlugState] = useState<SlugState>('unchecked')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const effectiveSlug = slugEdited ? slug : deriveSlug(name)
  const slugUsable = isValidSlug(effectiveSlug)

  const check = useCallback(async (candidate: string) => {
    setSlugState('checking')
    const available = await client.slugAvailable(candidate)
    // null means the check itself failed. Reported as unknown rather than taken, because refusing a
    // name because we could not ask blocks something that is probably fine.
    setSlugState(available === null ? 'unknown' : available ? 'available' : 'taken')
  }, [client])

  useEffect(() => {
    if (!slugUsable) {
      setSlugState('unchecked')
      return
    }
    // Debounced: checking on every keystroke sends a request per character and the answers arrive out
    // of order, so the field can settle on the verdict for a slug the user has already changed.
    const timer = setTimeout(() => { void check(effectiveSlug) }, 400)
    return () => { clearTimeout(timer) }
  }, [effectiveSlug, slugUsable, check])

  const blocked = disabled || busy || name.trim().length === 0 || !slugUsable || slugState === 'taken'

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (blocked) return
    setBusy(true)
    setError('')
    try {
      const result = await client.createOrganization(name.trim(), effectiveSlug)
      const created = readCreated(result)
      if (!created) {
        // The organization may well exist; we simply cannot say where it is. Saying so beats implying
        // the creation failed, which would invite a second attempt and a slug collision.
        setError('The organization was created but the response could not be read. Reload to find it.')
        return
      }
      setName('')
      setSlug('')
      setSlugEdited(false)
      setSlugState('unchecked')
      onCreated(created)
    } catch (caught) {
      setError(getErrorMessage(caught, 'The organization could not be created.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(event) => { void submit(event) }} aria-labelledby="create-organization-title">
      <h2 id="create-organization-title">New organization</h2>
      <p>
        A separate organization keeps its own workspaces, sites, members and billing. Use one per
        client or per business — not per project, which is what workspaces are for.
      </p>

      <label>
        Name
        <input
          value={name}
          required
          disabled={disabled || busy}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>

      <label>
        Slug
        <input
          value={effectiveSlug}
          required
          pattern={ORGANIZATION_SLUG_PATTERN}
          maxLength={MAX_SLUG_LENGTH}
          disabled={disabled || busy}
          aria-describedby="create-organization-slug-state"
          onChange={(event) => {
            setSlugEdited(true)
            setSlug(event.currentTarget.value)
          }}
        />
      </label>

      <p id="create-organization-slug-state" role="status">
        {slugState === 'checking' ? 'Checking whether that slug is free…' : null}
        {slugState === 'available' ? 'That slug is free.' : null}
        {slugState === 'taken' ? 'That slug is already taken. Choose another.' : null}
        {slugState === 'unknown' ? 'Could not check the slug. You can still try to create it.' : null}
        {slugState === 'unchecked' && name.length > 0 && !slugUsable
          ? 'A slug uses lowercase letters, numbers and single hyphens.'
          : null}
      </p>

      {error ? <p role="alert">{error}</p> : null}

      <Button type="submit" variant="secondary" disabled={blocked}>
        {busy ? 'Creating organization' : 'Create organization'}
      </Button>
    </form>
  )
}

/**
 * Read the created organization out of Better Auth's response.
 *
 * The payload is validated rather than trusted, and both the bare and `{data:...}` envelopes are
 * accepted because Better Auth uses both across its endpoints. Returning null when it cannot be read
 * lets the caller say so instead of navigating somewhere that does not exist.
 */
export function readCreated(
  value: unknown,
): Readonly<{ id: string, name: string, slug: string }> | null {
  const candidates = [value, (value as { data?: unknown } | null)?.data]
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const row = candidate as Record<string, unknown>
    if (typeof row['id'] === 'string' && typeof row['slug'] === 'string') {
      return Object.freeze({
        id: row['id'],
        name: typeof row['name'] === 'string' ? row['name'] : row['slug'],
        slug: row['slug'],
      })
    }
  }
  return null
}
