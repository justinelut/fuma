/**
 * Creating an organization.
 *
 * The gap: workspaces could be created from the management page but organizations could not — only
 * renamed. Everything needed already existed server-side (Better Auth's `/organization/create` is an
 * allowed route, gated by `authorizeOrganizationCreation` with `CustomerOrganizationLifecycle` adding
 * Fuma's profile and limits), so the only missing piece was a way to ask.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  CreateOrganization,
  MAX_SLUG_LENGTH,
  deriveSlug,
  isValidSlug,
  readCreated,
} from '@admin/fuma/organizationManagement/CreateOrganization'

afterEach(cleanup)

function client(overrides: Partial<{
  createOrganization: (name: string, slug: string) => Promise<unknown>
  slugAvailable: (slug: string) => Promise<boolean | null>
}> = {}) {
  return {
    createOrganization: overrides.createOrganization
      ?? (async (name: string, slug: string) => ({ id: 'org-new', name, slug })),
    slugAvailable: overrides.slugAvailable ?? (async () => true),
  }
}

describe('deriveSlug', () => {
  it('turns a name into a usable slug', () => {
    expect(deriveSlug('Acacia Digital')).toBe('acacia-digital')
  })

  it('keeps accented letters as letters rather than dropping them', () => {
    // Stripping the character entirely would turn "Café" into "caf", which reads as a typo.
    expect(deriveSlug('Café Rouge')).toBe('cafe-rouge')
  })

  it('collapses punctuation and runs of separators', () => {
    expect(deriveSlug('Bob & Sons   Ltd.')).toBe('bob-sons-ltd')
  })

  it('never leaves a leading or trailing hyphen', () => {
    expect(deriveSlug('  --Hello--  ')).toBe('hello')
  })

  it('truncates without leaving a trailing hyphen at the cut', () => {
    // Slicing can land on a separator, and a trailing hyphen fails the field's own pattern - so a
    // derived slug would be rejected by the form that derived it.
    const derived = deriveSlug('a'.repeat(MAX_SLUG_LENGTH - 1) + ' something')
    expect(derived.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH)
    expect(derived.endsWith('-')).toBe(false)
    expect(isValidSlug(derived)).toBe(true)
  })

  it('every derived slug passes the validator', () => {
    for (const name of ['Acacia', 'Café Rouge', 'Bob & Sons', '  --x--  ', 'A1 B2']) {
      expect(isValidSlug(deriveSlug(name))).toBe(true)
    }
  })
})

describe('isValidSlug', () => {
  it('refuses shapes Better Auth will not accept', () => {
    expect(isValidSlug('')).toBe(false)
    expect(isValidSlug('Upper')).toBe(false)
    expect(isValidSlug('-lead')).toBe(false)
    expect(isValidSlug('trail-')).toBe(false)
    expect(isValidSlug('double--hyphen')).toBe(false)
    expect(isValidSlug('has space')).toBe(false)
    expect(isValidSlug('a'.repeat(MAX_SLUG_LENGTH + 1))).toBe(false)
  })

  it('accepts the ordinary shapes', () => {
    expect(isValidSlug('acacia')).toBe(true)
    expect(isValidSlug('acacia-digital')).toBe(true)
    expect(isValidSlug('a1-b2-c3')).toBe(true)
  })
})

describe('the slug field', () => {
  it('derives from the name so nobody has to invent one', () => {
    render(<CreateOrganization client={client()} onCreated={() => {}} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acacia Digital' } })
    expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe('acacia-digital')
  })

  it('STOPS deriving once edited, so a deliberate slug is not overwritten', () => {
    render(<CreateOrganization client={client()} onCreated={() => {}} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acacia Digital' } })
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'acacia' } })
    // The next keystroke of the name must not clobber it.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acacia Digital Ltd' } })
    expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe('acacia')
  })

  it('reports a free slug', async () => {
    render(<CreateOrganization client={client()} onCreated={() => {}} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acacia' } })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('is free'), {
      timeout: 2000,
    })
  })

  it('reports a taken slug and blocks submission', async () => {
    render(
      <CreateOrganization
        client={client({ slugAvailable: async () => false })}
        onCreated={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acacia' } })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('already taken'), {
      timeout: 2000,
    })
    expect((screen.getByRole('button', { name: /Create organization/ }) as HTMLButtonElement).disabled)
      .toBe(true)
  })

  it('a FAILED check does not block the name', async () => {
    // Refusing a name because we could not ask blocks something that is probably fine.
    render(
      <CreateOrganization
        client={client({ slugAvailable: async () => null })}
        onCreated={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acacia' } })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Could not check'), {
      timeout: 2000,
    })
    expect((screen.getByRole('button', { name: /Create organization/ }) as HTMLButtonElement).disabled)
      .toBe(false)
  })
})

describe('creating', () => {
  it('sends the name and the effective slug', async () => {
    const sent: Array<{ name: string, slug: string }> = []
    render(
      <CreateOrganization
        client={client({
          createOrganization: async (name, slug) => {
            sent.push({ name, slug })
            return { id: 'org-new', name, slug }
          },
        })}
        onCreated={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acacia Digital' } })
    fireEvent.click(screen.getByRole('button', { name: /Create organization/ }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ name: 'Acacia Digital', slug: 'acacia-digital' })
  })

  it('reports the created organization to the caller', async () => {
    let created: unknown = null
    render(
      <CreateOrganization client={client()} onCreated={(value) => { created = value }} />,
    )
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acacia' } })
    fireEvent.click(screen.getByRole('button', { name: /Create organization/ }))
    await waitFor(() => expect(created).not.toBeNull())
    expect(created).toEqual({ id: 'org-new', name: 'Acacia', slug: 'acacia' })
  })

  it('surfaces a refusal instead of failing silently', async () => {
    render(
      <CreateOrganization
        client={client({
          createOrganization: async () => { throw new Error('Organization limit reached.') },
        })}
        onCreated={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acacia' } })
    fireEvent.click(screen.getByRole('button', { name: /Create organization/ }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('limit reached'))
  })

  it('does NOT navigate when the response cannot be read', async () => {
    // The organization may well exist; we just cannot say where. Saying so beats implying failure,
    // which invites a second attempt and a slug collision.
    let navigated = false
    render(
      <CreateOrganization
        client={client({ createOrganization: async () => ({ unexpected: true }) })}
        onCreated={() => { navigated = true }}
      />,
    )
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acacia' } })
    fireEvent.click(screen.getByRole('button', { name: /Create organization/ }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be read'))
    expect(navigated).toBe(false)
  })

  it('refuses an empty name', () => {
    render(<CreateOrganization client={client()} onCreated={() => {}} />)
    expect((screen.getByRole('button', { name: /Create organization/ }) as HTMLButtonElement).disabled)
      .toBe(true)
  })

  it('is disabled entirely for a caller without authority', () => {
    render(<CreateOrganization client={client()} onCreated={() => {}} disabled />)
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Create organization/ }) as HTMLButtonElement).disabled)
      .toBe(true)
  })
})

describe('readCreated', () => {
  it('accepts the bare shape', () => {
    expect(readCreated({ id: 'o', name: 'N', slug: 's' })).toEqual({ id: 'o', name: 'N', slug: 's' })
  })

  it('accepts a data envelope, because Better Auth uses both', () => {
    expect(readCreated({ data: { id: 'o', name: 'N', slug: 's' } }))
      .toEqual({ id: 'o', name: 'N', slug: 's' })
  })

  it('falls back to the slug when no name is returned', () => {
    expect(readCreated({ id: 'o', slug: 's' })).toEqual({ id: 'o', name: 's', slug: 's' })
  })

  it('returns null rather than a half-built object', () => {
    // Navigating on a partial answer lands somewhere that does not exist.
    expect(readCreated(null)).toBeNull()
    expect(readCreated({ slug: 's' })).toBeNull()
    expect(readCreated({ id: 'o' })).toBeNull()
    expect(readCreated('nonsense')).toBeNull()
  })
})
