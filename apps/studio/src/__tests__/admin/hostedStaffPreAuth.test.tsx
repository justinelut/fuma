import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HostedStaffPreAuth } from '@admin/preauth/HostedStaffPreAuth'
import { MemoryRouter } from '@admin/lib/routing'

const originalFetch = globalThis.fetch

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

function renderPreAuth(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HostedStaffPreAuth initialError={null} onAuthenticated={mock(() => {})} />
    </MemoryRouter>,
  )
}

describe('HostedStaffPreAuth', () => {
  it('uses touched and submit validation without calling the auth client', async () => {
    const fetchMock = mock(async () => {
      throw new Error('Validation must prevent the request')
    })
    globalThis.fetch = fetchMock as typeof fetch
    renderPreAuth('/admin/signup')

    expect(screen.queryByText('Name is required')).toBeNull()
    fireEvent.blur(screen.getByRole('textbox', { name: 'Name' }))
    expect(await screen.findByText('Name is required')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(screen.getByText('Email is required')).toBeTruthy()
      expect(screen.getByText('Password is required')).toBeTruthy()
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('revalidates password confirmation when the password field changes', async () => {
    renderPreAuth('/admin/reset-password?token=reset-token')
    const password = screen.getByLabelText('New password')
    const confirmation = screen.getByLabelText('Confirm new password')

    fireEvent.change(password, { target: { value: 'first-password' } })
    fireEvent.change(confirmation, { target: { value: 'other-password' } })
    expect(await screen.findByText('Passwords do not match')).toBeTruthy()

    fireEvent.change(password, { target: { value: 'other-password' } })
    await waitFor(() => {
      expect(screen.queryByText('Passwords do not match')).toBeNull()
    })
  })
})
