import { describe,expect,it } from 'bun:test'
import { createPostgresClient } from '../../../server/db/postgres'
import { publicationDeliverabilityControlMigration } from '../../../server/fuma/db/migrations/000054_publication_deliverability_control'
import { PostgresPublicationDeliverabilityControlStore } from '../../../server/fuma/publication/deliverabilityPostgres'
import { PUBLICATION_TEST_SCOPE } from '../helpers/fuma/publicationFixtures'

const postgresUrl=process.env.FUMA_TEST_POSTGRES_URL
const quote=(value:string)=>{if(!/^[a-z][a-z0-9_]*$/.test(value))throw new Error('Unsafe schema.');return `"${value}"`}
const scopedUrl=(connection:string,schema:string)=>{const url=new URL(connection);url.searchParams.set('options',`-c search_path=${schema},public`);return url.toString()}

describe('FUMA-047 optional live PostgreSQL acceptance',()=>{
  it.skipIf(postgresUrl===undefined)('persists scoped suppression, sender health, consent CAS, opt-out fencing, and retention purge',async()=>{
    if(!postgresUrl)throw new Error('FUMA_TEST_POSTGRES_URL is required.')
    const admin=createPostgresClient(postgresUrl),schema=`fuma_deliverability_${process.pid}_${Date.now()}`;await admin.unsafe(`create schema ${quote(schema)}`);const db=createPostgresClient(scopedUrl(postgresUrl,schema))
    try{
      await db.unsafe(`
        create table fuma_tenant_owner_keys (platform_id text not null,owner_key text not null,organization_id text not null,workspace_id text not null,site_id text not null,state text not null,generation bigint not null,transfer_id text,transfer_lock_id text,transfer_fence bigint,primary key(platform_id,owner_key));
        create table fuma_oci_email_provider_events (platform_id text not null,owner_key text not null,owner_generation bigint not null,profile_id text not null,event_id text not null,event_type text not null,provider_message_id text not null,occurred_at timestamptz not null,recipient_email text not null,diagnostic_code text,payload_sha256 text not null,primary key(platform_id,owner_key,owner_generation,profile_id,event_id));
      `)
      await db.unsafe(publicationDeliverabilityControlMigration.sql)
      await db`insert into fuma_tenant_owner_keys values ('platform','owner-key','organization','workspace','site','active',1,null,null,null)`
      const store=new PostgresPublicationDeliverabilityControlStore(db),hash='a'.repeat(64)
      expect(await store.putScopedSuppression(PUBLICATION_TEST_SCOPE,{suppressionId:'suppression-1',level:'newsletter',newsletterId:'daily',emailHashSha256:hash,reason:'unsubscribe',sourceId:'token-1',createdAt:'2040-01-01T00:00:00.000Z'})).toBe(true)
      expect(await store.isEmailSuppressed(PUBLICATION_TEST_SCOPE,hash,'daily')).toBe(true);expect(await store.isEmailSuppressed(PUBLICATION_TEST_SCOPE,hash,'weekly')).toBe(false)
      await store.putSenderDomainHealth(PUBLICATION_TEST_SCOPE,{domainId:'domain-1',domain:'example.com',approvedSenderEmails:['news@example.com'],spf:'verified',dkim:'verified',dmarc:'verified',productionReady:true,diagnostics:[],checkedAt:'2040-01-01T00:00:00.000Z'})
      expect(await store.getSenderDomainHealth(PUBLICATION_TEST_SCOPE,'example.com')).toMatchObject({productionReady:true,spf:'verified',dkim:'verified',dmarc:'verified'})
      expect(await store.putEngagementConsent(PUBLICATION_TEST_SCOPE,{memberId:'member-1',state:'opted-in',consentVersion:1,retentionDays:7,updatedAt:'2040-01-01T00:00:00.000Z'},null)).toBe(true)
      const first={eventId:'engagement-1',kind:'open' as const,campaignId:'campaign-1',memberId:'member-1',targetUrlHashSha256:null,occurredAt:'2040-01-02T00:00:00.000Z',expiresAt:'2040-01-09T00:00:00.000Z'}
      expect(await store.appendEngagementEvent(PUBLICATION_TEST_SCOPE,first)).toBe(true)
      expect(await store.putEngagementConsent(PUBLICATION_TEST_SCOPE,{memberId:'member-1',state:'opted-out',consentVersion:2,retentionDays:7,updatedAt:'2040-01-03T00:00:00.000Z'},1)).toBe(true)
      expect(await store.appendEngagementEvent(PUBLICATION_TEST_SCOPE,{...first,eventId:'engagement-2',occurredAt:'2040-01-04T00:00:00.000Z',expiresAt:'2040-01-11T00:00:00.000Z'})).toBe(false)
      expect(await store.engagementSummary(PUBLICATION_TEST_SCOPE,'2040-01-01T00:00:00.000Z','2040-02-01T00:00:00.000Z',0)).toMatchObject({opens:1,clicks:0,uniqueMembers:1,optedOutMembers:1})
      expect(await store.purgeExpiredEngagement(PUBLICATION_TEST_SCOPE,'2040-01-10T00:00:00.000Z')).toBe(1)
    }finally{await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)}
  })
})
