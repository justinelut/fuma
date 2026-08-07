/**
 * The per-tenant build sandbox.
 *
 * A build executes code the customer wrote, so these tests are about containment rather than
 * correctness of output. The environment case is proven by RUNNING A REAL SUBPROCESS, because a
 * policy that is only declared is a policy nobody has checked.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUILD_ENV_ALLOWLIST,
  DEFAULT_LIMITS,
  FORBIDDEN_IN_BUILD,
  MAX_FAILURE_DETAIL,
  buildEnvironment,
  isCollectablePath,
  judgeBuild,
  reviewLimits,
  runBuild,
  summariseFailure,
  type SandboxLimits,
} from '../../../server/fuma/publishing/buildSandbox'

describe('the environment is a closed allowlist', () => {
  it('passes only allowlisted variables', () => {
    const { env } = buildEnvironment({ PATH: '/usr/bin', HOME: '/home/x', NODE_ENV: 'production' })
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/x', NODE_ENV: 'production' })
  })

  it('refuses a secret even though it was asked for', () => {
    // Tenant code runs during the build and can read the environment, so this is disclosure.
    const { env, problems } = buildEnvironment({
      PATH: '/usr/bin',
      DATABASE_URL: 'postgres://user:pass@host/db',
    })
    expect(env['DATABASE_URL']).toBeUndefined()
    expect(problems.some((problem) => problem.code === 'forbidden')).toBe(true)
  })

  it('drops an unknown variable and SAYS SO', () => {
    // Silently dropping it makes the build fail for a reason that looks like anything except a
    // missing variable.
    const { env, problems } = buildEnvironment({ MY_FLAG: '1' })
    expect(env['MY_FLAG']).toBeUndefined()
    expect(problems.some((problem) => problem.code === 'not-allowlisted')).toBe(true)
  })

  it('keeps the allowlist small', () => {
    // Every variable a build can read is one a tenant can read.
    expect(BUILD_ENV_ALLOWLIST.length).toBeLessThan(10)
  })

  it('names the secrets that must never appear', () => {
    for (const name of ['DATABASE_URL', 'INSTATIC_SECRET_KEY']) {
      expect(FORBIDDEN_IN_BUILD).toContain(name)
    }
    // A forbidden name must not also be allowlisted, or the two rules would disagree.
    for (const forbidden of FORBIDDEN_IN_BUILD) {
      expect(BUILD_ENV_ALLOWLIST).not.toContain(forbidden)
    }
  })

  it('skips an undefined value rather than passing the string "undefined"', () => {
    const { env } = buildEnvironment({ PATH: undefined })
    expect('PATH' in env).toBe(false)
  })
})

describe('environment isolation proven by a real subprocess', () => {
  it('does not leak a secret from this process into the child', async () => {
    // The policy is enforced by what we PASS, so the only honest check is to set a secret in the
    // parent, spawn a child with the built environment, and have the child report what it sees.
    const parentSecret = 'super-secret-value-do-not-leak'
    process.env['DATABASE_URL'] = parentSecret
    try {
      const { env } = buildEnvironment({
        PATH: process.env['PATH'],
        HOME: process.env['HOME'],
        NODE_ENV: 'production',
        // Deliberately attempt to pass it, as a careless caller would.
        DATABASE_URL: process.env['DATABASE_URL'],
      })

      const child = Bun.spawn(
        [process.execPath, '-e', 'console.log(JSON.stringify(process.env))'],
        { env, stdout: 'pipe', stderr: 'pipe' },
      )
      const [text] = await Promise.all([
        new Response(child.stdout).text(),
        child.exited,
      ])
      const childEnv = JSON.parse(text) as Record<string, string>

      expect(childEnv['DATABASE_URL']).toBeUndefined()
      expect(text).not.toContain(parentSecret)
      // And the child genuinely got what it needs, so the isolation is not just "passed nothing".
      expect(childEnv['NODE_ENV']).toBe('production')
    } finally {
      delete process.env['DATABASE_URL']
    }
  })
})

describe('a timeout is mandatory', () => {
  it('refuses a zero or negative timeout', () => {
    expect(reviewLimits({ ...DEFAULT_LIMITS, timeoutMs: 0 })
      .some((problem) => problem.code === 'no-timeout')).toBe(true)
  })

  it('refuses a timeout so long it is not a bound', () => {
    expect(reviewLimits({ ...DEFAULT_LIMITS, timeoutMs: 3 * 60 * 60 * 1000 })
      .some((problem) => problem.code === 'timeout-too-long')).toBe(true)
  })

  it('accepts the shipped defaults', () => {
    // If our own defaults were rejected, the limits would be theatre.
    expect(reviewLimits(DEFAULT_LIMITS)).toEqual([])
  })

  it('refuses non-positive output limits', () => {
    expect(reviewLimits({ ...DEFAULT_LIMITS, maxOutputBytes: 0 })
      .some((problem) => problem.code === 'limit-not-positive')).toBe(true)
  })
})

describe('output is contained', () => {
  it('accepts an ordinary relative path', () => {
    expect(isCollectablePath('index.html')).toBe(true)
    expect(isCollectablePath('_next/static/chunk.js')).toBe(true)
  })

  it('refuses an absolute path', () => {
    expect(isCollectablePath('/etc/passwd')).toBe(false)
  })

  it('refuses traversal', () => {
    // Refused rather than normalised: normalising decides on the tenant's behalf what they meant.
    expect(isCollectablePath('../../../etc/passwd')).toBe(false)
    expect(isCollectablePath('_next/../../secret')).toBe(false)
  })

  it('refuses Windows absolute and UNC forms', () => {
    // A path is text and text travels between systems.
    expect(isCollectablePath('C:\\Windows\\system32')).toBe(false)
    expect(isCollectablePath('\\\\server\\share')).toBe(false)
  })

  it('refuses a path containing NUL', () => {
    // A NUL truncates the path at the syscall boundary, so the name does not mean what it reads as.
    expect(isCollectablePath('ok.html\u0000../../etc/passwd')).toBe(false)
  })

  it('refuses an empty path', () => {
    expect(isCollectablePath('')).toBe(false)
  })
})

describe('judging a finished build', () => {
  const limits: SandboxLimits = DEFAULT_LIMITS
  const base = {
    exitCode: 0, timedOut: false, output: '', producedPaths: ['index.html'], totalBytes: 100, limits,
  }

  it('accepts a clean build', () => {
    const outcome = judgeBuild(base)
    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.files).toEqual(['index.html'])
  })

  it('reports a timeout as a timeout, not as a build error', () => {
    // A killed process also exits nonzero, and reporting that as a compiler error sends somebody
    // looking for a mistake that does not exist.
    const outcome = judgeBuild({ ...base, timedOut: true, exitCode: 137 })
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.reason).toBe('timed-out')
  })

  it('reports a nonzero exit with the build output', () => {
    const outcome = judgeBuild({ ...base, exitCode: 1, output: 'TS2304: Cannot find name' })
    expect(outcome.ok === false && outcome.reason).toBe('nonzero-exit')
    expect(outcome.ok === false && outcome.detail).toContain('TS2304')
  })

  it('collects NOTHING when the build wrote outside its output directory', () => {
    const outcome = judgeBuild({ ...base, producedPaths: ['index.html', '../escape.js'] })
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.reason).toBe('escaped-output')
  })

  it('refuses too many files', () => {
    const many = Array.from({ length: 5 }, (_unused, index) => `file-${index}.html`)
    const outcome = judgeBuild({
      ...base, producedPaths: many, limits: { ...limits, maxOutputFiles: 4 },
    })
    expect(outcome.ok === false && outcome.reason).toBe('too-many-files')
  })

  it('refuses output that is too large', () => {
    const outcome = judgeBuild({
      ...base, totalBytes: 999, limits: { ...limits, maxOutputBytes: 100 },
    })
    expect(outcome.ok === false && outcome.reason).toBe('too-large')
  })
})

describe('failure detail is storable and keeps the cause', () => {
  it('keeps short output whole', () => {
    expect(summariseFailure('  boom  ')).toBe('boom')
  })

  it('keeps the TAIL when truncating', () => {
    // A compiler error appears at the END of build output, after pages of progress logs. Keeping
    // the head would discard the actual cause and retain the noise.
    const noise = 'progress line\n'.repeat(2_000)
    const summary = summariseFailure(`${noise}FATAL: the real cause`)
    expect(summary).toContain('FATAL: the real cause')
    expect(summary.length).toBeLessThanOrEqual(MAX_FAILURE_DETAIL + 32)
  })

  it('marks that it truncated', () => {
    const summary = summariseFailure('x'.repeat(MAX_FAILURE_DETAIL + 100))
    expect(summary).toContain('truncated')
  })
})

describe('running a real build subprocess', () => {
  const env = buildEnvironment({ PATH: process.env['PATH'], HOME: process.env['HOME'] }).env

  it('reports a successful build', async () => {
    const result = await runBuild({
      command: [process.execPath, '-e', 'console.log("built ok")'],
      cwd: process.cwd(),
      env,
      limits: DEFAULT_LIMITS,
    })
    expect(result.exitCode).toBe(0)
    expect(result.timedOut).toBe(false)
    expect(result.output).toContain('built ok')
  })

  it('captures a failing build exit code and its message', async () => {
    const result = await runBuild({
      command: [process.execPath, '-e', 'console.error("TS2304: Cannot find name"); process.exit(2)'],
      cwd: process.cwd(),
      env,
      limits: DEFAULT_LIMITS,
    })
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('TS2304')
    expect(judgeBuild({ ...result, producedPaths: [], totalBytes: 0, limits: DEFAULT_LIMITS }).ok)
      .toBe(false)
  })

  it('STOPS a build that never finishes', async () => {
    // The property that keeps one tenant's infinite loop from holding a worker forever.
    const started = Date.now()
    const result = await runBuild({
      command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
      cwd: process.cwd(),
      env,
      limits: { ...DEFAULT_LIMITS, timeoutMs: 400 },
    })
    expect(result.timedOut).toBe(true)
    // Actually stopped rather than merely flagged.
    expect(Date.now() - started).toBeLessThan(10_000)
    const outcome = judgeBuild({
      ...result, producedPaths: [], totalBytes: 0,
      limits: { ...DEFAULT_LIMITS, timeoutMs: 400 },
    })
    expect(outcome.ok === false && outcome.reason).toBe('timed-out')
  })

  it('does not hang on a build that floods its output', async () => {
    // The reason stdout/stderr are drained CONCURRENTLY with awaiting exit: a child that fills the
    // pipe buffer blocks before reaching the exit syscall, so awaiting exit first would hang on
    // exactly the noisy builds most likely to be failing.
    const result = await runBuild({
      command: [
        process.execPath,
        '-e',
        'for (let i = 0; i < 20000; i += 1) console.log("noisy build output line " + i)',
      ],
      cwd: process.cwd(),
      env,
      limits: { ...DEFAULT_LIMITS, timeoutMs: 30_000 },
    })
    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(0)
    expect(result.output.length).toBeGreaterThan(100_000)
  })

  it('does not wait for input a build asks for', async () => {
    // stdin is ignored, so a prompting build fails fast instead of waiting forever.
    const result = await runBuild({
      command: [
        process.execPath,
        '-e',
        'const fs=require("fs");try{fs.readFileSync(0,"utf8");console.log("read stdin")}catch(e){console.log("no stdin")}',
      ],
      cwd: process.cwd(),
      env,
      limits: { ...DEFAULT_LIMITS, timeoutMs: 5_000 },
    })
    expect(result.timedOut).toBe(false)
  })
})

describe('the sandbox source cannot quietly reopen', () => {
  const source = readFileSync(
    join(import.meta.dir, '../../../server/fuma/publishing/buildSandbox.ts'), 'utf8',
  )

  it('never spreads the parent environment into a child', () => {
    // `...process.env` is the single edit that would undo the whole containment story, and it
    // reads as a convenience rather than as a disclosure.
    expect(source).not.toContain('...process.env')
    expect(source).not.toMatch(/env:\s*process\.env/)
  })

  it('ignores stdin rather than inheriting it', () => {
    expect(source).toContain("stdin: 'ignore'")
  })

  it('kills the child on timeout rather than only flagging it', () => {
    // A flag without a kill leaves the build running and the worker occupied.
    expect(source).toContain('child.kill()')
  })

  it('drains both streams concurrently with awaiting exit', () => {
    // Awaiting exit first hangs on a child that filled the pipe buffer.
    const runner = source.slice(source.indexOf('export async function runBuild'))
    expect(runner).toContain('Promise.all')
    expect(runner).toContain('child.exited')
    expect(runner).toContain('child.stdout')
    expect(runner).toContain('child.stderr')
  })

  it('states why the environment is an allowlist rather than a denylist', () => {
    expect(source).toContain('DENYLIST')
  })
})
