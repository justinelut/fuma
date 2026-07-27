import { compileDiskEditorial } from '../lib/editorial'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const output = path.join(process.cwd(), 'generated', 'editorial-search.json')
const compilation = await compileDiskEditorial()
const serialized = `${JSON.stringify(compilation.searchIndex, null, 2)}\n`
if (process.argv.includes('--check')) {
  const current = await readFile(output, 'utf8').catch(() => '')
  if (current !== serialized) throw new Error('Generated editorial search index is stale. Run bun run editorial:generate.')
  console.log(`Verified ${compilation.searchIndex.length} deterministic public editorial search records.`)
} else {
  await writeFile(output, serialized, 'utf8')
  console.log(`Generated ${compilation.searchIndex.length} public editorial search records.`)
}
