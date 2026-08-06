import { describe, expect, it } from 'bun:test'

const read = (path: string) => Bun.file(new URL(`../../${path}`, import.meta.url)).text()

describe('hosted staff shell viewport', () => {
  it('owns vertical scrolling without weakening the editor root overflow lock', async () => {
    const [global, shellCss, shell] = await Promise.all([
      read('styles/globals.css'),
      read('admin/preauth/HostedStaffShell.module.css'),
      read('admin/preauth/HostedStaffShell.tsx'),
    ])
    expect(global).toContain('html,\nbody,\n#root')
    expect(global).toContain('overflow: hidden')
    expect(shell).toContain('`${panelStyles.page} ${styles.page}`')
    expect(shellCss).toContain('height: 100%')
    expect(shellCss).toContain('min-height: 0')
    expect(shellCss).toContain('overflow-y: auto')
    expect(shellCss).toContain('overflow-x: hidden')
    expect(shellCss).toContain('max-width: 100%')
  })
})
