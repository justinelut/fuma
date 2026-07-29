import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const app = join(root, 'apps/site-runtime')
const standalone = join(app, '.next/standalone/apps/site-runtime')
const sourceStatic = join(app, '.next/static')
const targetStatic = join(standalone, '.next/static')

if (!existsSync(join(standalone, 'server.js')) || !existsSync(sourceStatic)) {
  throw new Error('SITE runtime standalone build and static assets must exist before assembly.')
}
rmSync(targetStatic, { recursive: true, force: true })
mkdirSync(join(standalone, '.next'), { recursive: true })
cpSync(sourceStatic, targetStatic, { recursive: true, errorOnExist: true })

const sourcePublic = join(app, 'public')
const targetPublic = join(standalone, 'public')
rmSync(targetPublic, { recursive: true, force: true })
if (existsSync(sourcePublic)) cpSync(sourcePublic, targetPublic, { recursive: true, errorOnExist: true })
