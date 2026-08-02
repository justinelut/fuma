import type { SiteApplicationContext, SiteApplicationSnapshot } from './contracts'

export function sameApplicationRealm(left: SiteApplicationContext, right: SiteApplicationContext): boolean {
  return left.cacheIdentity.host === right.cacheIdentity.host
    && left.cacheIdentity.siteId === right.cacheIdentity.siteId
    && left.cacheIdentity.ownerKey === right.cacheIdentity.ownerKey
    && left.cacheIdentity.ownerGeneration === right.cacheIdentity.ownerGeneration
    && left.member.memberId === right.member.memberId
    && left.member.sessionId === right.member.sessionId
}

export function mergeApplicationSeed(current: SiteApplicationContext | null, next: SiteApplicationContext): SiteApplicationContext {
  if (!current || !sameApplicationRealm(current, next) || next.snapshot.version > current.snapshot.version) return next
  return Object.freeze({ ...next, snapshot: current.snapshot })
}

export function optimisticApplicationSnapshot(previous: SiteApplicationSnapshot, candidate: SiteApplicationSnapshot): SiteApplicationSnapshot {
  return Object.freeze({ ...candidate, version: previous.version + 1 })
}

export function rollbackApplicationSnapshot(
  current: SiteApplicationContext | null,
  authority: SiteApplicationContext,
  optimisticVersion: number,
  previous: SiteApplicationSnapshot,
): SiteApplicationContext | null {
  return current && sameApplicationRealm(current, authority) && current.snapshot.version === optimisticVersion
    ? Object.freeze({ ...current, snapshot: previous })
    : current
}
