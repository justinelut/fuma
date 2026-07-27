import { expect, test } from 'bun:test'
import {
  BunS3ObjectStorageTransport,
  FumaObjectStorage,
  sha256Hex,
  type ObjectTenantScope,
} from '../../../server/fuma/objectStorage'

const RUN_REAL_CONTRACT = process.env.FUMA_OBJECT_STORAGE_CONTRACT === '1'
const contractTest = RUN_REAL_CONTRACT ? test : test.skip

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required when FUMA_OBJECT_STORAGE_CONTRACT=1`)
  return value
}

contractTest('FUMA-008 real MinIO/S3 object contract', async () => {
  const endpoint = requiredEnvironment('FUMA_MINIO_ENDPOINT')
  const accessKeyId = requiredEnvironment('FUMA_MINIO_ACCESS_KEY_ID')
  const secretAccessKey = requiredEnvironment('FUMA_MINIO_SECRET_ACCESS_KEY')
  const bucket = requiredEnvironment('FUMA_MINIO_BUCKET')
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const tenantA: ObjectTenantScope = {
    organizationId: `contract-a-${runId}`,
    workspaceId: 'workspace',
    siteId: 'site',
  }
  const tenantB: ObjectTenantScope = {
    organizationId: `contract-b-${runId}`,
    workspaceId: 'workspace',
    siteId: 'site',
  }
  const transport = new BunS3ObjectStorageTransport({
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    region: process.env.FUMA_S3_REGION,
  })
  const store = new FumaObjectStorage({
    transport,
    policy: {
      allowedMimeTypes: ['text/plain', 'application/octet-stream'],
      maxObjectBytes: 16 * 1024 * 1024,
      maxTenantBytes: 32 * 1024 * 1024,
      multipartPartBytes: 5 * 1024 * 1024,
      maxSignedUrlTtlSeconds: 60,
    },
    signingSecret: 'real-contract-only-signing-secret-at-least-32-bytes',
    accessUrlBase: 'https://app.fuma.test/_fuma/objects/access',
  })
  const singleKey = `contract/${runId}/single.txt`
  const multipartKey = `contract/${runId}/multipart.bin`

  try {
    const single = new TextEncoder().encode('real MinIO/S3 contract')
    await store.put({
      scope: tenantA,
      key: singleKey,
      bytes: single,
      mimeType: 'text/plain',
      checksumSha256: sha256Hex(single),
    })
    await store.put({
      scope: tenantB,
      key: singleKey,
      bytes: new TextEncoder().encode('tenant B'),
      mimeType: 'text/plain',
      checksumSha256: sha256Hex(new TextEncoder().encode('tenant B')),
    })

    expect(await store.get(tenantA, singleKey)).toEqual(single)
    await expect(store.get(tenantA, `contract/${runId}/tenant-b-only.txt`)).rejects.toMatchObject({ code: 'not_found' })
    await expect(store.put({
      scope: tenantA,
      key: singleKey,
      bytes: single,
      mimeType: 'text/plain',
      checksumSha256: sha256Hex(single),
    })).rejects.toMatchObject({ code: 'already_exists' })

    const partOne = new Uint8Array(5 * 1024 * 1024)
    const partTwo = new Uint8Array([0, 1, 2, 3])
    const whole = new Uint8Array(partOne.byteLength + partTwo.byteLength)
    whole.set(partOne)
    whole.set(partTwo, partOne.byteLength)
    const upload = await store.beginMultipart({
      scope: tenantA,
      key: multipartKey,
      mimeType: 'application/octet-stream',
      sizeBytes: whole.byteLength,
      checksumSha256: sha256Hex(whole),
    })
    await upload.uploadPart({ partNumber: 1, bytes: partOne, checksumSha256: sha256Hex(partOne) })
    await upload.uploadPart({ partNumber: 2, bytes: partTwo, checksumSha256: sha256Hex(partTwo) })
    await upload.complete()
    expect(await store.get(tenantA, multipartKey)).toEqual(whole)

    const signed = await store.createSignedUrl({ scope: tenantA, key: singleKey, purpose: 'download', ttlSeconds: 30 })
    const redeemed = await store.redeemSignedUrl(signed.url, 'download')
    const response = await fetch(redeemed.providerUrl)
    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(single)
    await expect(store.redeemSignedUrl(signed.url, 'preview')).rejects.toMatchObject({ code: 'wrong_url_purpose' })

    const listed = await store.list(tenantA, `contract/${runId}`)
    expect(listed.objects.map((object) => object.key)).toEqual([multipartKey, singleKey])
  } finally {
    await Promise.all([
      store.delete(tenantA, singleKey),
      store.delete(tenantA, multipartKey),
      store.delete(tenantB, singleKey),
    ])
  }
}, 60_000)
