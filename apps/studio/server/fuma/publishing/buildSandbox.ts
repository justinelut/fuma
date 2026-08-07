/**
 * The per-tenant build sandbox.
 *
 * A publish now runs `next build`, and that is a categorically different thing from anything the
 * publisher did before: **it executes code the customer wrote.** `next.config.ts`, every module in
 * the workspace, and every dependency's build step all run in our process tree, on our
 * infrastructure, with whatever the parent process happened to hold.
 *
 * That reframes the problem. The build is not a computation to be made fast; it is untrusted code
 * to be contained. Four containment rules, each closing a path that is invisible if left open:
 *
 *   1. ENVIRONMENT IS A CLOSED ALLOWLIST. A tenant's `next.config.ts` can read `process.env`. Our
 *      server process holds DATABASE_URL, INSTATIC_SECRET_KEY and every signing secret, so
 *      inheriting the environment — or filtering it with a DENYLIST, which is the same thing one
 *      forgotten variable later — hands a customer the keys to the platform. Nothing reaches the
 *      child unless it is named here.
 *   2. A TIMEOUT IS MANDATORY, not optional. A build that never finishes holds a worker forever,
 *      and the tenant who wrote the loop is not the tenant who notices.
 *   3. OUTPUT IS CONTAINED. Only files beneath the declared output directory are collected. A
 *      build is tenant code, so it cannot be trusted to have written only where it said it would.
 *   4. FAILURE IS NORMAL. A build that fails is an ordinary outcome, not an incident, so the
 *      reason is captured and truncated to something storable rather than thrown away or stored
 *      whole.
 *
 * This follows the subprocess precedent already set by `server/publish/runtime/dependencyCache.ts`,
 * which passes a closed env (PATH/HOME only), enforces a timeout by aborting and killing, and
 * drains stdout and stderr CONCURRENTLY with awaiting exit — because a child that fills the pipe
 * buffer blocks before it ever reaches the exit syscall.
 */

/**
 * Every variable a build may see.
 *
 * Deliberately tiny, and deliberately an allowlist. `next build` needs a PATH to find its
 * toolchain, a HOME for package-manager caches, and NODE_ENV to build in production mode. It does
 * not need anything else, and anything else it can read is something a tenant can read.
 */
export const BUILD_ENV_ALLOWLIST: readonly string[] = Object.freeze([
  'PATH',
  'HOME',
  'NODE_ENV',
  // Suppresses interactive prompts and telemetry banners in most toolchains, so a build cannot
  // block waiting for input that will never come.
  'CI',
  'NEXT_TELEMETRY_DISABLED',
])

/** Variables that must never reach a build, asserted rather than assumed. */
export const FORBIDDEN_IN_BUILD: readonly string[] = Object.freeze([
  'DATABASE_URL',
  'INSTATIC_SECRET_KEY',
  'FUMA_OBJECT_ACCESS_SIGNING_SECRET',
  'PUBLIC_ORIGIN',
  'REDIS_URL',
  'AWS_SECRET_ACCESS_KEY',
  'OPENAI_API_KEY',
])

export type BuildEnvironment = Readonly<Record<string, string>>

export type EnvProblem = Readonly<{
  code: 'not-allowlisted' | 'forbidden'
  name: string
  message: string
}>

/**
 * Build the child environment.
 *
 * Returns problems rather than silently dropping unknown keys: a caller who passed something
 * expecting it to arrive should learn that it did not, otherwise a build fails for a reason that
 * looks like anything except a missing variable.
 */
export function buildEnvironment(
  requested: Readonly<Record<string, string | undefined>>,
): Readonly<{ env: BuildEnvironment, problems: readonly EnvProblem[] }> {
  const env: Record<string, string> = {}
  const problems: EnvProblem[] = []

  for (const [name, value] of Object.entries(requested)) {
    if (value === undefined) continue
    if (FORBIDDEN_IN_BUILD.includes(name)) {
      problems.push(Object.freeze({
        code: 'forbidden' as const,
        name,
        message:
          `${name} must never reach a build. Tenant code runs during the build and can read the `
          + 'environment, so passing this would disclose it to the customer.',
      }))
      continue
    }
    if (!BUILD_ENV_ALLOWLIST.includes(name)) {
      problems.push(Object.freeze({
        code: 'not-allowlisted' as const,
        name,
        message:
          `${name} is not in the build environment allowlist, so it was not passed. Add it `
          + 'deliberately if a build genuinely needs it — the allowlist exists so that is a '
          + 'visible decision rather than an inherited accident.',
      }))
      continue
    }
    env[name] = value
  }

  return Object.freeze({ env: Object.freeze(env), problems: Object.freeze(problems) })
}

export type SandboxLimits = Readonly<{
  /** Hard wall-clock limit. Required: a build with no limit can hold a worker forever. */
  timeoutMs: number
  /** Largest total output accepted, so a runaway build cannot fill the volume. */
  maxOutputBytes: number
  /** Largest number of output files, so a pathological build cannot exhaust inodes. */
  maxOutputFiles: number
}>

export const DEFAULT_LIMITS: SandboxLimits = Object.freeze({
  // Generous enough for a real Next build on a cold cache, bounded enough that a stuck build is
  // detected within one support response rather than one billing cycle.
  timeoutMs: 10 * 60 * 1000,
  maxOutputBytes: 512 * 1024 * 1024,
  maxOutputFiles: 20_000,
})

export type LimitProblem = Readonly<{
  code: 'no-timeout' | 'timeout-too-long' | 'limit-not-positive'
  message: string
}>

/**
 * Check limits before a build starts.
 *
 * Validated up front because a limit discovered to be nonsense halfway through a build has
 * already cost the thing it was meant to bound.
 */
export function reviewLimits(limits: SandboxLimits): readonly LimitProblem[] {
  const problems: LimitProblem[] = []
  if (limits.timeoutMs <= 0) {
    problems.push(Object.freeze({
      code: 'no-timeout',
      message:
        'A build must have a positive timeout. Without one a single tenant\'s infinite loop holds '
        + 'a worker indefinitely, and the tenant who wrote it is not the one who notices.',
    }))
  }
  if (limits.timeoutMs > 60 * 60 * 1000) {
    problems.push(Object.freeze({
      code: 'timeout-too-long',
      message:
        'A timeout above an hour is not a bound, it is a formality: the worker is unavailable for '
        + 'that long and the failure surfaces as unexplained publish latency.',
    }))
  }
  if (limits.maxOutputBytes <= 0 || limits.maxOutputFiles <= 0) {
    problems.push(Object.freeze({
      code: 'limit-not-positive',
      message: 'Output limits must be positive, or the first build produces nothing and reports success.',
    }))
  }
  return Object.freeze(problems)
}

/**
 * Whether a produced path may be collected as build output.
 *
 * A build is tenant code, so it is not trusted to have written only inside its output directory.
 * Absolute paths and any traversal are refused rather than normalised: normalising decides on the
 * tenant's behalf what they meant, and the safe answer to "did you mean to escape?" is no.
 */
export function isCollectablePath(relativePath: string): boolean {
  if (relativePath.length === 0) return false
  if (relativePath.startsWith('/')) return false
  // Windows-style absolute and UNC forms, because a path is text and text travels.
  if (/^[A-Za-z]:/.test(relativePath) || relativePath.startsWith('\\')) return false
  if (relativePath.split(/[/\\]/).includes('..')) return false
  // A NUL byte truncates a path at the syscall boundary, so a name containing one does not mean
  // what it reads as.
  if (relativePath.includes('\u0000')) return false
  return true
}

export type BuildOutcome =
  | Readonly<{ ok: true, files: readonly string[], totalBytes: number }>
  | Readonly<{
    ok: false
    reason: 'timed-out' | 'nonzero-exit' | 'too-many-files' | 'too-large' | 'escaped-output'
    /** Storable, human-readable explanation. */
    detail: string
  }>

/**
 * How much failure output to keep.
 *
 * A compiler error appears at the END of build output, after pages of progress logs. Truncating
 * the tail would therefore discard the actual cause and keep the noise — so the TAIL is what is
 * retained.
 */
export const MAX_FAILURE_DETAIL = 4_000

export function summariseFailure(output: string): string {
  const trimmed = output.trim()
  if (trimmed.length <= MAX_FAILURE_DETAIL) return trimmed
  return `…(truncated)\n${trimmed.slice(-MAX_FAILURE_DETAIL)}`
}

/**
 * Judge a completed build against its limits.
 *
 * Separated from running it so the decision is testable without spawning anything, and so one
 * place decides what "the build succeeded" means.
 */
export function judgeBuild(
  input: Readonly<{
    exitCode: number
    timedOut: boolean
    output: string
    producedPaths: readonly string[]
    totalBytes: number
    limits: SandboxLimits
  }>,
): BuildOutcome {
  // Timeout is checked FIRST: a killed process also reports a nonzero exit, and reporting that as
  // a build error would send somebody looking for a compiler mistake that does not exist.
  if (input.timedOut) {
    return Object.freeze({
      ok: false as const,
      reason: 'timed-out' as const,
      detail:
        `The build exceeded ${input.limits.timeoutMs}ms and was stopped. `
        + summariseFailure(input.output),
    })
  }

  if (input.exitCode !== 0) {
    return Object.freeze({
      ok: false as const,
      reason: 'nonzero-exit' as const,
      detail: summariseFailure(input.output),
    })
  }

  const escaped = input.producedPaths.filter((path) => !isCollectablePath(path))
  if (escaped.length > 0) {
    return Object.freeze({
      ok: false as const,
      reason: 'escaped-output' as const,
      detail:
        `The build wrote outside its output directory (${escaped[0]}). Nothing is collected, `
        + 'because a build that wrote somewhere unexpected has not produced a release anybody can '
        + 'reason about.',
    })
  }

  if (input.producedPaths.length > input.limits.maxOutputFiles) {
    return Object.freeze({
      ok: false as const,
      reason: 'too-many-files' as const,
      detail: `The build produced ${input.producedPaths.length} files, above the limit of ${input.limits.maxOutputFiles}.`,
    })
  }

  if (input.totalBytes > input.limits.maxOutputBytes) {
    return Object.freeze({
      ok: false as const,
      reason: 'too-large' as const,
      detail: `The build produced ${input.totalBytes} bytes, above the limit of ${input.limits.maxOutputBytes}.`,
    })
  }

  return Object.freeze({
    ok: true as const,
    files: Object.freeze([...input.producedPaths]),
    totalBytes: input.totalBytes,
  })
}

// ---------------------------------------------------------------------------
// Running the build
// ---------------------------------------------------------------------------

export type SpawnedBuild = Readonly<{
  exitCode: number
  timedOut: boolean
  output: string
}>

export type RunBuildInput = Readonly<{
  command: readonly string[]
  cwd: string
  env: BuildEnvironment
  limits: SandboxLimits
}>

/**
 * Run a build to completion, or stop it.
 *
 * Follows `dependencyCache.ts`: the timeout is enforced by aborting and KILLING the child, and
 * stdout and stderr are drained CONCURRENTLY with awaiting exit. That concurrency is not tidiness
 * — a child that fills the pipe buffer blocks before it ever reaches the exit syscall, so awaiting
 * exit first would hang on exactly the noisy builds most likely to be failing.
 *
 * stderr and stdout are MERGED, because a build's error and the progress that led to it interleave
 * and separating them loses the ordering that makes a failure readable.
 */
export async function runBuild(input: RunBuildInput): Promise<SpawnedBuild> {
  const child = Bun.spawn([...input.command], {
    cwd: input.cwd,
    env: input.env,
    stdout: 'pipe',
    stderr: 'pipe',
    // No stdin: a build that prompts would otherwise wait forever for an answer nobody will give.
    stdin: 'ignore',
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      child.kill()
    } catch {
      // Already exited; nothing to stop.
    }
  }, input.limits.timeoutMs)

  try {
    const [exitCode, stdoutText, stderrText] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return Object.freeze({
      exitCode,
      timedOut,
      output: `${stdoutText}${stderrText}`,
    })
  } finally {
    clearTimeout(timer)
  }
}
