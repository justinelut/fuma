import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import {
  SelfHostSmokePlanSchema,
  buildSelfHostSmokePlan,
  parseSelfHostSmokeArgs,
} from './selfHostSmoke'

describe('FUMA-WEB-003 self-host smoke plan', () => {
  it('builds an isolated SQLite and PostgreSQL lifecycle without invoking Docker', () => {
    const options = parseSelfHostSmokeArgs([
      '--dry-run',
      '--run-id', 'focused-test',
      '--image', 'instatic:before',
      '--replacement-image', 'instatic:after',
      '--release-bundle', '/tmp/instatic-test-release-bundle.tar.gz',
    ])
    const plan = buildSelfHostSmokePlan(options)

    expect(Value.Check(SelfHostSmokePlanSchema, plan)).toBe(true)
    expect(plan.projectPrefix).toBe('instatic-fuma-web-003-focused-test')
    expect(plan.resources).toEqual([
      'instatic-fuma-web-003-focused-test-sqlite',
      'instatic-fuma-web-003-focused-test-sqlite_uploads',
      'instatic-fuma-web-003-focused-test-sqlite_data',
      'instatic-fuma-web-003-focused-test-postgres',
      'instatic-fuma-web-003-focused-test-postgres_uploads',
      'instatic-fuma-web-003-focused-test-postgres_postgres_data',
    ])

    const sqliteStart = plan.steps.find((step) => step.id === 'sqlite-start')
    const postgresStart = plan.steps.find((step) => step.id === 'postgres-start')
    const preflights = plan.steps.filter((step) => step.id.includes('-preflight-'))
    const replacements = plan.steps.filter((step) => step.id.endsWith('-replace'))
    const cleanups = plan.steps.filter((step) => step.id.endsWith('-cleanup'))

    expect(preflights).toHaveLength(6)
    expect(preflights.every((step) => step.command.includes('label=com.docker.compose.project=instatic-fuma-web-003-focused-test-sqlite') || step.command.includes('label=com.docker.compose.project=instatic-fuma-web-003-focused-test-postgres'))).toBe(true)

    expect(sqliteStart?.command.some((value) => value.endsWith('/compose.sqlite.yml'))).toBe(true)
    expect(postgresStart?.command.some((value) => value.endsWith('/compose.sqlite.yml'))).toBe(false)
    expect(replacements).toHaveLength(2)
    expect(replacements.every((step) => step.command.includes('--force-recreate'))).toBe(true)
    expect(replacements.every((step) => step.environment?.INSTATIC_IMAGE === 'instatic:after')).toBe(true)
    expect(cleanups).toHaveLength(2)
    expect(cleanups.every((step) => step.command.includes('--volumes'))).toBe(true)
    expect(plan.steps.some((step) => step.command.includes('docker system prune'))).toBe(false)
  })

  it('defaults replacement to the built image and requires a bundle only for execution', () => {
    const dryRun = parseSelfHostSmokeArgs([
      '--dry-run', '--run-id', 'same-image', '--image', 'instatic:local',
    ])
    expect(dryRun.replacementImage).toBe('instatic:local')
    expect(() => parseSelfHostSmokeArgs([
      '--run-id', 'execute', '--image', 'instatic:local',
    ])).toThrow('--release-bundle is required')
  })

  it('rejects unsafe run IDs, unknown flags, and invalid timeouts at the CLI boundary', () => {
    expect(() => parseSelfHostSmokeArgs(['--dry-run', '--run-id', '../shared'])).toThrow()
    expect(() => parseSelfHostSmokeArgs(['--dry-run', '--timeout-ms', 'NaN'])).toThrow()
    expect(() => parseSelfHostSmokeArgs(['--dry-run', '--keep-volumes'])).toThrow(
      'Unknown self-host smoke option',
    )
  })
})
