import { Button } from '@ui/components/Button'
import type {
  CompleteProfileOnboardingStepCommand,
  ProfileOnboardingState,
} from '@core/fuma'
import styles from './ProfileOnboarding.module.css'

export type ProfileOnboardingStepHandler = (
  command: CompleteProfileOnboardingStepCommand,
) => void

export interface ProfileOnboardingProps {
  state: ProfileOnboardingState
  onCompleteStep?: ProfileOnboardingStepHandler
  ariaLabel?: string
}

export function ProfileOnboarding({
  state,
  onCompleteStep,
  ariaLabel = 'Onboarding progress',
}: ProfileOnboardingProps) {
  const totalSteps = state.steps.length
  const progressMaximum = Math.max(totalSteps, 1)
  const progressValue = state.complete ? progressMaximum : state.progress.cursor

  const completeStep = (stepId: string) => {
    onCompleteStep?.({
      organizationId: state.progress.organizationId,
      workspaceId: state.progress.workspaceId,
      siteId: state.progress.siteId,
      profileId: state.progress.profileId,
      compositionFingerprint: state.progress.compositionFingerprint,
      stepId,
    })
  }

  return (
    <section
      className={styles.root}
      aria-label={ariaLabel}
      data-complete={state.complete ? 'true' : 'false'}
      data-resume-cursor={state.progress.cursor}
    >
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.kicker}>
            {state.complete ? 'Setup complete' : 'Setup in progress'}
          </p>
          <h2 className={styles.title}>
            {state.complete ? 'Your setup is complete' : 'Continue setting up'}
          </h2>
          <p className={styles.summary}>
            {totalSteps === 0
              ? 'No setup steps are required.'
              : state.complete
                ? `${totalSteps} of ${totalSteps} steps complete.`
                : `Resume at step ${state.progress.cursor + 1} of ${totalSteps}.`}
          </p>
        </div>
        <div className={styles.progressBlock}>
          <progress
            className={styles.progress}
            aria-label="Completed onboarding steps"
            max={progressMaximum}
            value={progressValue}
          />
          <span className={styles.progressText}>
            {state.progress.cursor} of {totalSteps} steps complete
          </span>
        </div>
      </header>

      {totalSteps > 0 && (
        <ol className={styles.steps}>
          {state.steps.map((step, index) => {
            const completed = state.progress.completedStepIds.includes(step.id)
            const current = state.currentStepId === step.id
            const stepState = completed ? 'complete' : current ? 'current' : 'upcoming'

            return (
              <li className={styles.step} data-state={stepState} key={step.id}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {index + 1}
                </span>
                <div className={styles.stepCopy}>
                  <h3 className={styles.stepTitle}>{step.title}</h3>
                  <p className={styles.stepDescription}>{step.description}</p>
                  <span className={styles.stepStatus}>
                    {completed ? 'Completed' : current ? 'Current step' : 'Upcoming'}
                  </span>
                </div>
                {current && onCompleteStep && (
                  <Button
                    variant="primary"
                    size="sm"
                    aria-label={`Complete ${step.title}`}
                    onClick={() => completeStep(step.id)}
                  >
                    Complete step
                  </Button>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
