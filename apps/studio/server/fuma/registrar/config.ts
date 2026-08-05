export type HostedRegistrarConfig = Readonly<{
  gatewayOrigin: string
  apiToken: string
  credentialId: string
  credentialCreatedAt: string
}>

export function readHostedRegistrarConfig(
  env: Readonly<Record<string, unknown>> = process.env,
): HostedRegistrarConfig | null {
  const raw = [
    env.FUMA_REGISTRAR_GATEWAY_ORIGIN,
    env.FUMA_REGISTRAR_API_TOKEN,
    env.FUMA_REGISTRAR_CREDENTIAL_ID,
    env.FUMA_REGISTRAR_CREDENTIAL_CREATED_AT,
  ]
  const values = raw.map((value) => typeof value === 'string' ? value.trim() : '')
  if (values.every((value) => value === '')) return null
  if (values.some((value) => value === '')) throw new TypeError('Registrar gateway configuration must be provided all-or-none.')
  const [gatewayOrigin, apiToken, credentialId, credentialCreatedAt] = values as [string, string, string, string]
  const url = new URL(gatewayOrigin)
  if (url.protocol !== 'https:' || url.origin !== gatewayOrigin || url.username || url.password) {
    throw new TypeError('Registrar gateway origin must be an exact HTTPS origin.')
  }
  if (Buffer.byteLength(apiToken, 'utf8') < 16 || Buffer.byteLength(apiToken, 'utf8') > 4096) {
    throw new TypeError('Registrar API token is invalid.')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(credentialId)) {
    throw new TypeError('Registrar credential identity is invalid.')
  }
  if (!Number.isFinite(Date.parse(credentialCreatedAt)) || new Date(credentialCreatedAt).toISOString() !== credentialCreatedAt) {
    throw new TypeError('Registrar credential creation time is invalid.')
  }
  return Object.freeze({ gatewayOrigin, apiToken, credentialId, credentialCreatedAt })
}
