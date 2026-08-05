import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const root=join(import.meta.dir,'../../..');const read=(path:string)=>readFileSync(join(root,path),'utf8')
describe('Vite platform owner administration',()=>{
 test('routes protected platform operations through AdminEntry before the admin catch-all',()=>{const router=read('src/admin/router.tsx'),entry=read('src/admin/AdminEntry.tsx');expect(router.indexOf('/admin/internal/*')).toBeLessThan(router.indexOf('/admin/*'));expect(entry).toContain('PlatformAdminWorkspace');expect(entry).toContain('platformAdmin')})
 test('uses React, CSS Modules, admin tokens, and no Next or raw Tailwind utilities',()=>{const view=read('src/admin/fuma/platformAdmin/PlatformAdminWorkspace.tsx'),css=read('src/admin/fuma/platformAdmin/PlatformAdminWorkspace.module.css');expect(view).toContain('useEffect');expect(view).toContain('styles.root');expect(view).not.toMatch(/next\/|from ['"]next|className=["'][^"']*(?:p-[0-9]|grid-cols-|text-[a-z])/);for(const token of ['var(--space-lxl)','var(--bg-body)','var(--bg-surface)','var(--border)','var(--accent-1)'])expect(css).toContain(token);expect(css).not.toContain('gradient(')})
 test('never places the private control secret in browser source',()=>{const view=read('src/admin/fuma/platformAdmin/PlatformAdminWorkspace.tsx');expect(view).not.toMatch(/FUMA_CONTROL_RUNTIME_SECRET|x-fuma-control-runtime-secret/)})
})
