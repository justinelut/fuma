import { Button } from '@admin/fuma/ui/button'
import type {
  CompleteProfileOnboardingStepCommand,
  ProfileOnboardingState,
} from '@core/fuma'

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
      className="grid gap-px overflow-hidden rounded-md bg-border text-foreground"
      aria-label={ariaLabel}
      data-complete={state.complete ? 'true' : 'false'}
      data-resume-cursor={state.progress.cursor}
    >
      <header className="flex flex-col items-start justify-between gap-8 bg-card p-8 sm:flex-row sm:items-end">
        <div className="grid gap-1">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {state.complete ? 'Setup complete' : 'Setup in progress'}
          </p>
          <h2 className="text-2xl text-foreground">
            {state.complete ? 'Your setup is complete' : 'Continue setting up'}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {totalSteps === 0
              ? 'No setup steps are required.'
              : state.complete
                ? `${totalSteps} of ${totalSteps} steps complete.`
                : `Resume at step ${state.progress.cursor + 1} of ${totalSteps}.`}
          </p>
        </div>
        <div className="grid min-w-[min(100%,220px)] gap-1">
          <progress
            className="h-2 w-full overflow-hidden rounded-md border-0"
            aria-label="Completed onboarding steps"
            max={progressMaximum}
            value={progressValue}
          />
          <span className="text-right text-xs text-muted-foreground">
            {state.progress.cursor} of {totalSteps} steps complete
          </span>
        </div>
      </header>

      {totalSteps > 0 && (
        <ol className="m-0 grid list-none gap-px p-0">
          {state.steps.map((step, index) => {
            const completed = state.progress.completedStepIds.includes(step.id)
            const current = state.currentStepId === step.id
            const stepState = completed ? 'complete' : current ? 'current' : 'upcoming'

            return (
              <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-6 bg-card px-8 py-6" data-state={stepState} key={step.id}>
                <span className="grid size-10 place-items-center rounded-md border border-border font-mono text-xs text-muted-foreground" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="grid min-w-0 gap-1">
                  <h3 className="text-base text-foreground">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
                  <span className="mt-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {completed ? 'Completed' : current ? 'Current step' : 'Upcoming'}
                  </span>
                </div>
                {current && onCompleteStep && (
                  <Button
                    variant="default"
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
