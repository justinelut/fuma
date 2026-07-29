import {describe,expect,it} from 'bun:test'
import {COMMERCIAL_EDGE_JOB_KINDS,COMMERCIAL_EDGE_PURPOSES,COMMERCIAL_EDGE_SCOPED_ROUTE_GROUPS,COMMERCIAL_EDGE_TRANSFER_STEPS,describeCommercialEdgePhase} from '../../../server/fuma/commercialEdgePhase/composition'
import {hostedMigrationChecksum} from '../../../server/fuma/db/migrationPolicy'
import {COMMERCIAL_EDGE_MIGRATIONS,COMMERCIAL_EDGE_MIGRATION_CHECKSUMS} from '../../../server/fuma/commercialEdgePhase/migrations'

describe('FUMA-048–062 phase integration manifest',()=>{
 it('covers every ticket exactly once in dependency order',()=>{expect(describeCommercialEdgePhase().tickets).toEqual(Array.from({length:15},(_,i)=>`FUMA-${String(48+i).padStart(3,'0')}`))})
 it('provides the legacy suffix plus finalized authorities with immutable checksums',()=>{expect(COMMERCIAL_EDGE_MIGRATIONS.map(({id})=>id.slice(0,6))).toEqual([...Array.from({length:14},(_,i)=>String(21+i).padStart(6,'0')),'000061','000062','000064','000065','000067']);for(const migration of COMMERCIAL_EDGE_MIGRATIONS){expect(COMMERCIAL_EDGE_MIGRATION_CHECKSUMS[migration.id as keyof typeof COMMERCIAL_EDGE_MIGRATION_CHECKSUMS]).toBe(hostedMigrationChecksum(migration.sql))}})
 it('keeps platform and customer payment purposes explicitly scoped',()=>{expect(COMMERCIAL_EDGE_PURPOSES.filter((x)=>x.scope==='platform_billing').map((x)=>x.purpose)).toEqual(['platform-recurring','platform-setup']);expect(COMMERCIAL_EDGE_PURPOSES.filter((x)=>x.scope==='customer_merchant').map((x)=>x.purpose)).toEqual(['publication-membership','fuma-plugin-deposit','fuma-plugin-donation','fuma-plugin-checkout'])})
 it('registers all operational jobs and explicit transfer choices without a default host',()=>{expect(COMMERCIAL_EDGE_JOB_KINDS).toContain('fuma.publish-release');expect(COMMERCIAL_EDGE_JOB_KINDS).toContain('fuma.domain-transfer');expect(COMMERCIAL_EDGE_SCOPED_ROUTE_GROUPS).toEqual(['customer-merchant-payments','cloudflare-saas-hostnames','registrar-lifecycle','domain-operations']);expect(COMMERCIAL_EDGE_TRANSFER_STEPS.map((x)=>x.stepId)).toEqual(['customer-merchant-credentials','domain-outcome']);expect(describeCommercialEdgePhase().noDefaultHost).toBe(true)})
})
