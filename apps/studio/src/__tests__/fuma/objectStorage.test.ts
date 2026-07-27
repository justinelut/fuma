import { describe, expect, it } from 'bun:test'
import {
  FakeObjectStorageTransport,
  FumaObjectStorage,
  detectMimeType,
  physicalObjectKey,
  sha256Hex,
  type ObjectStoragePolicy,
  type ObjectTenantScope,
} from '../../../server/fuma/objectStorage'
import { FumaFakeClock } from '../helpers/fuma/fakeClock'

const TENANT_A: ObjectTenantScope = {
  organizationId: 'org-a',
  workspaceId: 'workspace-shared',
  siteId: 'site-shared',
}
const TENANT_B: ObjectTenantScope = {
  organizationId: 'org-b',
  workspaceId: 'workspace-shared',
  siteId: 'site-shared',
}
const POLICY: ObjectStoragePolicy = {
  allowedMimeTypes: ['text/plain', 'application/json', 'image/png'],
  maxObjectBytes: 24,
  maxTenantBytes: 32,
  multipartPartBytes: 4,
  maxSignedUrlTtlSeconds: 60,
}
const SIGNING_SECRET = 'fuma-object-contract-signing-secret-at-least-32-bytes'

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function createFixture(clock = new FumaFakeClock('2040-01-01T00:00:00.000Z')): {
  clock: FumaFakeClock
  transport: FakeObjectStorageTransport
  store: FumaObjectStorage
} {
  const transport = new FakeObjectStorageTransport(() => clock.nowMs())
  return {
    clock,
    transport,
    store: new FumaObjectStorage({
      transport,
      policy: POLICY,
      signingSecret: SIGNING_SECRET,
      accessUrlBase: 'https://app.fuma.test/_fuma/objects/access',
      nowMs: () => clock.nowMs(),
    }),
  }
}

async function putText(store: FumaObjectStorage, scope: ObjectTenantScope, key: string, value: string) {
  const body = bytes(value)
  return store.put({
    scope,
    key,
    bytes: body,
    mimeType: 'text/plain',
    checksumSha256: sha256Hex(body),
  })
}

describe('FUMA-008 deterministic object storage contract', () => {
  it('detects immutable HTML and CSS artifacts without treating arbitrary text as either format', () => {
    expect(detectMimeType(bytes('<!doctype html><html><body>Fuma</body></html>'))).toBe('text/html')
    expect(detectMimeType(bytes('h1{color:#123456}'))).toBe('text/css')
    expect(detectMimeType(bytes('@import url("theme.css");'))).toBe('text/css')
    expect(detectMimeType(bytes('const value = { unsafe: true }'))).toBe('text/plain')
    expect(detectMimeType(bytes('<script>alert(1)</script>'))).toBe('text/plain')
  })

  it('prefixes equal logical keys by full tenant scope and denies cross-prefix reads', async () => {
    const { store, transport } = createFixture()
    await putText(store, TENANT_A, 'media/logo.txt', 'tenant A')
    await putText(store, TENANT_B, 'media/logo.txt', 'tenant B')

    expect(new TextDecoder().decode(await store.get(TENANT_A, 'media/logo.txt'))).toBe('tenant A')
    expect(new TextDecoder().decode(await store.get(TENANT_B, 'media/logo.txt'))).toBe('tenant B')
    expect(transport.physicalKeys()).toContain(physicalObjectKey(TENANT_A, 'media/logo.txt'))
    expect(transport.physicalKeys()).toContain(physicalObjectKey(TENANT_B, 'media/logo.txt'))

    await expect(store.get(TENANT_A, 'media/only-b.txt')).rejects.toMatchObject({ code: 'not_found' })
    await putText(store, TENANT_B, 'media/only-b.txt', 'private')
    await expect(store.get(TENANT_A, 'media/only-b.txt')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('round-trips immutable put/get/head/list/delete with SHA-256 metadata', async () => {
    const { store } = createFixture()
    const body = bytes('hello')
    const checksumSha256 = sha256Hex(body)
    const created = await store.put({
      scope: TENANT_A,
      key: 'documents/hello.txt',
      bytes: body,
      mimeType: 'text/plain',
      checksumSha256,
    })

    expect(created).toEqual({
      key: 'documents/hello.txt',
      sizeBytes: 5,
      mimeType: 'text/plain',
      checksumSha256,
      createdAt: '2040-01-01T00:00:00.000Z',
    })
    expect(await store.get(TENANT_A, 'documents/hello.txt')).toEqual(body)
    expect(await store.head(TENANT_A, 'documents/hello.txt')).toEqual(created)
    expect(await store.list(TENANT_A, 'documents')).toEqual({ objects: [created], totalBytes: 5 })

    await store.delete(TENANT_A, 'documents/hello.txt')
    await store.delete(TENANT_A, 'documents/hello.txt')
    await expect(store.head(TENANT_A, 'documents/hello.txt')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects overwrite, whole-object checksum mismatch, MIME mismatch, and disallowed MIME', async () => {
    const { store } = createFixture()
    await putText(store, TENANT_A, 'immutable.txt', 'first')
    await expect(putText(store, TENANT_A, 'immutable.txt', 'second')).rejects.toMatchObject({ code: 'already_exists' })
    expect(new TextDecoder().decode(await store.get(TENANT_A, 'immutable.txt'))).toBe('first')

    const text = bytes('checksum')
    await expect(store.put({
      scope: TENANT_A,
      key: 'bad-checksum.txt',
      bytes: text,
      mimeType: 'text/plain',
      checksumSha256: '0'.repeat(64),
    })).rejects.toMatchObject({ code: 'checksum_mismatch' })

    await expect(store.put({
      scope: TENANT_A,
      key: 'fake.png',
      bytes: text,
      mimeType: 'image/png',
      checksumSha256: sha256Hex(text),
    })).rejects.toMatchObject({ code: 'mime_mismatch' })

    await expect(store.put({
      scope: TENANT_A,
      key: 'binary.bin',
      bytes: new Uint8Array([0, 1, 2]),
      mimeType: 'application/octet-stream',
      checksumSha256: sha256Hex(new Uint8Array([0, 1, 2])),
    })).rejects.toMatchObject({ code: 'mime_not_allowed' })
  })

  it('rejects oversized objects and tenant quota overflow without writing partial objects', async () => {
    const { store } = createFixture()
    const oversized = bytes('x'.repeat(25))
    await expect(store.put({
      scope: TENANT_A,
      key: 'oversized.txt',
      bytes: oversized,
      mimeType: 'text/plain',
      checksumSha256: sha256Hex(oversized),
    })).rejects.toMatchObject({ code: 'object_too_large' })

    await putText(store, TENANT_A, 'one.txt', 'a'.repeat(20))
    await expect(putText(store, TENANT_A, 'two.txt', 'b'.repeat(13))).rejects.toMatchObject({ code: 'quota_exceeded' })
    expect((await store.list(TENANT_A)).objects.map((object) => object.key)).toEqual(['one.txt'])
    await putText(store, TENANT_B, 'two.txt', 'b'.repeat(13))
  })

  it('rejects traversal, encoded traversal, absolute paths, reserved physical prefixes, and malformed scope', async () => {
    const { store } = createFixture()
    const hostileKeys = [
      '../secret.txt',
      'safe/../../secret.txt',
      '/absolute.txt',
      'safe\\secret.txt',
      'safe/%2e%2e/secret.txt',
      'organizations/org-b/workspaces/x/sites/y/objects/secret.txt',
      'double//slash.txt',
      'trailing/',
    ]
    for (const key of hostileKeys) {
      const promise = putText(store, TENANT_A, key, 'hostile')
      await expect(promise).rejects.toMatchObject({ code: 'invalid_key' })
    }
    await expect(putText(store, { ...TENANT_A, organizationId: '../org-b' }, 'safe.txt', 'hostile'))
      .rejects.toMatchObject({ code: 'invalid_scope' })
  })

  it('implements ordered multipart upload with per-part and whole-object checksums', async () => {
    const { store } = createFixture()
    const first = bytes('abcd')
    const second = bytes('ef')
    const whole = bytes('abcdef')
    const upload = await store.beginMultipart({
      scope: TENANT_A,
      key: 'multipart/value.txt',
      mimeType: 'text/plain',
      sizeBytes: whole.byteLength,
      checksumSha256: sha256Hex(whole),
    })

    await expect(upload.uploadPart({
      partNumber: 2,
      bytes: first,
      checksumSha256: sha256Hex(first),
    })).rejects.toMatchObject({ code: 'invalid_multipart' })
    await expect(upload.uploadPart({
      partNumber: 1,
      bytes: first,
      checksumSha256: '0'.repeat(64),
    })).rejects.toMatchObject({ code: 'checksum_mismatch' })

    await upload.uploadPart({ partNumber: 1, bytes: first, checksumSha256: sha256Hex(first) })
    await upload.uploadPart({ partNumber: 2, bytes: second, checksumSha256: sha256Hex(second) })
    const metadata = await upload.complete()
    expect(metadata.checksumSha256).toBe(sha256Hex(whole))
    expect(await store.get(TENANT_A, 'multipart/value.txt')).toEqual(whole)
    await expect(putText(store, TENANT_A, 'multipart/value.txt', 'overwrite')).rejects.toMatchObject({ code: 'already_exists' })
  })

  it('aborts multipart state on whole checksum, MIME, size, and non-final short-part failure', async () => {
    const { store, transport } = createFixture()
    const body = bytes('abcdef')
    const wrongAtCompletion = await store.beginMultipart({
      scope: TENANT_A,
      key: 'multipart/wrong-at-completion.txt',
      mimeType: 'text/plain',
      sizeBytes: body.byteLength,
      checksumSha256: sha256Hex(bytes('ghijkl')),
    })
    await wrongAtCompletion.uploadPart({ partNumber: 1, bytes: bytes('abcd'), checksumSha256: sha256Hex(bytes('abcd')) })
    await wrongAtCompletion.uploadPart({ partNumber: 2, bytes: bytes('ef'), checksumSha256: sha256Hex(bytes('ef')) })
    await expect(wrongAtCompletion.complete()).rejects.toMatchObject({ code: 'checksum_mismatch' })

    const wrongMime = await store.beginMultipart({
      scope: TENANT_A,
      key: 'multipart/wrong-mime.png',
      mimeType: 'image/png',
      sizeBytes: body.byteLength,
      checksumSha256: sha256Hex(body),
    })
    await wrongMime.uploadPart({ partNumber: 1, bytes: bytes('abcd'), checksumSha256: sha256Hex(bytes('abcd')) })
    await wrongMime.uploadPart({ partNumber: 2, bytes: bytes('ef'), checksumSha256: sha256Hex(bytes('ef')) })
    await expect(wrongMime.complete()).rejects.toMatchObject({ code: 'mime_mismatch' })

    const wrongSize = await store.beginMultipart({
      scope: TENANT_A,
      key: 'multipart/wrong-size.txt',
      mimeType: 'text/plain',
      sizeBytes: 7,
      checksumSha256: sha256Hex(body),
    })
    await wrongSize.uploadPart({ partNumber: 1, bytes: bytes('abcd'), checksumSha256: sha256Hex(bytes('abcd')) })
    await wrongSize.uploadPart({ partNumber: 2, bytes: bytes('ef'), checksumSha256: sha256Hex(bytes('ef')) })
    await expect(wrongSize.complete()).rejects.toMatchObject({ code: 'invalid_multipart' })

    const short = await store.beginMultipart({
      scope: TENANT_A,
      key: 'multipart/short.txt',
      mimeType: 'text/plain',
      sizeBytes: 4,
      checksumSha256: sha256Hex(bytes('abcd')),
    })
    await short.uploadPart({ partNumber: 1, bytes: bytes('ab'), checksumSha256: sha256Hex(bytes('ab')) })
    await expect(short.uploadPart({ partNumber: 2, bytes: bytes('cd'), checksumSha256: sha256Hex(bytes('cd')) }))
      .rejects.toMatchObject({ code: 'invalid_multipart' })
    await short.abort()

    expect(transport.physicalKeys().some((key) => key.includes('wrong-at-completion') || key.includes('short.txt'))).toBe(false)
  })

  it('mints short-lived signed URLs that reject tampering, wrong purpose, and expiry', async () => {
    const { store, clock } = createFixture()
    await putText(store, TENANT_A, 'signed.txt', 'signed content')
    const signed = await store.createSignedUrl({
      scope: TENANT_A,
      key: 'signed.txt',
      purpose: 'preview',
      ttlSeconds: 10,
    })

    const redeemed = await store.redeemSignedUrl(signed.url, 'preview')
    expect(redeemed.method).toBe('GET')
    expect(redeemed.expiresAt).toBe(signed.expiresAt)
    expect(new URL(redeemed.providerUrl).searchParams.get('key')).toBe(physicalObjectKey(TENANT_A, 'signed.txt'))
    await expect(store.redeemSignedUrl(signed.url, 'download')).rejects.toMatchObject({ code: 'wrong_url_purpose' })

    const tampered = new URL(signed.url)
    tampered.searchParams.set('token', `${tampered.searchParams.get('token')}x`)
    await expect(store.redeemSignedUrl(tampered.toString(), 'preview')).rejects.toMatchObject({ code: 'invalid_signed_url' })

    clock.advance(10_000)
    await expect(store.redeemSignedUrl(signed.url, 'preview')).rejects.toMatchObject({ code: 'expired_signed_url' })
    await expect(store.createSignedUrl({ scope: TENANT_A, key: 'signed.txt', purpose: 'download', ttlSeconds: 61 }))
      .rejects.toMatchObject({ code: 'invalid_signed_url' })
  })
})
