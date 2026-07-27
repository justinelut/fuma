import { createPostgresClient } from '../../../server/db/postgres'
import { publicationCampaignDeliveryControlMigration } from '../../../server/fuma/db/migrations/000053_publication_campaign_delivery_control'
import { PostgresPublicationDomainStore } from '../../../server/fuma/publication/postgresStore'
import type { CampaignSnapshot } from '@core/fuma/publication'
import { PUBLICATION_TEST_SCOPE, TEST_NOW } from '../helpers/fuma/publicationFixtures'

const postgresUrl=process.env.FUMA_TEST_POSTGRES_URL
const quote=(value:string)=>{if(!/^[a-z][a-z0-9_]*$/.test(value))throw new Error('Unsafe schema.');return `"${value}"`}
const scopedUrl=(connection:string,schema:string)=>{const url=new URL(connection);url.searchParams.set('options',`-c search_path=${schema},public`);return url.toString()}

describe('FUMA-046 optional live PostgreSQL acceptance',()=>{
 it.skipIf(postgresUrl===undefined)('persists immutable hashes/size and compare-and-sets campaign lifecycle',async()=>{
  if(!postgresUrl)throw new Error('FUMA_TEST_POSTGRES_URL is required.')
  const admin=createPostgresClient(postgresUrl),schema=`fuma_campaign_${process.pid}_${Date.now()}`;await admin.unsafe(`create schema ${quote(schema)}`);const db=createPostgresClient(scopedUrl(postgresUrl,schema))
  try{
   await db.unsafe(`
    create table fuma_tenant_owner_keys (platform_id text not null,owner_key text not null,organization_id text not null,workspace_id text not null,site_id text not null,state text not null,generation bigint not null,transfer_id text,transfer_lock_id text,transfer_fence bigint,primary key(platform_id,owner_key));
    create table fuma_publication_newsletter_versions (platform_id text not null,owner_key text not null,owner_generation bigint not null,profile_id text not null,version_id text not null,primary key(platform_id,owner_key,owner_generation,profile_id,version_id));
    create table fuma_publication_campaigns (platform_id text not null,owner_key text not null,owner_generation bigint not null,profile_id text not null,campaign_id text not null,newsletter_id text not null,version_id text not null,segment_id text not null,status text not null,audience_member_ids_json jsonb not null,subject text not null,html text not null,plaintext text not null,sender_json jsonb not null,snapshot_sha256 text not null,scheduled_at timestamptz,created_at timestamptz not null,primary key(platform_id,owner_key,owner_generation,profile_id,campaign_id),foreign key(platform_id,owner_key,owner_generation,profile_id,version_id) references fuma_publication_newsletter_versions(platform_id,owner_key,owner_generation,profile_id,version_id));
    create table fuma_publication_campaign_deliveries (platform_id text not null,owner_key text not null,owner_generation bigint not null,profile_id text not null,delivery_id text not null,campaign_id text not null,member_id text not null,recipient_email text not null,status text not null,provider_message_id text,attempt integer not null,updated_at timestamptz not null,primary key(platform_id,owner_key,owner_generation,profile_id,delivery_id),unique(platform_id,owner_key,owner_generation,profile_id,campaign_id,member_id));
   `)
   await db.unsafe(publicationCampaignDeliveryControlMigration.sql)
   await db`insert into fuma_tenant_owner_keys values ('platform','owner-key','organization','workspace','site','active',1,null,null,null)`
   await db`insert into fuma_publication_newsletter_versions values ('platform','owner-key',1,'publication','version-1')`
   const provenance={scope:'platform' as const,scopeId:'platform',version:1}
   const campaign:CampaignSnapshot={campaignId:'campaign-1',newsletterId:'newsletter-1',versionId:'version-1',segmentId:'segment-1',status:'scheduled',audienceMemberIds:['member-1'],subject:'Frozen',html:'<p>Frozen</p>',text:'Frozen',sender:{values:{senderName:'Fuma',senderEmail:'hello@example.test',replyToEmail:'reply@example.test',physicalAddress:'Nairobi',brandColor:'#112233',footerText:'Footer'},provenance:{senderName:provenance,senderEmail:provenance,replyToEmail:provenance,physicalAddress:provenance,brandColor:provenance,footerText:provenance}},audienceSha256:'a'.repeat(64),contentSha256:'b'.repeat(64),messageSizeBytes:512,snapshotSha256:'c'.repeat(64),scheduledAt:'2040-01-03T00:00:00.000Z',createdAt:TEST_NOW}
   const store=new PostgresPublicationDomainStore(db);expect(await store.putCampaignWithDeliveries(PUBLICATION_TEST_SCOPE,campaign,[{deliveryId:'delivery-1',campaignId:'campaign-1',memberId:'member-1',recipientEmail:'reader@example.test',status:'queued',providerMessageId:null,attempt:0,updatedAt:TEST_NOW}])).toBe(true);expect(await store.getCampaign(PUBLICATION_TEST_SCOPE,'campaign-1')).toEqual(campaign);expect(await store.transitionCampaignStatus(PUBLICATION_TEST_SCOPE,'campaign-1','scheduled','sending')).toBe(true);expect(await store.transitionCampaignStatus(PUBLICATION_TEST_SCOPE,'campaign-1','scheduled','cancelled')).toBe(false);expect((await store.getCampaign(PUBLICATION_TEST_SCOPE,'campaign-1'))?.status).toBe('sending');expect(await store.listDeliveries(PUBLICATION_TEST_SCOPE,'campaign-1')).toHaveLength(1)
  }finally{await admin.unsafe(`drop schema if exists ${quote(schema)} cascade`)}
 })
})
