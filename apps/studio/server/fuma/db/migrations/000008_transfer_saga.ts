import type { HostedMigration } from '../migrationPolicy'

export const transferSagaMigration: HostedMigration = {
  id: '000008_transfer_saga',
  description: 'Create durable site transfer proposals and saga state',
  sql: `
    create table fuma_site_transfer_proposals (
      platform_id text not null,
      id text not null,
      source_organization_id text not null,
      source_workspace_id text not null,
      source_site_id text not null,
      destination_organization_id text not null,
      destination_workspace_id text not null,
      destination_site_id text not null,
      manifest_json jsonb not null,
      state text not null default 'proposed' check (state in (
        'proposed',
        'awaiting-confirmations',
        'ready',
        'running',
        'resume-requested',
        'cancellation-requested',
        'compensating',
        'failed',
        'completed',
        'cancelled'
      )),
      proposed_by_user_id text not null,
      proposed_by_session_id text not null,
      proposed_request_id text not null,
      cancellation_requested_by_user_id text null,
      cancellation_request_id text null,
      cancellation_reason_code text null,
      resume_requested_by_user_id text null,
      resume_request_id text null,
      resume_reason_code text null,
      resume_count integer not null default 0 check (resume_count >= 0),
      failure_json jsonb null,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      ready_at timestamptz null,
      started_at timestamptz null,
      compensation_started_at timestamptz null,
      compensation_completed_at timestamptz null,
      completed_at timestamptz null,
      cancelled_at timestamptz null,
      primary key (platform_id, id),
      constraint fuma_site_transfer_proposals_nonempty_ids check (
        btrim(platform_id) <> ''
        and btrim(id) <> ''
        and btrim(source_organization_id) <> ''
        and btrim(source_workspace_id) <> ''
        and btrim(source_site_id) <> ''
        and btrim(destination_organization_id) <> ''
        and btrim(destination_workspace_id) <> ''
        and btrim(destination_site_id) <> ''
        and btrim(proposed_by_user_id) <> ''
        and btrim(proposed_by_session_id) <> ''
        and btrim(proposed_request_id) <> ''
      ),
      constraint fuma_site_transfer_proposals_same_site check (
        source_site_id = destination_site_id
      ),
      constraint fuma_site_transfer_proposals_distinct_owners check (
        source_organization_id <> destination_organization_id
        or source_workspace_id <> destination_workspace_id
      ),
      constraint fuma_site_transfer_proposals_manifest_object check (
        jsonb_typeof(manifest_json) = 'object'
      ),
      constraint fuma_site_transfer_proposals_cancellation_shape check (
        (cancellation_requested_by_user_id is null
          and cancellation_request_id is null
          and cancellation_reason_code is null)
        or (cancellation_requested_by_user_id is not null
          and cancellation_request_id is not null
          and cancellation_reason_code is not null
          and btrim(cancellation_requested_by_user_id) <> ''
          and btrim(cancellation_request_id) <> ''
          and btrim(cancellation_reason_code) <> '')
      ),
      constraint fuma_site_transfer_proposals_resume_shape check (
        (resume_count = 0
          and resume_requested_by_user_id is null
          and resume_request_id is null
          and resume_reason_code is null)
        or (resume_count > 0
          and resume_requested_by_user_id is not null
          and resume_request_id is not null
          and resume_reason_code is not null
          and btrim(resume_requested_by_user_id) <> ''
          and btrim(resume_request_id) <> ''
          and btrim(resume_reason_code) <> '')
      ),
      constraint fuma_site_transfer_proposals_failure_object check (
        failure_json is null or jsonb_typeof(failure_json) = 'object'
      ),
      constraint fuma_site_transfer_proposals_lifecycle_shape check (
        (state in ('proposed', 'awaiting-confirmations')
          and (state <> 'proposed' or updated_at = created_at)
          and ready_at is null and started_at is null
          and compensation_started_at is null and compensation_completed_at is null
          and completed_at is null and cancelled_at is null
          and failure_json is null
          and cancellation_requested_by_user_id is null
          and resume_count = 0)
        or (state = 'ready'
          and ready_at is not null and started_at is null
          and compensation_started_at is null and compensation_completed_at is null
          and completed_at is null and cancelled_at is null
          and failure_json is null
          and cancellation_requested_by_user_id is null
          and resume_count = 0)
        or (state = 'running'
          and ready_at is not null and started_at is not null
          and compensation_started_at is null and compensation_completed_at is null
          and completed_at is null and cancelled_at is null
          and failure_json is null
          and cancellation_requested_by_user_id is null)
        or (state = 'resume-requested'
          and ready_at is not null and started_at is not null
          and compensation_started_at is null and compensation_completed_at is null
          and completed_at is null and cancelled_at is null
          and failure_json is null
          and cancellation_requested_by_user_id is null
          and resume_count > 0)
        or (state = 'cancellation-requested'
          and (started_at is null or ready_at is not null)
          and compensation_started_at is null and compensation_completed_at is null
          and completed_at is null and cancelled_at is null
          and failure_json is null
          and cancellation_requested_by_user_id is not null)
        or (state = 'compensating'
          and ready_at is not null and started_at is not null
          and compensation_started_at is not null and compensation_completed_at is null
          and completed_at is null and cancelled_at is null
          and failure_json is not null
          and cancellation_requested_by_user_id is null)
        or (state = 'failed'
          and ready_at is not null and started_at is not null
          and compensation_started_at is not null and compensation_completed_at is not null
          and completed_at is null and cancelled_at is null
          and failure_json is not null
          and cancellation_requested_by_user_id is null)
        or (state = 'completed'
          and ready_at is not null and started_at is not null
          and compensation_started_at is null and compensation_completed_at is null
          and completed_at is not null and cancelled_at is null
          and failure_json is null
          and cancellation_requested_by_user_id is null)
        or (state = 'cancelled'
          and (started_at is null or ready_at is not null)
          and compensation_started_at is null and compensation_completed_at is null
          and completed_at is null and cancelled_at is not null
          and failure_json is null
          and cancellation_requested_by_user_id is not null)
      ),
      constraint fuma_site_transfer_proposals_time_order check (
        updated_at >= created_at
        and (ready_at is null
          or (ready_at >= created_at and ready_at <= updated_at))
        and (started_at is null
          or (ready_at is not null and started_at >= ready_at and started_at <= updated_at))
        and (compensation_started_at is null
          or (started_at is not null
            and compensation_started_at >= started_at
            and compensation_started_at <= updated_at))
        and (compensation_completed_at is null
          or (compensation_started_at is not null
            and compensation_completed_at >= compensation_started_at
            and compensation_completed_at <= updated_at))
        and (completed_at is null
          or (started_at is not null
            and completed_at >= started_at
            and completed_at <= updated_at))
        and (cancelled_at is null
          or (cancelled_at >= coalesce(started_at, ready_at, created_at)
            and cancelled_at <= updated_at))
        and (resume_count = 0 or started_at is not null)
      )
    );

    comment on table fuma_site_transfer_proposals is
      'Transfer ownership coordinates are immutable historical snapshots and intentionally have no foreign keys to mutable tenant authority, matching FUMA audit history semantics.';

    comment on column fuma_site_transfer_proposals.manifest_json is
      'Validated transfer manifest only; secrets, credentials, and mutable authority objects are forbidden.';

    create index fuma_site_transfer_proposals_source_recency_idx
      on fuma_site_transfer_proposals (
        platform_id,
        source_organization_id,
        source_workspace_id,
        source_site_id,
        created_at desc,
        id
      );

    create index fuma_site_transfer_proposals_destination_recency_idx
      on fuma_site_transfer_proposals (
        platform_id,
        destination_organization_id,
        destination_workspace_id,
        destination_site_id,
        created_at desc,
        id
      );

    create index fuma_site_transfer_proposals_state_recency_idx
      on fuma_site_transfer_proposals (platform_id, state, updated_at, id)
      where state not in ('completed', 'cancelled');

    create function fuma_site_transfer_proposals_preserve_snapshot()
    returns trigger
    language plpgsql
    as $transfer_snapshot$
    begin
      if new.platform_id is distinct from old.platform_id
        or new.id is distinct from old.id
        or new.source_organization_id is distinct from old.source_organization_id
        or new.source_workspace_id is distinct from old.source_workspace_id
        or new.source_site_id is distinct from old.source_site_id
        or new.destination_organization_id is distinct from old.destination_organization_id
        or new.destination_workspace_id is distinct from old.destination_workspace_id
        or new.destination_site_id is distinct from old.destination_site_id
        or new.manifest_json is distinct from old.manifest_json
        or new.proposed_by_user_id is distinct from old.proposed_by_user_id
        or new.proposed_by_session_id is distinct from old.proposed_by_session_id
        or new.proposed_request_id is distinct from old.proposed_request_id
        or new.created_at is distinct from old.created_at
      then
        raise exception 'site transfer proposal ownership, manifest, proposer, and creation snapshots are immutable'
          using errcode = '55000';
      end if;
      return new;
    end;
    $transfer_snapshot$;

    create trigger fuma_site_transfer_proposals_preserve_snapshot
      before update on fuma_site_transfer_proposals
      for each row
      execute function fuma_site_transfer_proposals_preserve_snapshot();

    create function fuma_site_transfer_proposals_reject_delete()
    returns trigger
    language plpgsql
    as $transfer_proposal_delete$
    begin
      raise exception 'site transfer proposals are durable history: delete is forbidden'
        using errcode = '55000';
      return null;
    end;
    $transfer_proposal_delete$;

    create trigger fuma_site_transfer_proposals_reject_delete
      before delete on fuma_site_transfer_proposals
      for each statement
      execute function fuma_site_transfer_proposals_reject_delete();

    create table fuma_site_transfer_confirmations (
      platform_id text not null,
      transfer_id text not null,
      side text not null check (side in ('source', 'destination')),
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      confirmed_by_user_id text not null,
      confirmed_by_session_id text not null,
      request_id text not null,
      confirmed_at timestamptz not null default current_timestamp,
      primary key (platform_id, transfer_id, side),
      constraint fuma_site_transfer_confirmations_transfer_fk
        foreign key (platform_id, transfer_id)
        references fuma_site_transfer_proposals(platform_id, id)
        on delete restrict,
      constraint fuma_site_transfer_confirmations_nonempty_ids check (
        btrim(platform_id) <> ''
        and btrim(transfer_id) <> ''
        and btrim(organization_id) <> ''
        and btrim(workspace_id) <> ''
        and btrim(site_id) <> ''
        and btrim(confirmed_by_user_id) <> ''
        and btrim(confirmed_by_session_id) <> ''
        and btrim(request_id) <> ''
      )
    );

    comment on table fuma_site_transfer_confirmations is
      'One immutable confirmation snapshot per source and destination side; confirmer IDs intentionally remain denormalized for durable history.';

    create function fuma_site_transfer_confirmations_validate_insert()
    returns trigger
    language plpgsql
    as $transfer_confirmation_insert$
    declare
      proposal fuma_site_transfer_proposals%rowtype;
    begin
      select * into proposal
      from fuma_site_transfer_proposals
      where platform_id = new.platform_id and id = new.transfer_id
      for update;

      if not found then
        raise exception 'site transfer confirmation has no proposal: %', new.transfer_id
          using errcode = '23503';
      end if;

      if new.confirmed_at <= proposal.updated_at
        or exists (
          select 1
          from fuma_site_transfer_confirmations as prior
          where prior.platform_id = new.platform_id
            and prior.transfer_id = new.transfer_id
            and prior.confirmed_at >= new.confirmed_at
        )
      then
        raise exception 'site transfer confirmation timestamp must advance monotonically'
          using errcode = '23514';
      end if;

      if new.side = 'source' and (
        new.organization_id is distinct from proposal.source_organization_id
        or new.workspace_id is distinct from proposal.source_workspace_id
        or new.site_id is distinct from proposal.source_site_id
      ) then
        raise exception 'source confirmation ancestry does not exactly match transfer proposal %', new.transfer_id
          using errcode = '23514';
      end if;

      if new.side = 'destination' and (
        new.organization_id is distinct from proposal.destination_organization_id
        or new.workspace_id is distinct from proposal.destination_workspace_id
        or new.site_id is distinct from proposal.destination_site_id
      ) then
        raise exception 'destination confirmation ancestry does not exactly match transfer proposal %', new.transfer_id
          using errcode = '23514';
      end if;

      if exists (
        select 1
        from fuma_site_transfer_confirmations as opposite
        where opposite.platform_id = new.platform_id
          and opposite.transfer_id = new.transfer_id
          and opposite.side <> new.side
          and opposite.confirmed_by_user_id = new.confirmed_by_user_id
      ) then
        raise exception 'source and destination confirmations require distinct effective users for transfer %', new.transfer_id
          using errcode = '23514';
      end if;

      return new;
    end;
    $transfer_confirmation_insert$;

    create trigger fuma_site_transfer_confirmations_validate_insert
      before insert on fuma_site_transfer_confirmations
      for each row
      execute function fuma_site_transfer_confirmations_validate_insert();

    create function fuma_site_transfer_proposals_validate_lifecycle()
    returns trigger
    language plpgsql
    as $transfer_lifecycle$
    declare
      confirmation_count integer;
      confirmer_count integer;
      latest_confirmation_at timestamptz;
    begin
      if tg_op = 'INSERT' then
        if new.state <> 'proposed' then
          raise exception 'site transfer proposal must begin in proposed state'
            using errcode = '23514';
        end if;
        return new;
      end if;

      if old.state in ('failed', 'completed', 'cancelled') then
        raise exception 'terminal site transfer proposal % cannot be updated', old.id
          using errcode = '55000';
      end if;

      if new.updated_at <= old.updated_at then
        raise exception 'site transfer proposal updated_at must advance monotonically'
          using errcode = '23514';
      end if;

      if new.state <> old.state and not (
        (old.state = 'proposed' and new.state in ('awaiting-confirmations', 'cancellation-requested'))
        or (old.state = 'awaiting-confirmations' and new.state in ('ready', 'cancellation-requested'))
        or (old.state = 'ready' and new.state in ('running', 'cancellation-requested'))
        or (old.state = 'running' and new.state in (
          'resume-requested', 'cancellation-requested', 'compensating', 'completed'
        ))
        or (old.state = 'resume-requested' and new.state in ('running', 'cancellation-requested'))
        or (old.state = 'cancellation-requested' and new.state = 'cancelled')
        or (old.state = 'compensating' and new.state = 'failed')
      ) then
        raise exception 'illegal site transfer proposal transition: % -> %', old.state, new.state
          using errcode = '23514';
      end if;

      if old.ready_at is null and new.ready_at is not null
        and not (old.state = 'awaiting-confirmations' and new.state = 'ready')
      then
        raise exception 'ready_at may only be recorded while becoming ready'
          using errcode = '23514';
      end if;

      if old.started_at is null and new.started_at is not null
        and not (old.state = 'ready' and new.state = 'running')
      then
        raise exception 'started_at may only be recorded while starting a ready transfer'
          using errcode = '23514';
      end if;

      if old.compensation_started_at is null and new.compensation_started_at is not null
        and not (old.state = 'running' and new.state = 'compensating')
      then
        raise exception 'compensation_started_at may only be recorded while entering compensation'
          using errcode = '23514';
      end if;

      if old.compensation_completed_at is null and new.compensation_completed_at is not null
        and not (old.state = 'compensating' and new.state = 'failed')
      then
        raise exception 'compensation_completed_at may only be recorded while becoming failed'
          using errcode = '23514';
      end if;

      if old.completed_at is null and new.completed_at is not null
        and not (old.state = 'running' and new.state = 'completed')
      then
        raise exception 'completed_at may only be recorded while completing a running transfer'
          using errcode = '23514';
      end if;

      if old.cancelled_at is null and new.cancelled_at is not null
        and not (old.state = 'cancellation-requested' and new.state = 'cancelled')
      then
        raise exception 'cancelled_at may only be recorded after cancellation was requested'
          using errcode = '23514';
      end if;

      if old.cancellation_requested_by_user_id is null
        and new.cancellation_requested_by_user_id is not null
        and new.state <> 'cancellation-requested'
      then
        raise exception 'cancellation request fields may only be recorded while requesting cancellation'
          using errcode = '23514';
      end if;

      if new.resume_count = old.resume_count + 1
        and not (old.state = 'running' and new.state = 'resume-requested')
      then
        raise exception 'resume request fields may only advance while requesting resume'
          using errcode = '23514';
      end if;

      if old.failure_json is null and new.failure_json is not null
        and not (old.state = 'running' and new.state = 'compensating')
      then
        raise exception 'failure snapshot may only be recorded while entering compensation'
          using errcode = '23514';
      end if;

      if (old.ready_at is not null and new.ready_at is distinct from old.ready_at)
        or (old.started_at is not null and new.started_at is distinct from old.started_at)
        or (old.compensation_started_at is not null
          and new.compensation_started_at is distinct from old.compensation_started_at)
        or (old.compensation_completed_at is not null
          and new.compensation_completed_at is distinct from old.compensation_completed_at)
        or (old.completed_at is not null and new.completed_at is distinct from old.completed_at)
        or (old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at)
      then
        raise exception 'site transfer lifecycle fact timestamps are immutable once recorded'
          using errcode = '55000';
      end if;

      if (old.ready_at is null and new.ready_at is not null and new.ready_at < old.updated_at)
        or (old.started_at is null and new.started_at is not null and new.started_at < old.updated_at)
        or (old.compensation_started_at is null
          and new.compensation_started_at is not null
          and new.compensation_started_at < old.updated_at)
        or (old.compensation_completed_at is null
          and new.compensation_completed_at is not null
          and new.compensation_completed_at < old.updated_at)
        or (old.completed_at is null and new.completed_at is not null
          and new.completed_at < old.updated_at)
        or (old.cancelled_at is null and new.cancelled_at is not null
          and new.cancelled_at < old.updated_at)
      then
        raise exception 'new site transfer lifecycle facts cannot predate the prior version'
          using errcode = '23514';
      end if;

      if old.cancellation_requested_by_user_id is not null and (
        new.cancellation_requested_by_user_id is distinct from old.cancellation_requested_by_user_id
        or new.cancellation_request_id is distinct from old.cancellation_request_id
        or new.cancellation_reason_code is distinct from old.cancellation_reason_code
      ) then
        raise exception 'site transfer cancellation request is immutable once recorded'
          using errcode = '55000';
      end if;

      if new.resume_count < old.resume_count
        or new.resume_count > old.resume_count + 1
        or (new.resume_count = old.resume_count and (
          new.resume_requested_by_user_id is distinct from old.resume_requested_by_user_id
          or new.resume_request_id is distinct from old.resume_request_id
          or new.resume_reason_code is distinct from old.resume_reason_code
        ))
      then
        raise exception 'site transfer resume requests must advance exactly once and never regress'
          using errcode = '23514';
      end if;

      if old.failure_json is not null and new.failure_json is distinct from old.failure_json then
        raise exception 'site transfer failure snapshot is immutable once recorded'
          using errcode = '55000';
      end if;

      select count(*), count(distinct confirmed_by_user_id), max(confirmed_at)
        into confirmation_count, confirmer_count, latest_confirmation_at
      from fuma_site_transfer_confirmations
      where platform_id = new.platform_id and transfer_id = new.id;

      if new.ready_at is not null then
        if confirmation_count <> 2 or confirmer_count <> 2 then
          raise exception 'ready site transfer proposal requires two distinct exact-side confirmations'
            using errcode = '23514';
        end if;
        if new.ready_at is distinct from latest_confirmation_at then
          raise exception 'ready_at must equal the latest exact-side confirmation timestamp'
            using errcode = '23514';
        end if;
      elsif new.state = 'awaiting-confirmations' and confirmation_count <> 1 then
        raise exception 'awaiting-confirmations requires exactly one exact-side confirmation'
          using errcode = '23514';
      elsif new.state = 'proposed' and confirmation_count <> 0 then
        raise exception 'proposed transfer cannot already contain confirmations'
          using errcode = '23514';
      end if;

      return new;
    end;
    $transfer_lifecycle$;

    create trigger fuma_site_transfer_proposals_validate_lifecycle
      before insert or update on fuma_site_transfer_proposals
      for each row
      execute function fuma_site_transfer_proposals_validate_lifecycle();

    create function fuma_site_transfer_confirmations_reject_mutation()
    returns trigger
    language plpgsql
    as $transfer_confirmation$
    begin
      raise exception 'site transfer confirmations are immutable: % is forbidden', tg_op
        using errcode = '55000';
      return null;
    end;
    $transfer_confirmation$;

    create trigger fuma_site_transfer_confirmations_reject_update
      before update on fuma_site_transfer_confirmations
      for each statement
      execute function fuma_site_transfer_confirmations_reject_mutation();

    create trigger fuma_site_transfer_confirmations_reject_delete
      before delete on fuma_site_transfer_confirmations
      for each statement
      execute function fuma_site_transfer_confirmations_reject_mutation();

    create table fuma_site_transfer_locks (
      platform_id text not null,
      id text not null,
      transfer_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      fence bigint not null check (fence > 0),
      state text not null check (state in ('active', 'released')),
      acquired_by_job_id text not null,
      acquired_by_run_id text not null,
      request_id text not null,
      acquired_at timestamptz not null default current_timestamp,
      heartbeat_at timestamptz not null default current_timestamp,
      released_at timestamptz null,
      release_reason_code text null,
      primary key (platform_id, id),
      constraint fuma_site_transfer_locks_transfer_fk
        foreign key (platform_id, transfer_id)
        references fuma_site_transfer_proposals(platform_id, id)
        on delete restrict,
      constraint fuma_site_transfer_locks_nonempty_ids check (
        btrim(platform_id) <> ''
        and btrim(id) <> ''
        and btrim(transfer_id) <> ''
        and btrim(organization_id) <> ''
        and btrim(workspace_id) <> ''
        and btrim(site_id) <> ''
        and btrim(acquired_by_job_id) <> ''
        and btrim(acquired_by_run_id) <> ''
        and btrim(request_id) <> ''
      ),
      constraint fuma_site_transfer_locks_release_shape check (
        (state = 'active' and released_at is null and release_reason_code is null)
        or (state = 'released' and released_at is not null
          and btrim(release_reason_code) <> '')
      ),
      constraint fuma_site_transfer_locks_time_order check (
        heartbeat_at >= acquired_at
        and (released_at is null or released_at >= acquired_at)
      )
    );

    create function fuma_site_transfer_locks_validate_update()
    returns trigger
    language plpgsql
    as $transfer_lock_update$
    begin
      if new.platform_id is distinct from old.platform_id
        or new.id is distinct from old.id
        or new.transfer_id is distinct from old.transfer_id
        or new.organization_id is distinct from old.organization_id
        or new.workspace_id is distinct from old.workspace_id
        or new.site_id is distinct from old.site_id
        or new.fence is distinct from old.fence
        or new.acquired_by_job_id is distinct from old.acquired_by_job_id
        or new.acquired_by_run_id is distinct from old.acquired_by_run_id
        or new.request_id is distinct from old.request_id
        or new.acquired_at is distinct from old.acquired_at
      then
        raise exception 'site transfer lock identity, ancestry, fence, and acquisition facts are immutable'
          using errcode = '55000';
      end if;

      if old.state = 'released' then
        raise exception 'released site transfer lock % is immutable', old.id
          using errcode = '55000';
      end if;

      if new.heartbeat_at < old.heartbeat_at
        or new.state not in ('active', 'released')
      then
        raise exception 'site transfer lock heartbeat or state regressed'
          using errcode = '23514';
      end if;

      return new;
    end;
    $transfer_lock_update$;

    create trigger fuma_site_transfer_locks_validate_update
      before update on fuma_site_transfer_locks
      for each row
      execute function fuma_site_transfer_locks_validate_update();

    create function fuma_site_transfer_locks_reject_delete()
    returns trigger
    language plpgsql
    as $transfer_lock_delete$
    begin
      raise exception 'site transfer locks are durable fenced history: delete is forbidden'
        using errcode = '55000';
      return null;
    end;
    $transfer_lock_delete$;

    create trigger fuma_site_transfer_locks_reject_delete
      before delete on fuma_site_transfer_locks
      for each statement
      execute function fuma_site_transfer_locks_reject_delete();

    create unique index fuma_site_transfer_locks_active_site_unique
      on fuma_site_transfer_locks (platform_id, organization_id, workspace_id, site_id)
      where state = 'active';

    create unique index fuma_site_transfer_locks_active_transfer_unique
      on fuma_site_transfer_locks (platform_id, transfer_id)
      where state = 'active';

    create unique index fuma_site_transfer_locks_site_fence_unique
      on fuma_site_transfer_locks (
        platform_id,
        organization_id,
        workspace_id,
        site_id,
        fence
      );

    create unique index fuma_site_transfer_locks_identity_fence_unique
      on fuma_site_transfer_locks (platform_id, id, fence);

    create table fuma_site_transfer_steps (
      platform_id text not null,
      id text not null,
      transfer_id text not null,
      lock_id text not null,
      fence bigint not null check (fence > 0),
      definition_id text not null,
      sequence bigint not null check (
        sequence > 0 and sequence <= 9007199254740991
      ),
      attempt integer not null check (attempt > 0),
      kind text not null check (kind in ('forward', 'compensation')),
      state text not null check (state in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
      receipt_json jsonb null,
      error_json jsonb null,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      started_at timestamptz null,
      finished_at timestamptz null,
      primary key (platform_id, id),
      constraint fuma_site_transfer_steps_transfer_fk
        foreign key (platform_id, transfer_id)
        references fuma_site_transfer_proposals(platform_id, id)
        on delete restrict,
      constraint fuma_site_transfer_steps_lock_fence_fk
        foreign key (platform_id, lock_id, fence)
        references fuma_site_transfer_locks(platform_id, id, fence)
        on delete restrict,
      constraint fuma_site_transfer_steps_nonempty_ids check (
        btrim(platform_id) <> ''
        and btrim(id) <> ''
        and btrim(transfer_id) <> ''
        and btrim(lock_id) <> ''
        and btrim(definition_id) <> ''
      ),
      constraint fuma_site_transfer_steps_receipt_object check (
        receipt_json is null or jsonb_typeof(receipt_json) = 'object'
      ),
      constraint fuma_site_transfer_steps_error_object check (
        error_json is null or jsonb_typeof(error_json) = 'object'
      ),
      constraint fuma_site_transfer_steps_state_shape check (
        (state = 'pending'
          and started_at is null and finished_at is null
          and receipt_json is null and error_json is null)
        or (state = 'running'
          and started_at is not null and finished_at is null
          and receipt_json is null and error_json is null)
        or (state in ('succeeded', 'skipped')
          and started_at is not null and finished_at is not null
          and receipt_json is not null and error_json is null)
        or (state = 'failed'
          and started_at is not null and finished_at is not null
          and receipt_json is null and error_json is not null)
      ),
      constraint fuma_site_transfer_steps_time_order check (
        updated_at >= created_at
        and (started_at is null
          or (started_at >= created_at and started_at <= updated_at))
        and (finished_at is null
          or (started_at is not null
            and finished_at >= started_at
            and finished_at <= updated_at))
      )
    );

    create function fuma_site_transfer_steps_validate_mutation()
    returns trigger
    language plpgsql
    as $transfer_step_mutation$
    begin
      if tg_op = 'INSERT' then
        if (new.kind = 'forward' and new.state <> 'pending')
          or (new.kind = 'compensation' and new.state not in ('succeeded', 'skipped'))
        then
          raise exception 'site transfer attempts must append as pending forward work or terminal compensation facts'
            using errcode = '23514';
        end if;
        return new;
      end if;

      if new.platform_id is distinct from old.platform_id
        or new.id is distinct from old.id
        or new.transfer_id is distinct from old.transfer_id
        or new.lock_id is distinct from old.lock_id
        or new.fence is distinct from old.fence
        or new.definition_id is distinct from old.definition_id
        or new.sequence is distinct from old.sequence
        or new.attempt is distinct from old.attempt
        or new.kind is distinct from old.kind
        or new.created_at is distinct from old.created_at
      then
        raise exception 'site transfer step identity, definition, sequence, attempt, and fence are immutable'
          using errcode = '55000';
      end if;

      if old.state in ('succeeded', 'failed', 'skipped') then
        raise exception 'terminal site transfer step % is immutable', old.id
          using errcode = '55000';
      end if;

      if old.kind <> 'forward'
        or not (
          (old.state = 'pending' and new.state = 'running')
          or (old.state = 'running' and new.state in ('succeeded', 'failed'))
        )
        or new.updated_at <= old.updated_at
      then
        raise exception 'illegal site transfer step transition: % -> %', old.state, new.state
          using errcode = '23514';
      end if;

      return new;
    end;
    $transfer_step_mutation$;

    create trigger fuma_site_transfer_steps_validate_mutation
      before insert or update on fuma_site_transfer_steps
      for each row
      execute function fuma_site_transfer_steps_validate_mutation();

    create function fuma_site_transfer_steps_reject_delete()
    returns trigger
    language plpgsql
    as $transfer_step_delete$
    begin
      raise exception 'site transfer steps are durable attempt history: delete is forbidden'
        using errcode = '55000';
      return null;
    end;
    $transfer_step_delete$;

    create trigger fuma_site_transfer_steps_reject_delete
      before delete on fuma_site_transfer_steps
      for each statement
      execute function fuma_site_transfer_steps_reject_delete();

    create unique index fuma_site_transfer_steps_definition_attempt_unique
      on fuma_site_transfer_steps (
        platform_id,
        transfer_id,
        kind,
        definition_id,
        attempt
      );

    create index fuma_site_transfer_steps_runnable_idx
      on fuma_site_transfer_steps (
        platform_id,
        transfer_id,
        sequence,
        kind,
        definition_id,
        attempt,
        updated_at,
        id
      ) where state in ('pending', 'running', 'failed');

    create table fuma_site_transfer_collaborator_intents (
      platform_id text not null,
      id text not null,
      transfer_id text not null,
      user_id text not null,
      source_role text not null check (source_role in ('owner', 'admin', 'editor', 'viewer')),
      intent text not null check (intent in ('preserve', 'remove')),
      destination_role text null check (
        destination_role is null or destination_role in ('owner', 'admin', 'editor', 'viewer')
      ),
      state text not null default 'pending' check (state in (
        'pending', 'applying', 'applied', 'skipped', 'failed'
      )),
      receipt_json jsonb null,
      error_json jsonb null,
      created_at timestamptz not null default current_timestamp,
      updated_at timestamptz not null default current_timestamp,
      applied_at timestamptz null,
      primary key (platform_id, id),
      constraint fuma_site_transfer_collaborator_intents_transfer_fk
        foreign key (platform_id, transfer_id)
        references fuma_site_transfer_proposals(platform_id, id)
        on delete restrict,
      constraint fuma_site_transfer_collaborator_intents_nonempty_ids check (
        btrim(platform_id) <> ''
        and btrim(id) <> ''
        and btrim(transfer_id) <> ''
        and btrim(user_id) <> ''
      ),
      constraint fuma_site_transfer_collaborator_intents_role_shape check (
        (intent = 'preserve' and destination_role is not null)
        or (intent = 'remove' and destination_role is null)
      ),
      constraint fuma_site_transfer_collaborator_intents_receipt_object check (
        receipt_json is null or jsonb_typeof(receipt_json) = 'object'
      ),
      constraint fuma_site_transfer_collaborator_intents_error_object check (
        error_json is null or jsonb_typeof(error_json) = 'object'
      ),
      constraint fuma_site_transfer_collaborator_intents_state_shape check (
        (state in ('pending', 'applying')
          and receipt_json is null and error_json is null and applied_at is null)
        or (state in ('applied', 'skipped')
          and receipt_json is not null and error_json is null and applied_at is not null)
        or (state = 'failed'
          and receipt_json is null and error_json is not null and applied_at is null)
      )
    );

    comment on table fuma_site_transfer_collaborator_intents is
      'User and role values are immutable transfer-time intent snapshots and intentionally do not reference mutable staff authority.';

    create unique index fuma_site_transfer_collaborator_intents_user_unique
      on fuma_site_transfer_collaborator_intents (platform_id, transfer_id, user_id);

    create index fuma_site_transfer_collaborator_intents_state_idx
      on fuma_site_transfer_collaborator_intents (
        platform_id,
        transfer_id,
        state,
        updated_at,
        id
      );
  `,
}
