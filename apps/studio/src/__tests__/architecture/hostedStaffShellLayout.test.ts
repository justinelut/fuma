import { describe, expect, it } from 'bun:test'

const read = (path: string) => Bun.file(new URL(`../../${path}`, import.meta.url)).text()

describe('hosted staff shell viewport', () => {
  it('owns vertical scrolling without weakening the editor root overflow lock', async () => {
    // The shell moved to Tailwind (everything outside the visual builder does), so these rules now
    // live as utilities on the element rather than in a stylesheet. The PROPERTY is unchanged and is
    // what still matters: the app root is overflow-hidden for the editor, so the hosted shell has to
    // own vertical scrolling itself or its content becomes unreachable.
    const [global, shell] = await Promise.all([
      read('styles/globals.css'),
      read('admin/preauth/HostedStaffShell.tsx'),
    ])
    expect(global).toContain('html,\nbody,\n#root')
    expect(global).toContain('overflow: hidden')
    expect(shell).not.toContain('module.css')
    for (const utility of ['h-full', 'min-h-0', 'overflow-y-auto', 'overflow-x-hidden', 'max-w-full']) {
      expect(shell, utility).toContain(utility)
    }
  })
})
