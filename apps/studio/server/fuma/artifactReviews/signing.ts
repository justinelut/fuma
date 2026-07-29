import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto'

export interface ArtifactReviewSigner {
  sign(payloadHashSha256: string): Promise<Readonly<{ keyId: string; value: string }>>
  verify(keyId: string, payloadHashSha256: string, value: string): Promise<boolean>
}

function message(payloadHashSha256: string): Buffer {
  if (!/^[a-f0-9]{64}$/.test(payloadHashSha256)) throw new TypeError('Artifact review signature payload hash is invalid.')
  return Buffer.from(`fuma-artifact-review-v1\n${payloadHashSha256}\n`, 'utf8')
}

export class Ed25519ArtifactReviewSigner implements ArtifactReviewSigner {
  readonly #keyId: string
  readonly #privateKey: KeyObject
  readonly #publicKey: KeyObject
  constructor(input: Readonly<{ keyId: string; privateKeyPem: string; publicKeyPem?: string }>) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(input.keyId)) throw new TypeError('Artifact review signing key id is invalid.')
    this.#keyId = input.keyId
    this.#privateKey = createPrivateKey(input.privateKeyPem)
    this.#publicKey = input.publicKeyPem ? createPublicKey(input.publicKeyPem) : createPublicKey(this.#privateKey)
    if (this.#privateKey.asymmetricKeyType !== 'ed25519' || this.#publicKey.asymmetricKeyType !== 'ed25519') throw new TypeError('Artifact review signer requires Ed25519 keys.')
  }
  async sign(payloadHashSha256: string) { return Object.freeze({ keyId: this.#keyId, value: sign(null, message(payloadHashSha256), this.#privateKey).toString('base64url') }) }
  async verify(keyId: string, payloadHashSha256: string, value: string) {
    if (keyId !== this.#keyId || !/^[A-Za-z0-9_-]{32,512}$/.test(value)) return false
    try { return verify(null, message(payloadHashSha256), this.#publicKey, Buffer.from(value, 'base64url')) } catch { return false }
  }
}

export class UnavailableArtifactReviewSigner implements ArtifactReviewSigner {
  async sign(): Promise<never> { throw new Error('Protected artifact review signing is not mounted.') }
  async verify(): Promise<boolean> { return false }
}
