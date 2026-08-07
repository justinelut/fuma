import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const root=join(import.meta.dir,'../../..');const read=(path:string)=>readFileSync(join(root,path),'utf8')
describe('Vite platform owner administration',()=>{
 test('routes protected platform operations through AdminEntry before the admin catch-all',()=>{const router=read('src/admin/router.tsx'),entry=read('src/admin/AdminEntry.tsx');expect(router.indexOf('/admin/internal/*')).toBeLessThan(router.indexOf('/admin/*'));expect(entry).toContain('PlatformAdminWorkspace');expect(entry).toContain('platformAdmin')})
 test('uses React, semantic design tokens, and no Next',()=>{const view=read('src/admin/fuma/platformAdmin/PlatformAdminWorkspace.tsx');expect(view).toContain('useEffect');/* The workspace is Tailwind now. It must still avoid Next and must still express colour through the
   design system rather than arbitrary values, which is what the token assertions below become. */
expect(view).not.toContain('module.css');expect(view).not.toMatch(/next\/|from ['"]next/);expect(view).not.toMatch(/className=["'][^"']*#[0-9a-f]{3,8}/i);/* The stylesheet named theme variables directly; the semantic shadcn classes below resolve to the
   same variables, so colour still cannot be introduced outside the design system. */
for(const token of ['bg-background','bg-card','border-border','text-primary','text-muted-foreground'])expect(view,token).toContain(token);expect(view).not.toMatch(/gradient\(/i)})
 test('never places the private control secret in browser source',()=>{const view=read('src/admin/fuma/platformAdmin/PlatformAdminWorkspace.tsx');expect(view).not.toMatch(/FUMA_CONTROL_RUNTIME_SECRET|x-fuma-control-runtime-secret/)})
})
