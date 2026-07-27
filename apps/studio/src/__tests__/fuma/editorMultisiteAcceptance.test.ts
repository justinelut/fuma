import { describe, expect, it } from 'bun:test'
import { runFumaEditorMultisiteAcceptance } from '../../../tests/e2e/fixtures/fumaEditorSessionHarness'

describe('FUMA-027 multi-site editor acceptance', () => {
  it('isolates colliding Website/Publication resources through exported APIs', async () => {
    const evidence = await runFumaEditorMultisiteAcceptance()

    expect(evidence.persistedSiteNames).toEqual({
      website: 'Website edited',
      publication: 'Publication edited',
    })
    expect(evidence.collidingLogicalIdsHaveDistinctKeys).toBe(true)
    expect(evidence.websiteSurfaceIds).toEqual([
      'editor.pages',
      'editor.design',
      'editor.settings',
      'editor.media',
      'editor.import',
      'editor.publish',
    ])
    expect(evidence.publicationSurfaceIds).toEqual([
      'editor.pages',
      'editor.design',
      'editor.settings',
      'editor.import',
      'editor.publish',
    ])
  })

  it('keeps independent tabs and stale operations isolated', async () => {
    const evidence = await runFumaEditorMultisiteAcceptance()

    expect(evidence.independentTabHistory).toBe(true)
    expect(evidence.independentTabImportState).toBe(true)
    expect(evidence.staleLoadStayedOnPublication).toBe(true)
  })
})
