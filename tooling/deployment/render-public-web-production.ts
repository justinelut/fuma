import { createFumaDeploymentProfile } from '../../packages/brand/src/index'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const TEMPLATE = resolve(ROOT, 'infra/fuma-phase-13-18/k3s/public-web-production.template.yaml')
const IMAGE_PATTERN = /^ghcr\.io\/[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?\/[a-z0-9][a-z0-9._-]*(?:@sha256:[a-f0-9]{64}|:[a-zA-Z0-9][a-zA-Z0-9._-]{0,127})$/
const SHA_PATTERN = /^[a-f0-9]{40}$/

const [outputPath, image, sourceSha] = process.argv.slice(2)
const profile = createFumaDeploymentProfile(process.env.FUMA_DEPLOYMENT_ROOT_DOMAIN)
if (!outputPath) throw new TypeError('Output path is required.')
if (!image || !IMAGE_PATTERN.test(image)) throw new TypeError('An immutable GHCR public-Web image is required.')
if (!sourceSha || !SHA_PATTERN.test(sourceSha)) throw new TypeError('An exact 40-character source SHA is required.')

const replacements: Readonly<Record<string, string>> = Object.freeze({
  __FUMA_ROOT_DOMAIN__: profile.rootDomain,
  __FUMA_ESCAPED_ROOT_DOMAIN__: profile.rootDomain.replaceAll('.', '\\\\.'),
  __FUMA_PUBLIC_WEB_IMAGE__: image,
  __FUMA_SOURCE_SHA__: sourceSha,
})

let rendered = readFileSync(TEMPLATE, 'utf8')
for (const [needle, value] of Object.entries(replacements)) rendered = rendered.replaceAll(needle, value)
if (/__FUMA_[A-Z_]+__/.test(rendered)) throw new Error('Public-Web manifest contains unresolved placeholders.')
if (rendered.includes('fuma.co.ke')) throw new Error('Public-Web manifest contains a stale deployment host.')

const destination = resolve(outputPath)
mkdirSync(dirname(destination), { recursive: true })
writeFileSync(destination, rendered, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ output: destination, rootDomain: profile.rootDomain, image, sourceSha }))
