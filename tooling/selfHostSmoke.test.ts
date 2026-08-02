import { describe, expect, it } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import {
  SelfHostSmokePlanSchema,
  buildSelfHostSmokePlan,
  parseSelfHostSmokeArgs,
} from './selfHostSmoke'

describe('FUMA-WEB-003 self-host smoke plan', () => {
  it('builds one isolated PostgreSQL lifecycle without invoking Docker', () => {
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
      'instatic-fuma-web-003-focused-test-postgres',
      'instatic-fuma-web-003-focused-test-postgres_uploads',
      'instatic-fuma-web-003-focused-test-postgres_postgres_data',
    ])

    expect(plan.steps.map((step) => step.id)).toEqual([
      'release-bundle-list',
      'initial-image-inspect',
      'replacement-image-inspect',
      'postgres-preflight-containers',
      'postgres-preflight-volumes',
      'postgres-preflight-networks',
      'postgres-start',
      'postgres-restart',
      'postgres-replace',
      'postgres-cleanup',
    ])

    const postgresStart = plan.steps.find((step) => step.id === 'postgres-start')
    const preflights = plan.steps.filter((step) => step.id.includes('-preflight-'))
    const replacements = plan.steps.filter((step) => step.id.endsWith('-replace'))
    const cleanups = plan.steps.filter((step) => step.id.endsWith('-cleanup'))

    expect(preflights).toHaveLength(3)
    expect(preflights.every((step) => step.command.includes('label=com.docker.compose.project=instatic-fuma-web-003-focused-test-postgres'))).toBe(true)
    expect(postgresStart?.command.some((value) => value.endsWith('/compose.prod.yml'))).toBe(true)
    expect(postgresStart?.command).toContain('<temporary-smoke-override.yml>')
    expect(JSON.stringify(plan)).not.toContain('compose.sqlite.yml')
    expect(JSON.stringify(plan)).not.toContain('sqlite')
    expect(plan.steps.every((step) => !('dialect' in step))).toBe(true)
    expect(replacements).toHaveLength(1)
    expect(replacements[0]?.command).toContain('--force-recreate')
    expect(replacements[0]?.environment?.INSTATIC_IMAGE).toBe('instatic:after')
    expect(cleanups).toHaveLength(1)
    expect(cleanups[0]?.command).toContain('--volumes')
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
