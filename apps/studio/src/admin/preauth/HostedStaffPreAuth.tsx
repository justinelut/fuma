import { useId, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { Button } from '@ui/components/Button'
import { Input } from '@ui/components/Input'
import { DatabaseSolidIcon } from 'pixel-art-icons/icons/database-solid'
import { LoaderIcon } from 'pixel-art-icons/icons/loader'
import {
  beginHostedStaffGoogleSignIn,
  loginHostedStaff,
  requestHostedStaffPasswordReset,
  resendHostedStaffVerification,
  resetHostedStaffPassword,
  signUpHostedStaff,
  verifyHostedStaffRecoveryCode,
  verifyHostedStaffTotp,
  type HostedStaffSession,
} from '@core/fuma/auth'
import { getErrorMessage } from '@core/utils/errorMessage'
import { useLocation, useNavigate } from '../lib/routing'
import panelStyles from '../AdminEntry.module.css'
import styles from './HostedStaffPreAuth.module.css'

const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 128
const MAX_EMAIL_LENGTH = 320
const MAX_NAME_LENGTH = 128
const MAX_MFA_CODE_LENGTH = 32
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const DEFAULT_FORM_VALUES = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  mfaCode: '',
}

type Completion = 'verification-sent' | 'reset-sent' | 'reset-complete' | null
type HostedPreAuthPhase = 'login' | 'signup' | 'forgot' | 'reset'

function phaseForPath(pathname: string): HostedPreAuthPhase {
  if (pathname === '/admin/signup') return 'signup'
  if (pathname === '/admin/forgot-password') return 'forgot'
  if (pathname === '/admin/reset-password') return 'reset'
  return 'login'
}

const PHASE_COPY: Record<HostedPreAuthPhase, Readonly<{
  title: string
  submit: string
  pending: string
}>> = {
  login: { title: 'Sign in to Fuma', submit: 'Sign in', pending: 'Signing in' },
  signup: { title: 'Create your Fuma account', submit: 'Create account', pending: 'Creating account' },
  forgot: { title: 'Reset your password', submit: 'Send reset link', pending: 'Sending link' },
  reset: { title: 'Choose a new password', submit: 'Reset password', pending: 'Resetting password' },
}

function validateName(value: string): string | undefined {
  if (!value.trim()) return 'Name is required'
  if (value.length > MAX_NAME_LENGTH) return `Name must be ${MAX_NAME_LENGTH} characters or fewer`
  return undefined
}

function validateEmail(value: string): string | undefined {
  if (!value.trim()) return 'Email is required'
  if (value.length > MAX_EMAIL_LENGTH) return `Email must be ${MAX_EMAIL_LENGTH} characters or fewer`
  if (!EMAIL_PATTERN.test(value)) return 'Enter a valid email address'
  return undefined
}

function validatePassword(value: string, requireMinimum: boolean): string | undefined {
  if (!value) return 'Password is required'
  if (requireMinimum && value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }
  if (value.length > MAX_PASSWORD_LENGTH) return `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer`
  return undefined
}

function validateConfirmation(value: string, password: string): string | undefined {
  const passwordError = validatePassword(value, true)
  if (passwordError) return passwordError.replace('Password', 'Password confirmation')
  if (value !== password) return 'Passwords do not match'
  return undefined
}

function validateMfaCode(value: string): string | undefined {
  if (!value.trim()) return 'Authentication code is required'
  if (value.length < 6) return 'Authentication code must be at least 6 characters'
  if (value.length > MAX_MFA_CODE_LENGTH) {
    return `Authentication code must be ${MAX_MFA_CODE_LENGTH} characters or fewer`
  }
  return undefined
}

function visibleFieldError(isTouched: boolean, errors: unknown[]): string | null {
  if (!isTouched) return null
  const error = errors[0]
  return typeof error === 'string' ? error : null
}

interface HostedStaffPreAuthProps {
  initialError: string | null
  onAuthenticated: (session: HostedStaffSession) => void
}

export function HostedStaffPreAuth({ initialError, onAuthenticated }: HostedStaffPreAuthProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const phase = phaseForPath(location.pathname)
  const query = new URLSearchParams(location.search)
  const resetToken = query.get('token')
  const [mfaPending, setMfaPending] = useState(false)
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [completion, setCompletion] = useState<Completion>(null)
  const [error, setError] = useState<string | null>(initialError)
  const [canResend, setCanResend] = useState(false)
  const [resending, setResending] = useState(false)
  const [googlePending, setGooglePending] = useState(false)
  const nameId = useId()
  const emailId = useId()
  const passwordId = useId()
  const confirmPasswordId = useId()
  const mfaCodeId = useId()

  const form = useForm({
    defaultValues: DEFAULT_FORM_VALUES,
    canSubmitWhenInvalid: true,
    onSubmit: async ({ value }) => {
      setError(null)
      setCanResend(false)
      try {
        if (phase === 'signup') {
          await signUpHostedStaff({ name: value.name, email: value.email, password: value.password })
          form.resetField('password')
          setCompletion('verification-sent')
          return
        }
        if (phase === 'forgot') {
          await requestHostedStaffPasswordReset(value.email)
          setCompletion('reset-sent')
          return
        }
        if (phase === 'reset') {
          if (!resetToken) throw new Error('This reset link is invalid or expired')
          await resetHostedStaffPassword(resetToken, value.password)
          form.resetField('password')
          form.resetField('confirmPassword')
          setCompletion('reset-complete')
          return
        }
        if (mfaPending) {
          const session = recoveryMode
            ? await verifyHostedStaffRecoveryCode(value.mfaCode)
            : await verifyHostedStaffTotp(value.mfaCode)
          onAuthenticated(session)
          return
        }
        const result = await loginHostedStaff({ email: value.email, password: value.password })
        if (result.kind === 'two-factor') {
          setMfaPending(true)
          form.resetField('password')
          return
        }
        onAuthenticated(result.session)
      } catch (caught) {
        const message = getErrorMessage(
          caught,
          mfaPending ? 'Authentication code verification failed' : `${PHASE_COPY[phase].title} failed`,
        )
        setError(message)
        setCanResend(/verif/i.test(message))
      }
    },
  })

  function go(path: string): void {
    setError(null)
    setCanResend(false)
    setCompletion(null)
    setMfaPending(false)
    setRecoveryMode(false)
    form.reset()
    navigate(path)
  }

  async function resendVerification(): Promise<void> {
    setResending(true)
    setError(null)
    try {
      await resendHostedStaffVerification(form.state.values.email)
      setCompletion('verification-sent')
    } catch (caught) {
      setError(getErrorMessage(caught, 'Verification email request failed'))
    } finally {
      setResending(false)
    }
  }

  async function beginGoogleSignIn(): Promise<void> {
    setGooglePending(true)
    setError(null)
    try {
      const callbackURL = new URL('/admin', window.location.origin).toString()
      const authorizationUrl = await beginHostedStaffGoogleSignIn(callbackURL)
      window.location.assign(authorizationUrl)
    } catch (caught) {
      setError(getErrorMessage(caught, 'Google sign-in could not start'))
      setGooglePending(false)
    }
  }

  function toggleRecoveryMode(): void {
    setRecoveryMode((current) => !current)
    form.resetField('mfaCode')
    setError(null)
  }

  const copy = PHASE_COPY[phase]
  const completionMessage = completion === 'verification-sent'
    ? 'Check your inbox for a verification link. The response is the same even if the account already exists.'
    : completion === 'reset-sent'
      ? 'If an account exists for that email, a reset link is on its way.'
      : completion === 'reset-complete'
        ? 'Your password was reset and existing sessions were revoked.'
        : query.get('verified') === 'true'
          ? 'Email verified. You can now sign in.'
          : null
  const title = mfaPending ? 'Verify it is you' : copy.title

  return (
    <main className={panelStyles.page}>
      <section className={panelStyles.panel} aria-labelledby="hosted-auth-title">
        <div className={styles.brandRow}>
          <div className={styles.brandIcon} aria-hidden="true">
            <DatabaseSolidIcon size={16} />
          </div>
          <span>Fuma</span>
        </div>
        <h1 id="hosted-auth-title" className={panelStyles.title}>{title}</h1>

        {completionMessage && <p className={styles.status} role="status">{completionMessage}</p>}
        {mfaPending && (
          <p className={styles.status} role="status">
            {recoveryMode
              ? 'Enter one unused recovery code.'
              : 'Enter the six-digit code from your authenticator app.'}
          </p>
        )}

        {completion === 'verification-sent' || completion === 'reset-sent' || completion === 'reset-complete' ? (
          <Button variant="primary" size="md" fullWidth onClick={() => go('/admin/login')}>
            Return to sign in
          </Button>
        ) : (
          <>
            {(phase === 'login' || phase === 'signup') && !mfaPending && (
              <div className={styles.socialGroup}>
                <button className={styles.socialButton} type="button" disabled={googlePending} aria-busy={googlePending} onClick={() => void beginGoogleSignIn()}>
                  <svg className={styles.googleMark} aria-hidden="true" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.3Z" />
                    <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4L15.4 17c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
                    <path fill="#FBBC05" d="M6.4 13.9A6 6 0 0 1 6.1 12c0-.7.1-1.3.3-1.9V7.5H3.1A10 10 0 0 0 2 12c0 1.6.4 3.1 1.1 4.5l3.3-2.6Z" />
                    <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 12 2a10 10 0 0 0-8.9 5.5l3.3 2.6A6 6 0 0 1 12 6Z" />
                  </svg>
                  <span>{googlePending ? 'Opening Google…' : 'Continue with Google'}</span>
                </button>
                <div className={styles.divider}><span>or continue with email</span></div>
              </div>
            )}
            <form
            className={styles.form}
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void form.handleSubmit()
            }}
          >
            {phase === 'signup' && (
              <form.Field
                name="name"
                validators={{
                  onChange: ({ value }) => validateName(value),
                  onBlur: ({ value }) => validateName(value),
                  onSubmit: ({ value }) => validateName(value),
                }}
              >
                {(field) => {
                  const fieldError = visibleFieldError(field.state.meta.isTouched, field.state.meta.errors)
                  return (
                    <label className={styles.field} htmlFor={nameId}>
                      <span>Name</span>
                      <Input
                        id={nameId}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        invalid={fieldError !== null}
                        aria-describedby={fieldError ? `${nameId}-error` : undefined}
                        required
                        maxLength={MAX_NAME_LENGTH}
                        autoComplete="name"
                      />
                      {fieldError && <span id={`${nameId}-error`} role="alert" className={panelStyles.error}>{fieldError}</span>}
                    </label>
                  )
                }}
              </form.Field>
            )}

            {phase !== 'reset' && !mfaPending && (
              <form.Field
                name="email"
                validators={{
                  onChange: ({ value }) => validateEmail(value),
                  onBlur: ({ value }) => validateEmail(value),
                  onSubmit: ({ value }) => validateEmail(value),
                }}
              >
                {(field) => {
                  const fieldError = visibleFieldError(field.state.meta.isTouched, field.state.meta.errors)
                  return (
                    <label className={styles.field} htmlFor={emailId}>
                      <span>Email</span>
                      <Input
                        id={emailId}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        invalid={fieldError !== null}
                        aria-describedby={fieldError ? `${emailId}-error` : undefined}
                        required
                        maxLength={MAX_EMAIL_LENGTH}
                        type="email"
                        autoComplete="email"
                      />
                      {fieldError && <span id={`${emailId}-error`} role="alert" className={panelStyles.error}>{fieldError}</span>}
                    </label>
                  )
                }}
              </form.Field>
            )}

            {(phase === 'login' || phase === 'signup' || phase === 'reset') && !mfaPending && (
              <form.Field
                name="password"
                validators={{
                  onChange: ({ value }) => validatePassword(value, phase !== 'login'),
                  onBlur: ({ value }) => validatePassword(value, phase !== 'login'),
                  onSubmit: ({ value }) => validatePassword(value, phase !== 'login'),
                }}
              >
                {(field) => {
                  const fieldError = visibleFieldError(field.state.meta.isTouched, field.state.meta.errors)
                  return (
                    <label className={styles.field} htmlFor={passwordId}>
                      <span>{phase === 'reset' ? 'New password' : 'Password'}</span>
                      <Input
                        id={passwordId}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        invalid={fieldError !== null}
                        aria-describedby={fieldError ? `${passwordId}-error` : undefined}
                        required
                        minLength={phase === 'login' ? undefined : MIN_PASSWORD_LENGTH}
                        maxLength={MAX_PASSWORD_LENGTH}
                        type="password"
                        autoComplete={phase === 'login' ? 'current-password' : 'new-password'}
                      />
                      {fieldError && <span id={`${passwordId}-error`} role="alert" className={panelStyles.error}>{fieldError}</span>}
                    </label>
                  )
                }}
              </form.Field>
            )}

            {phase === 'reset' && (
              <form.Field
                name="confirmPassword"
                validators={{
                  onChangeListenTo: ['password'],
                  onChange: ({ value, fieldApi }) => validateConfirmation(value, fieldApi.form.getFieldValue('password')),
                  onBlur: ({ value, fieldApi }) => validateConfirmation(value, fieldApi.form.getFieldValue('password')),
                  onSubmit: ({ value, fieldApi }) => validateConfirmation(value, fieldApi.form.getFieldValue('password')),
                }}
              >
                {(field) => {
                  const fieldError = visibleFieldError(field.state.meta.isTouched, field.state.meta.errors)
                  return (
                    <label className={styles.field} htmlFor={confirmPasswordId}>
                      <span>Confirm new password</span>
                      <Input
                        id={confirmPasswordId}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        invalid={fieldError !== null}
                        aria-describedby={fieldError ? `${confirmPasswordId}-error` : undefined}
                        required
                        minLength={MIN_PASSWORD_LENGTH}
                        maxLength={MAX_PASSWORD_LENGTH}
                        type="password"
                        autoComplete="new-password"
                      />
                      {fieldError && <span id={`${confirmPasswordId}-error`} role="alert" className={panelStyles.error}>{fieldError}</span>}
                    </label>
                  )
                }}
              </form.Field>
            )}

            {mfaPending && (
              <form.Field
                name="mfaCode"
                validators={{
                  onChange: ({ value }) => validateMfaCode(value),
                  onBlur: ({ value }) => validateMfaCode(value),
                  onSubmit: ({ value }) => validateMfaCode(value),
                }}
              >
                {(field) => {
                  const fieldError = visibleFieldError(field.state.meta.isTouched, field.state.meta.errors)
                  return (
                    <label className={styles.field} htmlFor={mfaCodeId}>
                      <span>{recoveryMode ? 'Recovery code' : 'Authentication code'}</span>
                      <Input
                        id={mfaCodeId}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        invalid={fieldError !== null}
                        aria-describedby={fieldError ? `${mfaCodeId}-error` : undefined}
                        required
                        minLength={6}
                        maxLength={MAX_MFA_CODE_LENGTH}
                        autoComplete="one-time-code"
                        inputMode={recoveryMode ? 'text' : 'numeric'}
                      />
                      {fieldError && <span id={`${mfaCodeId}-error`} role="alert" className={panelStyles.error}>{fieldError}</span>}
                    </label>
                  )
                }}
              </form.Field>
            )}

            {error && <p role="alert" className={panelStyles.error}>{error}</p>}

            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <>
                  <Button
                    variant="primary"
                    size="md"
                    type="submit"
                    fullWidth
                    disabled={isSubmitting || resending || (phase === 'reset' && !resetToken)}
                    aria-busy={isSubmitting}
                  >
                    {isSubmitting && <LoaderIcon size={14} className={styles.spinIcon} aria-hidden="true" />}
                    <span>
                      {mfaPending
                        ? isSubmitting ? 'Verifying' : 'Verify'
                        : isSubmitting ? copy.pending : copy.submit}
                    </span>
                  </Button>

                  {mfaPending && (
                    <Button variant="secondary" size="md" fullWidth disabled={isSubmitting || resending} onClick={toggleRecoveryMode}>
                      {recoveryMode ? 'Use authenticator code' : 'Use a recovery code'}
                    </Button>
                  )}

                  {canResend && phase === 'login' && !mfaPending && (
                    <Button variant="secondary" size="md" fullWidth disabled={isSubmitting || resending} onClick={() => void resendVerification()}>
                      Resend verification email
                    </Button>
                  )}
                </>
              )}
            </form.Subscribe>
          </form>
          </>
        )}

        {!mfaPending && (
          <nav className={styles.links} aria-label="Authentication options">
            {phase !== 'login' && <Button variant="ghost" size="sm" onClick={() => go('/admin/login')}>Sign in</Button>}
            {phase !== 'signup' && <Button variant="ghost" size="sm" onClick={() => go('/admin/signup')}>Create account</Button>}
            {phase !== 'forgot' && phase !== 'reset' && <Button variant="ghost" size="sm" onClick={() => go('/admin/forgot-password')}>Forgot password?</Button>}
          </nav>
        )}
      </section>
    </main>
  )
}
