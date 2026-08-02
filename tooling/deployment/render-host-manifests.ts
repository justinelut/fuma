import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { createFumaDeploymentProfile } from '../../packages/brand/src/index'

const ROOT = resolve(import.meta.dir, '../..')
const FILES = [
  'infra/fuma-phase-13-18/k3s/workloads.yaml',
  'infra/fuma-phase-13-18/k3s/traefik-routes.yaml',
  'infra/fuma-phase-13-18/ops/smoke-targets.template.json',
  'infra/public-web/composition.json',
  'infra/public-web/traefik.public-web.yml',
] as const

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required.`)
  return value
}

const outputDirectory = process.argv[2]
if (!outputDirectory) throw new Error('Usage: bun tooling/deployment/render-host-manifests.ts <output-directory>')

const workloads = readFileSync(join(ROOT, FILES[0]), 'utf8')
const declared = /^\s*FUMA_DEPLOYMENT_ROOT_DOMAIN:\s*["']?([^\s"']+)["']?\s*$/m.exec(workloads)?.[1]
if (!declared) throw new Error('The checked workload snapshot must declare exactly one deployment root.')

const source = createFumaDeploymentProfile(declared)
const target = createFumaDeploymentProfile(required('FUMA_DEPLOYMENT_ROOT_DOMAIN'))
const plainPairs = [
  [source.hosts.templatePreview, target.hosts.templatePreview],
  [source.hosts.customerRouting, target.hosts.customerRouting],
  [source.hosts.redirect, target.hosts.redirect],
  [source.hosts.auth, target.hosts.auth],
  [source.hosts.product, target.hosts.product],
  [source.hosts.console, target.hosts.console],
  [source.hosts.status, target.hosts.status],
  [source.rootDomain, target.rootDomain],
] as const
const escaped = (value: string) => value.replaceAll('.', '\\\\.')
const escapedPairs = plainPairs.map(([from, to]) => [escaped(from), escaped(to)] as const)

function render(sourceText: string): string {
  let output = sourceText
  for (const [from, to] of escapedPairs) output = output.replaceAll(from, to)
  for (const [from, to] of plainPairs) output = output.replaceAll(from, to)
  if (source.rootDomain !== target.rootDomain && output.includes(source.rootDomain)) {
    throw new Error('A source deployment host remained after manifest rendering.')
  }
  return output
}

const destination = resolve(outputDirectory)
mkdirSync(destination, { recursive: true })
for (const relativePath of FILES) {
  const output = render(readFileSync(join(ROOT, relativePath), 'utf8'))
  writeFileSync(join(destination, basename(relativePath)), output)
}
writeFileSync(join(destination, 'deployment-profile.json'), `${JSON.stringify(target, null, 2)}\n`)
console.log(JSON.stringify({ rootDomain: target.rootDomain, outputDirectory: destination, files: FILES.length }))
