import type { HostedMigration } from '../migrationPolicy'

export const artifactReviewMarketplaceMigration: HostedMigration = Object.freeze({
  id: '000071_artifact_review_marketplace',
  description: 'Add immutable plugin and component-pack review, signing, revocation, and marketplace authority',
  sql: `
    create table fuma_artifact_review_submissions_v2 (
      submission_id text primary key,
      artifact_id text not null references fuma_artifact_releases_v2(artifact_id) on delete restrict,
      artifact_kind text not null check (artifact_kind in ('plugin','component-pack')),
      package_id text not null,
      exact_version text not null,
      content_hash_sha256 text not null check (content_hash_sha256 ~ '^[a-f0-9]{64}$'),
      submitter_id text not null,
      baseline_submission_id text null references fuma_artifact_review_submissions_v2(submission_id) on delete restrict,
      metadata_hash_sha256 text not null check (metadata_hash_sha256 ~ '^[a-f0-9]{64}$'),
      scan_state text not null check (scan_state in ('clean','rejected')),
      submission_json jsonb not null check (jsonb_typeof(submission_json)='object'),
      submitted_at timestamptz not null,
      unique (artifact_id,content_hash_sha256,submission_id)
    );

    create table fuma_artifact_scan_reports_v2 (
      scan_id text primary key,
      submission_id text not null references fuma_artifact_review_submissions_v2(submission_id) on delete restrict,
      artifact_id text not null references fuma_artifact_releases_v2(artifact_id) on delete restrict,
      artifact_kind text not null check (artifact_kind in ('plugin','component-pack')),
      content_hash_sha256 text not null check (content_hash_sha256 ~ '^[a-f0-9]{64}$'),
      scanner_id text not null,
      scanner_version text not null,
      state text not null check (state in ('clean','rejected')),
      report_json jsonb not null check (jsonb_typeof(report_json)='object'),
      scanned_at timestamptz not null,
      unique (submission_id,scanner_id,scanner_version)
    );

    create table fuma_artifact_scan_findings_v2 (
      scan_id text not null references fuma_artifact_scan_reports_v2(scan_id) on delete restrict,
      finding_id text not null,
      severity text not null check (severity in ('info','low','medium','high','critical')),
      code text not null,
      finding_json jsonb not null check (jsonb_typeof(finding_json)='object'),
      primary key (scan_id,finding_id)
    );

    create table fuma_artifact_review_decisions_v2 (
      decision_id text primary key,
      submission_id text not null unique references fuma_artifact_review_submissions_v2(submission_id) on delete restrict,
      artifact_id text not null references fuma_artifact_releases_v2(artifact_id) on delete restrict,
      content_hash_sha256 text not null check (content_hash_sha256 ~ '^[a-f0-9]{64}$'),
      reviewer_id text not null,
      decision text not null check (decision in ('approved','rejected')),
      reason text not null,
      signature_key_id text null,
      signature_payload_hash_sha256 text null check (signature_payload_hash_sha256 is null or signature_payload_hash_sha256 ~ '^[a-f0-9]{64}$'),
      signature_value text null,
      decision_json jsonb not null check (jsonb_typeof(decision_json)='object'),
      decided_at timestamptz not null,
      check ((decision='approved' and signature_key_id is not null and signature_payload_hash_sha256 is not null and signature_value is not null)
        or (decision='rejected' and signature_key_id is null and signature_payload_hash_sha256 is null and signature_value is null))
    );

    create table fuma_artifact_review_revocations_v2 (
      revocation_id text primary key,
      decision_id text not null unique references fuma_artifact_review_decisions_v2(decision_id) on delete restrict,
      submission_id text not null references fuma_artifact_review_submissions_v2(submission_id) on delete restrict,
      artifact_id text not null references fuma_artifact_releases_v2(artifact_id) on delete restrict,
      actor_id text not null,
      reason text not null,
      revocation_json jsonb not null check (jsonb_typeof(revocation_json)='object'),
      revoked_at timestamptz not null
    );

    create function fuma_artifact_review_submission_guard_v2() returns trigger language plpgsql as $review_submission_guard$
    declare release fuma_artifact_releases_v2%rowtype;
    declare baseline fuma_artifact_review_submissions_v2%rowtype;
    begin
      select * into release from fuma_artifact_releases_v2 where artifact_id=new.artifact_id for share;
      if not found or release.artifact_kind<>new.artifact_kind or release.package_id<>new.package_id
        or release.exact_version<>new.exact_version or release.content_hash_sha256<>new.content_hash_sha256 then
        raise exception 'Artifact review submission release binding changed';
      end if;
      if new.baseline_submission_id is not null then
        select * into baseline from fuma_artifact_review_submissions_v2 where submission_id=new.baseline_submission_id for share;
        if not found or baseline.artifact_kind<>new.artifact_kind or baseline.package_id<>new.package_id then
          raise exception 'Artifact review baseline package binding changed';
        end if;
      end if;
      return new;
    end;
    $review_submission_guard$;
    create trigger fuma_artifact_review_submission_guard_v2 before insert on fuma_artifact_review_submissions_v2 for each row execute function fuma_artifact_review_submission_guard_v2();

    create function fuma_artifact_scan_report_guard_v2() returns trigger language plpgsql as $scan_report_guard$
    declare source fuma_artifact_review_submissions_v2%rowtype;
    begin
      select * into source from fuma_artifact_review_submissions_v2 where submission_id=new.submission_id for share;
      if not found or source.artifact_id<>new.artifact_id or source.artifact_kind<>new.artifact_kind or source.content_hash_sha256<>new.content_hash_sha256 then
        raise exception 'Artifact scan report release binding changed';
      end if;
      return new;
    end;
    $scan_report_guard$;
    create trigger fuma_artifact_scan_report_guard_v2 before insert on fuma_artifact_scan_reports_v2 for each row execute function fuma_artifact_scan_report_guard_v2();

    create function fuma_artifact_review_immutable_v2() returns trigger language plpgsql as $review_immutable$
    begin raise exception 'Fuma artifact review evidence is append-only'; end;
    $review_immutable$;
    create trigger fuma_artifact_review_submission_immutable_v2 before update or delete on fuma_artifact_review_submissions_v2 for each row execute function fuma_artifact_review_immutable_v2();
    create trigger fuma_artifact_scan_report_immutable_v2 before update or delete on fuma_artifact_scan_reports_v2 for each row execute function fuma_artifact_review_immutable_v2();
    create trigger fuma_artifact_scan_finding_immutable_v2 before update or delete on fuma_artifact_scan_findings_v2 for each row execute function fuma_artifact_review_immutable_v2();
    create trigger fuma_artifact_review_decision_immutable_v2 before update or delete on fuma_artifact_review_decisions_v2 for each row execute function fuma_artifact_review_immutable_v2();
    create trigger fuma_artifact_review_revocation_immutable_v2 before update or delete on fuma_artifact_review_revocations_v2 for each row execute function fuma_artifact_review_immutable_v2();

    create function fuma_artifact_review_decision_guard_v2() returns trigger language plpgsql as $review_decision_guard$
    declare source fuma_artifact_review_submissions_v2%rowtype;
    begin
      select * into source from fuma_artifact_review_submissions_v2 where submission_id=new.submission_id for share;
      if not found or source.artifact_id<>new.artifact_id or source.content_hash_sha256<>new.content_hash_sha256 then
        raise exception 'Artifact review decision release binding changed';
      end if;
      if source.submitter_id=new.reviewer_id then raise exception 'Artifact submitter cannot review own release'; end if;
      if new.decision='approved' and (source.scan_state<>'clean'
        or not exists (select 1 from fuma_artifact_scan_reports_v2 where submission_id=new.submission_id)
        or exists (select 1 from fuma_artifact_scan_reports_v2 where submission_id=new.submission_id and state<>'clean')) then
        raise exception 'Rejected or missing scans cannot be approved';
      end if;
      return new;
    end;
    $review_decision_guard$;
    create trigger fuma_artifact_review_decision_guard_v2 before insert on fuma_artifact_review_decisions_v2 for each row execute function fuma_artifact_review_decision_guard_v2();

    create function fuma_artifact_review_revocation_guard_v2() returns trigger language plpgsql as $review_revocation_guard$
    declare approved fuma_artifact_review_decisions_v2%rowtype;
    declare source fuma_artifact_review_submissions_v2%rowtype;
    begin
      select * into approved from fuma_artifact_review_decisions_v2 where decision_id=new.decision_id for share;
      select * into source from fuma_artifact_review_submissions_v2 where submission_id=new.submission_id for share;
      if not found or approved.decision<>'approved' or approved.submission_id<>new.submission_id or approved.artifact_id<>new.artifact_id then
        raise exception 'Only an approved exact release can be revoked';
      end if;
      if source.submitter_id=new.actor_id then raise exception 'Artifact submitter cannot revoke own release review'; end if;
      return new;
    end;
    $review_revocation_guard$;
    create trigger fuma_artifact_review_revocation_guard_v2 before insert on fuma_artifact_review_revocations_v2 for each row execute function fuma_artifact_review_revocation_guard_v2();

    create index fuma_artifact_review_marketplace_v2 on fuma_artifact_review_decisions_v2 (decided_at desc,submission_id) where decision='approved';
    create index fuma_artifact_review_package_history_v2 on fuma_artifact_review_submissions_v2 (artifact_kind,package_id,submitted_at desc);
  `,
})
