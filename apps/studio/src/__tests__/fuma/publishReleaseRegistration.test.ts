import { describe, expect, it } from 'bun:test'
import {
  AtomicPublishWorker,
  PUBLISH_RELEASE_JOB_KIND,
  PublishWorkerError,
  publishWorkerRegistration,
} from '../../../server/fuma/publishing'

const scope = {
  platformId: 'platform-1',
  organizationId: 'organization-1',
  workspaceId: 'workspace-1',
  siteId: 'site-1',
  ownerKey: 'owner-1',
  generation: 1,
  state: 'active' as const,
  transferFence: null,
}

function worker(): AtomicPublishWorker {
  return new AtomicPublishWorker({
    snapshots: {} as never,
    renderer: {} as never,
    storage: {} as never,
    releases: {} as never,
    attempts: {} as never,
  })
}

describe('FUMA-049 central durable job registration', () => {
  it('registers exactly fuma.publish-release through the trusted scoped handler map', () => {
    const handlers = publishWorkerRegistration(worker())
    expect(Object.keys(handlers)).toEqual([PUBLISH_RELEASE_JOB_KIND])
    expect(typeof handlers[PUBLISH_RELEASE_JOB_KIND]).toBe('function')
  })

  it('rejects organization jobs before invoking publish dependencies', async () => {
    const handler = publishWorkerRegistration(worker())[PUBLISH_RELEASE_JOB_KIND]
    await expect(handler!({
      jobContext: { kind: 'organization' },
      repositoryScope: null,
      siteRepository: null,
    } as never)).rejects.toMatchObject({ code: 'invalid-authority' })
  })

  it('rejects payload tenant-coordinate substitution through strict TypeBox parsing', async () => {
    const handler = publishWorkerRegistration(worker())[PUBLISH_RELEASE_JOB_KIND]
    await expect(handler!({
      jobContext: { kind: 'site', profile: { id: 'website' } },
      repositoryScope: scope,
      siteRepository: {},
      job: {
        id: 'job-1',
        payload: {
          releaseId: 'release-1',
          sourceSnapshotId: 'snapshot-1',
          sourceSnapshotHashSha256: 'a'.repeat(64),
          auditCorrelationId: 'audit-1',
          organizationId: 'attacker-organization',
        },
      },
      fence: '1',
      async cancellationRequested() { return false },
      async readDurableResult() { return null },
      async commitDurableResult() { throw new Error('must not commit') },
    } as never)).rejects.toBeInstanceOf(PublishWorkerError)
  })
})
