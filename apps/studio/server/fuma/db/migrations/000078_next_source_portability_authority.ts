import type { HostedMigration } from '../migrationPolicy'

/** FUMA-077 durable generic Next.js source portability authority. */
export const nextSourcePortabilityAuthorityMigration: HostedMigration = Object.freeze({
  id: '000078_next_source_portability_authority',
  description: 'Add scoped immutable Next source revision, adaptation, rollback, and export authority',
  sql: String.raw`
create table fuma_next_source_revisions_v1 (
  revision_id text primary key,
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  owner_generation bigint not null check(owner_generation > 0),
  profile_id text not null check(profile_id in ('website','publication')),
  source_hash_sha256 text not null check(source_hash_sha256 ~ '^[a-f0-9]{64}$'),
  object_key text not null check(object_key ~ '^imports/next-source/revisions/[a-f0-9]{64}\.zip$'),
  object_hash_sha256 text not null check(object_hash_sha256 ~ '^[a-f0-9]{64}$'),
  object_size_bytes bigint not null check(object_size_bytes > 0),
  revision_json jsonb not null check(jsonb_typeof(revision_json)='object'),
  state text not null check(state in ('draft','confirmed','superseded','rolled-back')),
  parent_revision_id text null,
  created_at timestamptz not null,
  unique(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,revision_id),
  unique(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,parent_revision_id,source_hash_sha256),
  foreign key(platform_id,owner_key,organization_id,workspace_id,site_id,owner_generation)
    references fuma_tenant_owner_keys(platform_id,owner_key,organization_id,workspace_id,site_id,generation)
    on update cascade on delete restrict,
  foreign key(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,parent_revision_id)
    references fuma_next_source_revisions_v1(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,revision_id)
    on update cascade on delete restrict,
  check(revision_json->>'revisionId'=revision_id),
  check(revision_json->>'sourceHashSha256'=source_hash_sha256),
  check(revision_json->>'state'=state),
  check(revision_json#>>'{destination,organizationId}'=organization_id),
  check(revision_json#>>'{destination,workspaceId}'=workspace_id),
  check(revision_json#>>'{destination,siteId}'=site_id)
);
create index fuma_next_source_revisions_scope_v1 on fuma_next_source_revisions_v1
  (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,created_at desc,revision_id);

create table fuma_next_source_ingest_receipts_v1 (
  receipt_id text not null,
  revision_id text not null,
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  owner_generation bigint not null check(owner_generation > 0),
  profile_id text not null check(profile_id in ('website','publication')),
  receipt_json jsonb not null check(jsonb_typeof(receipt_json)='object'),
  created_at timestamptz not null,
  primary key(platform_id,owner_key,owner_generation,profile_id,revision_id,receipt_id),
  foreign key(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,revision_id)
    references fuma_next_source_revisions_v1(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,revision_id)
    on update cascade on delete restrict,
  check(receipt_json->>'receiptId'=receipt_id),
  check(receipt_json#>>'{destination,organizationId}'=organization_id),
  check(receipt_json#>>'{destination,workspaceId}'=workspace_id),
  check(receipt_json#>>'{destination,siteId}'=site_id)
);

create table fuma_next_source_fixes_v1 (
  receipt_id text primary key,
  source_revision_id text not null,
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  owner_generation bigint not null check(owner_generation > 0),
  profile_id text not null check(profile_id in ('website','publication')),
  operation_id text not null,
  receipt_json jsonb not null check(jsonb_typeof(receipt_json)='object'),
  patch_object_key text not null check(patch_object_key ~ '^imports/next-source/fixes/[a-f0-9]{64}\.zip$'),
  patch_object_hash_sha256 text not null check(patch_object_hash_sha256 ~ '^[a-f0-9]{64}$'),
  patch_object_size_bytes bigint not null check(patch_object_size_bytes > 0),
  state text not null check(state in ('proposed','owner-confirmed','applied','revoked')),
  version bigint not null default 1 check(version > 0),
  created_at timestamptz not null,
  confirmed_at timestamptz null,
  unique(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,operation_id),
  foreign key(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,source_revision_id)
    references fuma_next_source_revisions_v1(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,revision_id)
    on update cascade on delete restrict,
  check(receipt_json->>'receiptId'=receipt_id),
  check(receipt_json#>>'{authority,operationId}'=operation_id),
  check(receipt_json#>>'{authority,sourceRevisionId}'=source_revision_id),
  check((receipt_json#>>'{authority,ownerGeneration}')::bigint=owner_generation),
  check(receipt_json#>>'{authority,destination,organizationId}'=organization_id),
  check(receipt_json#>>'{authority,destination,workspaceId}'=workspace_id),
  check(receipt_json#>>'{authority,destination,siteId}'=site_id),
  check(receipt_json->>'state'=state),
  check(state in ('applied','revoked') or ((state='owner-confirmed')=(confirmed_at is not null)))
);
create index fuma_next_source_fixes_scope_v1 on fuma_next_source_fixes_v1
  (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,created_at,receipt_id);

create table fuma_next_source_rollbacks_v1 (
  receipt_id text primary key,
  from_revision_id text not null,
  restored_revision_id text not null,
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  owner_generation bigint not null check(owner_generation > 0),
  profile_id text not null check(profile_id in ('website','publication')),
  receipt_json jsonb not null check(jsonb_typeof(receipt_json)='object'),
  created_at timestamptz not null,
  foreign key(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,from_revision_id)
    references fuma_next_source_revisions_v1(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,revision_id)
    on update cascade on delete restrict,
  foreign key(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,restored_revision_id)
    references fuma_next_source_revisions_v1(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,revision_id)
    on update cascade on delete restrict,
  check(from_revision_id <> restored_revision_id),
  check(receipt_json->>'receiptId'=receipt_id),
  check(receipt_json->>'fromRevisionId'=from_revision_id),
  check(receipt_json->>'restoredRevisionId'=restored_revision_id),
  check(receipt_json#>>'{destination,organizationId}'=organization_id),
  check(receipt_json#>>'{destination,workspaceId}'=workspace_id),
  check(receipt_json#>>'{destination,siteId}'=site_id)
);

create table fuma_next_source_editor_commits_v1 (
  commit_id text primary key,
  revision_id text not null,
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  owner_generation bigint not null check(owner_generation > 0),
  profile_id text not null check(profile_id in ('website','publication')),
  source_hash_sha256 text not null check(source_hash_sha256 ~ '^[a-f0-9]{64}$'),
  document_hash_sha256 text not null check(document_hash_sha256 ~ '^[a-f0-9]{64}$'),
  editor_resource_kind text not null check(editor_resource_kind='site-document'),
  editor_logical_id text not null,
  mutation_id text not null,
  expected_sequence bigint not null check(expected_sequence >= 0),
  accepted_sequence bigint not null check(accepted_sequence=expected_sequence+1),
  actor_id text not null,
  receipt_json jsonb not null check(jsonb_typeof(receipt_json)='object'),
  created_at timestamptz not null,
  unique(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,revision_id),
  foreign key(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,revision_id)
    references fuma_next_source_revisions_v1(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,revision_id)
    on update cascade on delete restrict,
  foreign key(platform_id,owner_key,owner_generation,profile_id,editor_resource_kind,editor_logical_id,mutation_id)
    references fuma_editor_draft_mutations(platform_id,owner_key,owner_generation,profile_id,resource_kind,logical_id,mutation_id)
    on update cascade on delete restrict,
  check(editor_logical_id=site_id),
  check(receipt_json->>'commitId'=commit_id),
  check(receipt_json->>'revisionId'=revision_id),
  check(receipt_json->>'sourceHashSha256'=source_hash_sha256),
  check(receipt_json->>'documentHashSha256'=document_hash_sha256),
  check(receipt_json->>'mutationId'=mutation_id),
  check((receipt_json->>'expectedSequence')::bigint=expected_sequence),
  check((receipt_json->>'acceptedSequence')::bigint=accepted_sequence),
  check(receipt_json->>'actorId'=actor_id),
  check((receipt_json->>'ownerGeneration')::bigint=owner_generation),
  check(receipt_json#>>'{destination,organizationId}'=organization_id),
  check(receipt_json#>>'{destination,workspaceId}'=workspace_id),
  check(receipt_json#>>'{destination,siteId}'=site_id)
);
create index fuma_next_source_editor_commits_scope_v1 on fuma_next_source_editor_commits_v1
  (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,created_at desc,commit_id);

create table fuma_next_source_exports_v1 (
  export_id text primary key,
  revision_id text not null,
  release_id text not null,
  source_snapshot_id text not null,
  source_snapshot_hash_sha256 text not null check(source_snapshot_hash_sha256 ~ '^[a-f0-9]{64}$'),
  document_hash_sha256 text not null check(document_hash_sha256 ~ '^[a-f0-9]{64}$'),
  platform_id text not null,
  organization_id text not null,
  workspace_id text not null,
  site_id text not null,
  owner_key text not null,
  owner_generation bigint not null check(owner_generation > 0),
  profile_id text not null check(profile_id in ('website','publication')),
  object_key text not null check(object_key ~ '^exports/next-source/[a-f0-9]{64}\.zip$'),
  object_hash_sha256 text not null check(object_hash_sha256 ~ '^[a-f0-9]{64}$'),
  object_size_bytes bigint not null check(object_size_bytes > 0),
  manifest_json jsonb not null check(jsonb_typeof(manifest_json)='object'),
  github_operation_id text null,
  github_request_json jsonb null check(github_request_json is null or jsonb_typeof(github_request_json)='object'),
  github_receipt_json jsonb null check(github_receipt_json is null or jsonb_typeof(github_receipt_json)='object'),
  state text not null check(state in ('artifact-created','github-pending','github-exported')),
  version bigint not null default 1 check(version > 0),
  created_at timestamptz not null,
  exported_at timestamptz null,
  foreign key(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,revision_id)
    references fuma_next_source_revisions_v1(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,revision_id)
    on update cascade on delete restrict,
  foreign key(platform_id,owner_key,release_id)
    references fuma_releases(platform_id,owner_key,release_id)
    on update cascade on delete restrict,
  unique(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,release_id),
  unique(platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,github_operation_id),
  check(manifest_json->>'exportId'=export_id),
  check(manifest_json->>'releaseId'=release_id),
  check(manifest_json->>'sourceSnapshotId'=source_snapshot_id),
  check(manifest_json->>'sourceSnapshotHashSha256'=source_snapshot_hash_sha256),
  check(manifest_json->>'documentHashSha256'=document_hash_sha256),
  check(manifest_json->>'sourceRevisionId'=revision_id),
  check(manifest_json#>>'{destination,organizationId}'=organization_id),
  check(manifest_json#>>'{destination,workspaceId}'=workspace_id),
  check(manifest_json#>>'{destination,siteId}'=site_id),
  check((state='artifact-created' and github_operation_id is null and github_request_json is null and github_receipt_json is null and exported_at is null)
    or (state='github-pending' and github_operation_id is not null and github_request_json is not null and github_receipt_json is null and exported_at is null)
    or (state='github-exported' and github_operation_id is not null and github_request_json is not null and github_receipt_json is not null and exported_at is not null))
);
create index fuma_next_source_exports_scope_v1 on fuma_next_source_exports_v1
  (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,created_at desc,export_id);

create function fuma_next_source_immutable_evidence_v1() returns trigger language plpgsql as $next_source_immutable$
begin
  if tg_op='UPDATE' and (new.organization_id is distinct from old.organization_id or new.workspace_id is distinct from old.workspace_id)
    and (to_jsonb(new)-'organization_id'-'workspace_id') is not distinct from (to_jsonb(old)-'organization_id'-'workspace_id') then
    return new;
  end if;
  raise exception 'Next source immutable evidence is append-only' using errcode='55000';
end;
$next_source_immutable$;

create function fuma_next_source_fix_transition_v1() returns trigger language plpgsql as $next_source_fix$
begin
  if tg_op='DELETE' then raise exception 'Next source fix evidence is append-only' using errcode='55000'; end if;
  if (new.organization_id is distinct from old.organization_id or new.workspace_id is distinct from old.workspace_id)
    and (to_jsonb(new)-'organization_id'-'workspace_id') is not distinct from (to_jsonb(old)-'organization_id'-'workspace_id') then return new; end if;
  if new.receipt_id<>old.receipt_id or new.source_revision_id<>old.source_revision_id
    or new.platform_id<>old.platform_id or new.organization_id<>old.organization_id
    or new.workspace_id<>old.workspace_id or new.site_id<>old.site_id or new.owner_key<>old.owner_key
    or new.owner_generation<>old.owner_generation or new.profile_id<>old.profile_id or new.operation_id<>old.operation_id
    or new.patch_object_key<>old.patch_object_key or new.patch_object_hash_sha256<>old.patch_object_hash_sha256
    or new.patch_object_size_bytes<>old.patch_object_size_bytes or new.created_at<>old.created_at
    or (new.receipt_json-'state'-'confirmationActorId'-'confirmedAt') is distinct from (old.receipt_json-'state'-'confirmationActorId'-'confirmedAt') then
    raise exception 'Next source fix identity is immutable' using errcode='55000';
  end if;
  if new.version<>old.version+1 then raise exception 'Next source fix updates require one version step' using errcode='55000'; end if;
  if not ((old.state='proposed' and new.state in ('owner-confirmed','applied','revoked'))
    or (old.state='owner-confirmed' and new.state in ('applied','revoked'))) then
    raise exception 'Invalid Next source fix transition' using errcode='55000';
  end if;
  if old.state='proposed' and new.state='applied' and coalesce((old.receipt_json->>'executableChange')::boolean,true) then
    raise exception 'Executable Next source fixes require owner confirmation' using errcode='55000';
  end if;
  if new.receipt_json->>'state'<>new.state then raise exception 'Next source fix state evidence mismatch' using errcode='55000'; end if;
  if new.state='owner-confirmed' and (new.confirmed_at is null or new.receipt_json->>'confirmationActorId' is null or new.receipt_json->>'confirmationActorId'='null') then
    raise exception 'Next source owner confirmation evidence is incomplete' using errcode='55000';
  end if;
  return new;
end;
$next_source_fix$;

create function fuma_next_source_export_transition_v1() returns trigger language plpgsql as $next_source_export$
begin
  if tg_op='DELETE' then raise exception 'Next source export evidence is append-only' using errcode='55000'; end if;
  if (new.organization_id is distinct from old.organization_id or new.workspace_id is distinct from old.workspace_id)
    and (to_jsonb(new)-'organization_id'-'workspace_id') is not distinct from (to_jsonb(old)-'organization_id'-'workspace_id') then return new; end if;
  if new.export_id<>old.export_id or new.revision_id<>old.revision_id or new.release_id<>old.release_id
    or new.source_snapshot_id<>old.source_snapshot_id or new.source_snapshot_hash_sha256<>old.source_snapshot_hash_sha256
    or new.document_hash_sha256<>old.document_hash_sha256
    or new.platform_id<>old.platform_id or new.organization_id<>old.organization_id
    or new.workspace_id<>old.workspace_id or new.site_id<>old.site_id or new.owner_key<>old.owner_key
    or new.owner_generation<>old.owner_generation or new.profile_id<>old.profile_id
    or new.object_key<>old.object_key or new.object_hash_sha256<>old.object_hash_sha256
    or new.object_size_bytes<>old.object_size_bytes or new.manifest_json<>old.manifest_json or new.created_at<>old.created_at then
    raise exception 'Next source export identity is immutable' using errcode='55000';
  end if;
  if old.state='artifact-created' and new.state='github-pending' and new.version=old.version+1
    and new.github_operation_id is not null and new.github_request_json is not null
    and new.github_receipt_json is null and new.exported_at is null then
    return new;
  end if;
  if old.state='github-pending' and new.state='github-exported' and new.version=old.version+1
    and new.github_operation_id is not distinct from old.github_operation_id
    and new.github_request_json is not distinct from old.github_request_json
    and new.github_receipt_json is not null and new.exported_at is not null then
    return new;
  end if;
  raise exception 'Invalid Next source export transition' using errcode='55000';
end;
$next_source_export$;

create trigger fuma_next_source_revision_immutable_v1 before update or delete on fuma_next_source_revisions_v1 for each row execute function fuma_next_source_immutable_evidence_v1();
create trigger fuma_next_source_ingest_immutable_v1 before update or delete on fuma_next_source_ingest_receipts_v1 for each row execute function fuma_next_source_immutable_evidence_v1();
create trigger fuma_next_source_fix_transition_v1 before update or delete on fuma_next_source_fixes_v1 for each row execute function fuma_next_source_fix_transition_v1();
create trigger fuma_next_source_rollback_immutable_v1 before update or delete on fuma_next_source_rollbacks_v1 for each row execute function fuma_next_source_immutable_evidence_v1();
create trigger fuma_next_source_editor_commit_immutable_v1 before update or delete on fuma_next_source_editor_commits_v1 for each row execute function fuma_next_source_immutable_evidence_v1();
create trigger fuma_next_source_export_transition_v1 before update or delete on fuma_next_source_exports_v1 for each row execute function fuma_next_source_export_transition_v1();
`,
})
