import { useEffect, useId, useReducer, type FormEvent } from 'react'
import { useForm } from '@tanstack/react-form'
import { Button } from '@admin/fuma/ui/button'
import { Input } from '@admin/fuma/ui/input'
import { pushToast } from '@ui/components/Toast'
import {
  beginHostedStaffTotp,
  disableHostedStaffTotp,
  listHostedStaffSessions,
  listHostedStaffUsers,
  loginHostedStaff,
  regenerateHostedStaffRecoveryCodes,
  revokeHostedStaffSession,
  revokeOtherHostedStaffSessions,
  setHostedStaffBan,
  verifyHostedStaffRecoveryCode,
  verifyHostedStaffTotp,
  type HostedStaffDeviceSession,
  type HostedStaffSession,
  type HostedStaffUser,
  type HostedTotpSetup,
} from '@core/fuma/auth'
import { getErrorMessage } from '@core/utils/errorMessage'

interface HostedStaffSecurityProps {
  session: HostedStaffSession
  onSessionChange: (session: HostedStaffSession) => void
}

type MfaAction = 'enroll' | 'complete' | 'rotate' | 'disable'

interface SecurityState {
  reauthPending: boolean
  recoveryMode: boolean
  setup: HostedTotpSetup | null
  recoveryCodes: readonly string[]
  sessions: readonly HostedStaffDeviceSession[]
  users: readonly HostedStaffUser[]
  busy: boolean
  status: string | null
}

type SecurityAction = Readonly<{
  type: 'update'
  value: Partial<SecurityState>
}>

const initialSecurityState: SecurityState = {
  reauthPending: false,
  recoveryMode: false,
  setup: null,
  recoveryCodes: [],
  sessions: [],
  users: [],
  busy: false,
  status: null,
}

function securityReducer(state: SecurityState, action: SecurityAction): SecurityState {
  return { ...state, ...action.value }
}

function mfaActionFromSubmit(event: FormEvent<HTMLFormElement>, fallback: MfaAction): MfaAction {
  const submitter = (event.nativeEvent as SubmitEvent).submitter
  const value = submitter instanceof HTMLButtonElement ? submitter.value : fallback
  if (value === 'enroll' || value === 'complete' || value === 'rotate' || value === 'disable') {
    return value
  }
  return fallback
}

/**
 * The hosted auth boundary denies stale sensitive operations with the exact
 * machine code `step_up_required`. Staff read it as instruction, not jargon.
 */
function securityMessage(caught: unknown, fallback: string): string {
  const message = getErrorMessage(caught, fallback)
  return message === 'step_up_required'
    ? 'Reauthenticate below to use sensitive staff controls. Sessions stay sensitive for five minutes.'
    : message
}

export function HostedStaffSecurity({ session, onSessionChange }: HostedStaffSecurityProps) {
  const [state, dispatch] = useReducer(securityReducer, initialSecurityState)
  const reauthPasswordId = useId()
  const reauthCodeId = useId()
  const mfaPasswordId = useId()
  const mfaCodeId = useId()

  async function run(action: () => Promise<void>, fallback: string): Promise<void> {
    if (state.busy) return
    dispatch({ type: 'update', value: { busy: true, status: null } })
    try {
      await action()
    } catch (caught) {
      console.error('[hosted-staff-security] operation failed:', caught)
      pushToast({
        kind: 'error',
        title: 'Security operation failed',
        body: securityMessage(caught, fallback),
      })
    } finally {
      dispatch({ type: 'update', value: { busy: false } })
    }
  }

  async function refreshSessions(): Promise<void> {
    dispatch({ type: 'update', value: { sessions: await listHostedStaffSessions() } })
  }

  const reauthForm = useForm({
    defaultValues: {
      password: '',
      code: '',
    },
    onSubmit: async ({ value }) => {
      await run(async () => {
        if (state.reauthPending) {
          const current = state.recoveryMode
            ? await verifyHostedStaffRecoveryCode(value.code)
            : await verifyHostedStaffTotp(value.code)
          onSessionChange(current)
          reauthForm.reset()
          dispatch({
            type: 'update',
            value: {
              reauthPending: false,
              recoveryMode: false,
              status: 'Reauthentication complete for sensitive operations.',
            },
          })
          await refreshSessions()
          return
        }

        const result = await loginHostedStaff({
          email: session.user.email,
          password: value.password,
        })
        reauthForm.reset()
        if (result.kind === 'two-factor') {
          dispatch({
            type: 'update',
            value: {
              reauthPending: true,
              recoveryMode: false,
              status: 'Password accepted. Enter an authenticator or recovery code.',
            },
          })
          return
        }

        onSessionChange(result.session)
        dispatch({
          type: 'update',
          value: { status: 'Reauthentication complete for sensitive operations.' },
        })
        await refreshSessions()
      }, 'Could not reauthenticate')
    },
  })

  const mfaForm = useForm({
    defaultValues: {
      password: '',
      code: '',
    },
    onSubmitMeta: { action: 'enroll' as MfaAction },
    onSubmit: async ({ value, meta }) => {
      await run(async () => {
        if (meta.action === 'enroll') {
          const setup = await beginHostedStaffTotp(value.password)
          mfaForm.reset()
          dispatch({
            type: 'update',
            value: {
              setup,
              recoveryCodes: [],
              status: 'Add the TOTP URI to your authenticator, then verify one code.',
            },
          })
          return
        }

        if (meta.action === 'complete') {
          const current = await verifyHostedStaffTotp(value.code)
          onSessionChange(current)
          mfaForm.reset()
          dispatch({
            type: 'update',
            value: {
              recoveryCodes: state.setup?.backupCodes ?? [],
              setup: null,
              status: 'Two-factor authentication is enabled. Save the recovery codes now.',
            },
          })
          await refreshSessions()
          return
        }

        if (meta.action === 'rotate') {
          const recoveryCodes = await regenerateHostedStaffRecoveryCodes(value.password)
          mfaForm.reset()
          dispatch({
            type: 'update',
            value: {
              recoveryCodes,
              status: 'Previous recovery codes were invalidated. Save this new set now.',
            },
          })
          return
        }

        await disableHostedStaffTotp(value.password)
        const result = await loginHostedStaff({
          email: session.user.email,
          password: value.password,
        })
        if (result.kind !== 'authenticated') {
          throw new Error('Two-factor disable did not complete')
        }
        onSessionChange(result.session)
        mfaForm.reset()
        dispatch({
          type: 'update',
          value: {
            setup: null,
            recoveryCodes: [],
            status: 'Two-factor authentication is disabled.',
          },
        })
        await refreshSessions()
      }, 'Could not update two-factor authentication')
    },
  })

  useEffect(() => {
    let cancelled = false

    void listHostedStaffSessions().then(
      (sessions) => {
        if (!cancelled) dispatch({ type: 'update', value: { sessions } })
      },
      (caught: unknown) => {
        if (cancelled) return
        console.error('[hosted-staff-security] session list failed:', caught)
        pushToast({
          kind: 'error',
          title: 'Could not load devices',
          body: securityMessage(caught, 'Could not load staff sessions'),
        })
      },
    )

    if (session.user.role === 'admin') {
      void listHostedStaffUsers().then(
        (users) => {
          if (!cancelled) dispatch({ type: 'update', value: { users } })
        },
        (caught: unknown) => {
          if (cancelled) return
          console.error('[hosted-staff-security] staff list failed:', caught)
          pushToast({
            kind: 'error',
            title: 'Could not load staff accounts',
            body: securityMessage(caught, 'Could not load staff accounts'),
          })
        },
      )
    }

    return () => {
      cancelled = true
    }
  }, [session.user.role])

  function submitReauthentication(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    event.stopPropagation()
    void reauthForm.handleSubmit()
  }

  function submitMfa(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    event.stopPropagation()
    void mfaForm.handleSubmit({
      action: mfaActionFromSubmit(event, state.setup ? 'complete' : 'enroll'),
    })
  }

  function toggleRecoveryMode(): void {
    reauthForm.setFieldValue('code', '')
    dispatch({
      type: 'update',
      value: { recoveryMode: !state.recoveryMode, status: null },
    })
  }

  async function revokeSession(token: string): Promise<void> {
    await run(async () => {
      await revokeHostedStaffSession(token)
      await refreshSessions()
      dispatch({ type: 'update', value: { status: 'Device session revoked.' } })
    }, 'Could not revoke device session')
  }

  async function revokeOthers(): Promise<void> {
    await run(async () => {
      await revokeOtherHostedStaffSessions()
      await refreshSessions()
      dispatch({ type: 'update', value: { status: 'Other device sessions revoked.' } })
    }, 'Could not revoke other device sessions')
  }

  async function loadUsers(): Promise<void> {
    await run(async () => {
      dispatch({
        type: 'update',
        value: {
          users: await listHostedStaffUsers(),
          status: 'Staff accounts refreshed.',
        },
      })
    }, 'Could not load staff accounts')
  }

  async function toggleBan(user: HostedStaffUser): Promise<void> {
    await run(async () => {
      const updated = await setHostedStaffBan(user.id, user.banned !== true)
      dispatch({
        type: 'update',
        value: {
          users: state.users.map((entry) => entry.id === updated.id ? updated : entry),
          status: updated.banned ? 'Staff account suspended.' : 'Staff account restored.',
        },
      })
    }, 'Could not update staff account')
  }

  return (
    <div className="grid w-full gap-3">
      {state.status && <p className="text-sm text-muted-foreground" role="status">{state.status}</p>}

      <section className="grid min-w-0 gap-3 rounded-md bg-card p-6 [&_h2]:text-base [&_h2]:text-foreground [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-muted-foreground [&_label]:text-sm [&_label]:text-muted-foreground" aria-labelledby="hosted-reauth-title">
        <h2 id="hosted-reauth-title">Reauthenticate</h2>
        <p>Sensitive staff controls require a session created within the last five minutes.</p>
        <form className="grid gap-1 [&_label]:grid [&_label]:gap-1" onSubmit={submitReauthentication}>
          {!state.reauthPending ? (
            <reauthForm.Field name="password">
              {(field) => (
                <label htmlFor={reauthPasswordId}>
                  <span>Password</span>
                  <Input
                    id={reauthPasswordId}
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </label>
              )}
            </reauthForm.Field>
          ) : (
            <reauthForm.Field name="code">
              {(field) => (
                <label htmlFor={reauthCodeId}>
                  <span>{state.recoveryMode ? 'Recovery code' : 'Authentication code'}</span>
                  <Input
                    id={reauthCodeId}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    required
                    autoComplete="one-time-code"
                    inputMode={state.recoveryMode ? 'text' : 'numeric'}
                  />
                </label>
              )}
            </reauthForm.Field>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <Button type="submit" variant="default" size="sm" disabled={state.busy}>
              {state.reauthPending ? 'Verify challenge' : 'Reauthenticate'}
            </Button>
            {state.reauthPending && (
              <Button type="button" variant="ghost" size="sm" disabled={state.busy} onClick={toggleRecoveryMode}>
                {state.recoveryMode ? 'Use authenticator code' : 'Use recovery code'}
              </Button>
            )}
          </div>
        </form>
      </section>

      <section className="grid min-w-0 gap-3 rounded-md bg-card p-6 [&_h2]:text-base [&_h2]:text-foreground [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-muted-foreground [&_label]:text-sm [&_label]:text-muted-foreground" aria-labelledby="hosted-mfa-title">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <h2 id="hosted-mfa-title">Two-factor authentication</h2>
          <span className={`rounded-md px-1 py-0.5 text-xs font-semibold ${session.user.twoFactorEnabled ? 'bg-primary/10 text-primary' : 'bg-card text-muted-foreground'}`}>
            {session.user.twoFactorEnabled ? 'Enabled' : 'Not enabled'}
          </span>
        </div>
        <form className="grid gap-1 [&_label]:grid [&_label]:gap-1" onSubmit={submitMfa}>
          {state.setup ? (
            <>
              <p>Open this TOTP URI in your authenticator, then enter the generated code.</p>
              <p className="break-all font-mono text-xs">{state.setup.totpURI}</p>
              <mfaForm.Field name="code">
                {(field) => (
                  <label htmlFor={mfaCodeId}>
                    <span>Authentication code</span>
                    <Input
                      id={mfaCodeId}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      required
                      autoComplete="one-time-code"
                      inputMode="numeric"
                    />
                  </label>
                )}
              </mfaForm.Field>
              <div className="flex flex-wrap items-center gap-1">
                <Button type="submit" name="mfa-action" value="complete" variant="default" size="sm" disabled={state.busy}>
                  Enable two-factor
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={state.busy}
                  onClick={() => {
                    mfaForm.reset()
                    dispatch({ type: 'update', value: { setup: null, status: null } })
                  }}
                >
                  Cancel setup
                </Button>
              </div>
            </>
          ) : (
            <>
              <mfaForm.Field name="password">
                {(field) => (
                  <label htmlFor={mfaPasswordId}>
                    <span>Current password</span>
                    <Input
                      id={mfaPasswordId}
                      type="password"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      required
                      autoComplete="current-password"
                    />
                  </label>
                )}
              </mfaForm.Field>
              <p>Confirm your current password before enrolling, disabling MFA, or rotating recovery codes.</p>
              <div className="flex flex-wrap items-center gap-1">
                {!session.user.twoFactorEnabled && (
                  <Button type="submit" name="mfa-action" value="enroll" variant="secondary" size="sm" disabled={state.busy}>
                    Start setup
                  </Button>
                )}
                {session.user.twoFactorEnabled && (
                  <Button type="submit" name="mfa-action" value="rotate" variant="secondary" size="sm" disabled={state.busy}>
                    New recovery codes
                  </Button>
                )}
                {session.user.twoFactorEnabled && (
                  <Button type="submit" name="mfa-action" value="disable" variant="destructive" size="sm" disabled={state.busy}>
                    Disable two-factor
                  </Button>
                )}
              </div>
            </>
          )}
        </form>
        {state.recoveryCodes.length > 0 && (
          <div className="grid gap-2">
            <strong>Save these one-time recovery codes now.</strong>
            <ul className="m-0 grid list-none gap-1 p-0" aria-label="Recovery codes">
              {state.recoveryCodes.map((recoveryCode) => <li key={recoveryCode}><code>{recoveryCode}</code></li>)}
            </ul>
          </div>
        )}
      </section>

      <section className="grid min-w-0 gap-3 rounded-md bg-card p-6 [&_h2]:text-base [&_h2]:text-foreground [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-muted-foreground [&_label]:text-sm [&_label]:text-muted-foreground" aria-labelledby="hosted-sessions-title">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <h2 id="hosted-sessions-title">Device sessions</h2>
          <Button variant="ghost" size="sm" disabled={state.busy} onClick={() => void run(refreshSessions, 'Could not refresh device sessions')}>Refresh</Button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="secondary" size="sm" disabled={state.busy} onClick={() => void revokeOthers()}>Sign out other devices</Button>
        </div>
        {state.sessions.length === 0 ? (
          <p>No device sessions found.</p>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0 text-sm text-muted-foreground [&_li]:flex [&_li]:items-center [&_li]:justify-between [&_li]:gap-3 [&_li]:border-t [&_li]:border-border [&_li]:py-2 [&_li>span]:grid [&_li>span]:min-w-0 [&_li>span]:gap-0.5">
            {state.sessions.map((device) => {
              const current = device.id === session.session.id
              return (
                <li key={device.id}>
                  <span>
                    {device.userAgent || 'Unknown device'}
                    {current && <strong className="rounded-md px-1 py-0.5 text-xs font-semibold bg-muted text-foreground">Current device</strong>}
                    <small>Expires {new Date(device.expiresAt).toLocaleString()}</small>
                  </span>
                  <Button variant="ghost" size="sm" disabled={state.busy} onClick={() => void revokeSession(device.token)}>Revoke</Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {session.user.role === 'admin' && (
        <section className="grid min-w-0 gap-3 rounded-md bg-card p-6 [&_h2]:text-base [&_h2]:text-foreground [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-muted-foreground [&_label]:text-sm [&_label]:text-muted-foreground" aria-labelledby="hosted-admin-title">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <h2 id="hosted-admin-title">Staff controls</h2>
            <Button variant="ghost" size="sm" disabled={state.busy} onClick={() => void loadUsers()}>Refresh</Button>
          </div>
          <p>Bans revoke every active session. The configured protected owner cannot be suspended, demoted, revoked, or removed.</p>
          {state.users.length === 0 ? (
            <p>No staff accounts found.</p>
          ) : (
            <ul className="m-0 grid list-none gap-1 p-0 text-sm text-muted-foreground [&_li]:flex [&_li]:items-center [&_li]:justify-between [&_li]:gap-3 [&_li]:border-t [&_li]:border-border [&_li]:py-2 [&_li>span]:grid [&_li>span]:min-w-0 [&_li>span]:gap-0.5">
              {state.users.map((user) => (
                <li key={user.id}>
                  <span>
                    {user.name}
                    <small>{user.email}</small>
                  </span>
                  <Button
                    variant={user.banned ? 'secondary' : 'destructive'}
                    size="sm"
                    disabled={state.busy || user.id === session.user.id}
                    onClick={() => void toggleBan(user)}
                  >
                    {user.banned ? 'Restore' : 'Suspend'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
