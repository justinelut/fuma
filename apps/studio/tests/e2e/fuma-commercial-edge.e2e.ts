import {expect,test} from '@playwright/test'

const STUDIO='https://5174.blyss.co.ke'
const PUBLIC='https://3002.blyss.co.ke'

test.describe('FUMA-048–062 commercial edge browser acceptance',()=>{
 test('Studio exposes separated usage, billing, domain, and publication-payment surfaces without secrets',async({page})=>{await page.goto(`${STUDIO}/admin/settings/usage`);await expect(page.getByRole('heading',{name:/usage|quota/i})).toBeVisible();await page.goto(`${STUDIO}/admin/settings/billing`);await expect(page.getByText(/setup fee/i)).toBeVisible();await expect(page.getByText(/recurring/i)).toBeVisible();await page.goto(`${STUDIO}/admin/settings/domains`);await expect(page.getByText(/DNS records/i)).toBeVisible();await expect(page.getByText(/Cloudflare API token/i)).toHaveCount(0);await page.goto(`${STUDIO}/admin/publication/payments`);await expect(page.getByText(/manual renewal/i)).toBeVisible();await expect(page.getByText(/Daraja/i)).toHaveCount(0)})
 test('public web fails an unknown host closed and does not render a default tenant',async({request})=>{const response=await request.get(`${PUBLIC}/__fuma/edge-probe`,{headers:{host:'unknown.fuma.co.ke'}});expect([404,421]).toContain(response.status());expect(await response.text()).not.toContain('default site')})
 test('customer DNS onboarding requires exact records but no Cloudflare account or token',async({page})=>{await page.goto(`${STUDIO}/admin/settings/domains/new`);await expect(page.getByText(/retain.*authoritative DNS/i)).toBeVisible();await expect(page.getByText(/CNAME|TXT/)).toBeVisible();await expect(page.getByText(/Cloudflare account required/i)).toHaveCount(0)})
})
