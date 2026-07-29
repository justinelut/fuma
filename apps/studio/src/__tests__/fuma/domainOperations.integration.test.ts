import{describe,expect,it}from'bun:test'
import{Value}from'@core/utils/typeboxHelpers'
import{DomainTransferJobPayloadSchema,DOMAIN_TRANSFER_JOB_KIND}from'../../../server/fuma/domainOperations/jobs'
import{createDomainOperationsScopedRoutes}from'../../../server/fuma/domainOperations/routes'
import{onboard,scope}from'./domainOperationsTestFixture'
describe('FUMA-062 local runtime integration',()=>{
 it('declares capability-owned routes and a tenant-free durable payload without mounting globals',async()=>{const f=await onboard();const routes=createDomainOperationsScopedRoutes(f.service);expect(routes.map(({path})=>path)).toContain('/settings/domains/customer-dns/onboard');expect(routes.map(({path})=>path)).toContain('/settings/domains/transfers/:transferOperationId/reconcile');expect(routes.map(({path})=>path)).toContain('/settings/domains/site-transfer-choice');expect(DOMAIN_TRANSFER_JOB_KIND).toBe('fuma.domain-transfer');expect(Value.Check(DomainTransferJobPayloadSchema,{schemaVersion:1,transferOperationId:'transfer-a',action:'resume',attempt:1})).toBe(true);expect(Value.Check(DomainTransferJobPayloadSchema,{schemaVersion:1,transferOperationId:'transfer-a',action:'resume',attempt:1,organizationId:'attacker'})).toBe(false);expect((await f.service.exactSettings(scope,'domain-a'))?.records).toHaveLength(3)})
})
