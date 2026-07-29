import type { HostedMigration } from '../migrationPolicy'

export const aiPaymentSetupMigration: HostedMigration = Object.freeze({
  id: '000074_ai_payment_setup',
  description: 'Add AI-confirmed reviewed payment setup proposals and one-time secure credential handoffs',
  sql: `
    create table fuma_ai_payment_setup_proposals_v1 (
      proposal_id text primary key,
      conversation_id text not null,
      tool_call_id text not null,
      platform_id text not null,
      organization_id text not null,
      workspace_id text not null,
      site_id text not null,
      owner_key text not null,
      owner_generation bigint not null check (owner_generation>0),
      profile_id text not null check (profile_id in ('website','publication')),
      actor_id text not null,
      review_submission_id text not null references fuma_artifact_review_submissions_v2(submission_id) on delete restrict,
      review_decision_id text not null references fuma_artifact_review_decisions_v2(decision_id) on delete restrict,
      review_signature_key_id text not null,
      artifact_id text not null references fuma_artifact_releases_v2(artifact_id) on delete restrict,
      package_id text not null check (package_id='fuma.customer-payments'),
      exact_version text not null check (exact_version='1.0.0'),
      content_hash_sha256 text not null check (content_hash_sha256 ~ '^[a-f0-9]{64}$'),
      permissions_json jsonb not null check (permissions_json='["cms.routes","modules.register","payments.customer.create","payments.customer.refund"]'::jsonb),
      purpose text not null check (purpose in ('deposit','donation','checkout')),
      block_id text not null check (block_id in (
        'fuma.customer-payments.deposit','fuma.customer-payments.donation','fuma.customer-payments.checkout'
      )),
      fee_disclosure_version text not null check (fee_disclosure_version='fuma-customer-payments-fees-v1'),
      state text not null check (state in ('proposed','confirmed','credential-stored','tested')),
      challenge_id text null,
      challenge_nonce_hash_sha256 text null check (challenge_nonce_hash_sha256 is null or challenge_nonce_hash_sha256 ~ '^[a-f0-9]{64}$'),
      challenge_expires_at timestamptz null,
      confirmation_id text null,
      installation_id text null,
      credential_id text null references fuma_customer_merchant_credentials_v2(credential_id) on delete restrict,
      preview_receipt_fingerprint_sha256 text null check (preview_receipt_fingerprint_sha256 is null or preview_receipt_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
      proposal_json jsonb not null check (jsonb_typeof(proposal_json)='object'),
      created_at timestamptz not null,
      expires_at timestamptz not null check (expires_at>created_at),
      confirmed_at timestamptz null,
      credential_stored_at timestamptz null,
      tested_at timestamptz null,
      unique (conversation_id,tool_call_id),
      foreign key (conversation_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,actor_id)
        references fuma_site_ai_conversation_bindings
          (conversation_id,platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,profile_id,actor_id)
        on update cascade on delete restrict,
      check (not (proposal_json ?| array['publicKey','secretKey','confirmationNonce','handoffToken','tokenHashSha256'])),
      check ((purpose='deposit' and block_id='fuma.customer-payments.deposit')
        or (purpose='donation' and block_id='fuma.customer-payments.donation')
        or (purpose='checkout' and block_id='fuma.customer-payments.checkout')),
      check ((challenge_id is null and challenge_nonce_hash_sha256 is null and challenge_expires_at is null)
        or (challenge_id is not null and challenge_nonce_hash_sha256 is not null and challenge_expires_at is not null)),
      check ((state='proposed' and confirmation_id is null and installation_id is null and credential_id is null
          and confirmed_at is null and credential_stored_at is null and tested_at is null and preview_receipt_fingerprint_sha256 is null)
        or (state='confirmed' and confirmation_id is not null and installation_id is not null and credential_id is null
          and confirmed_at is not null and credential_stored_at is null and tested_at is null and preview_receipt_fingerprint_sha256 is null)
        or (state='credential-stored' and confirmation_id is not null and installation_id is not null and credential_id is not null
          and confirmed_at is not null and credential_stored_at is not null and tested_at is null and preview_receipt_fingerprint_sha256 is null)
        or (state='tested' and confirmation_id is not null and installation_id is not null and credential_id is not null
          and confirmed_at is not null and credential_stored_at is not null and tested_at is not null and preview_receipt_fingerprint_sha256 is not null))
    );

    create table fuma_ai_payment_setup_handoffs_v1 (
      handoff_id text primary key,
      proposal_id text not null unique references fuma_ai_payment_setup_proposals_v1(proposal_id) on delete restrict,
      token_hash_sha256 text not null unique check (token_hash_sha256 ~ '^[a-f0-9]{64}$'),
      audience text not null check (audience='secure-payment-settings'),
      state text not null check (state in ('issued','consuming','consumed')),
      handoff_json jsonb not null check (jsonb_typeof(handoff_json)='object'),
      expires_at timestamptz not null,
      created_at timestamptz not null,
      consumed_at timestamptz null,
      check (not (handoff_json ?| array['publicKey','secretKey','handoffToken','confirmationNonce'])),
      check ((state in ('issued','consuming') and consumed_at is null)
        or (state='consumed' and consumed_at is not null))
    );

    create function fuma_ai_payment_setup_proposal_guard_v1() returns trigger language plpgsql as $ai_payment_setup_proposal_guard$
    declare submission fuma_artifact_review_submissions_v2%rowtype;
    declare decision fuma_artifact_review_decisions_v2%rowtype;
    declare installation fuma_artifact_installations_v2%rowtype;
    declare credential fuma_customer_merchant_credentials_v2%rowtype;
    begin
      if tg_op='DELETE' then raise exception 'AI payment proposal evidence is append-only'; end if;
      select * into submission from fuma_artifact_review_submissions_v2 where submission_id=new.review_submission_id for share;
      select * into decision from fuma_artifact_review_decisions_v2 where decision_id=new.review_decision_id for share;
      if submission.artifact_id is null or decision.decision_id is null or decision.submission_id<>submission.submission_id
        or decision.decision<>'approved' or decision.signature_key_id<>new.review_signature_key_id
        or submission.artifact_id<>new.artifact_id or submission.package_id<>new.package_id
        or submission.exact_version<>new.exact_version or submission.content_hash_sha256<>new.content_hash_sha256 then
        raise exception 'AI payment proposal review binding is invalid';
      end if;
      if tg_op='UPDATE' then
        if (new.proposal_id,new.conversation_id,new.tool_call_id,new.platform_id,new.organization_id,new.workspace_id,
            new.site_id,new.owner_key,new.owner_generation,new.profile_id,new.actor_id,new.review_submission_id,
            new.review_decision_id,new.review_signature_key_id,new.artifact_id,new.package_id,new.exact_version,
            new.content_hash_sha256,new.permissions_json,new.purpose,new.block_id,new.fee_disclosure_version,new.created_at,new.expires_at)
          is distinct from
           (old.proposal_id,old.conversation_id,old.tool_call_id,old.platform_id,old.organization_id,old.workspace_id,
            old.site_id,old.owner_key,old.owner_generation,old.profile_id,old.actor_id,old.review_submission_id,
            old.review_decision_id,old.review_signature_key_id,old.artifact_id,old.package_id,old.exact_version,
            old.content_hash_sha256,old.permissions_json,old.purpose,old.block_id,old.fee_disclosure_version,old.created_at,old.expires_at) then
          raise exception 'AI payment proposal immutable identity changed';
        end if;
        if old.state='proposed' and new.state='confirmed' then
          if exists (select 1 from fuma_artifact_review_revocations_v2 where decision_id=new.review_decision_id) then
            raise exception 'Revoked payment artifact cannot be confirmed';
          end if;
          select * into installation from fuma_artifact_installations_v2
            where platform_id=new.platform_id and organization_id=new.organization_id
              and workspace_id=new.workspace_id and site_id=new.site_id and owner_key=new.owner_key
              and owner_generation=new.owner_generation and installation_id=new.installation_id for share;
          if installation.installation_id is null or installation.state<>'active' or installation.artifact_id<>new.artifact_id
            or installation.package_id<>new.package_id or installation.exact_version<>new.exact_version
            or installation.content_hash_sha256<>new.content_hash_sha256
            or installation.execution_policy<>'plugin-sandbox-worker' or installation.secret_json is not null then
            raise exception 'AI payment proposal installation binding is invalid';
          end if;
        elsif not ((old.state='proposed' and new.state='proposed')
          or (old.state='confirmed' and new.state='credential-stored')
          or (old.state='credential-stored' and new.state='tested')) then
          raise exception 'AI payment proposal state transition is invalid';
        end if;
      end if;
      if new.credential_id is not null then
        select * into credential from fuma_customer_merchant_credentials_v2 where credential_id=new.credential_id for share;
        if credential.credential_id is null or credential.state<>'active'
          or (credential.platform_id,credential.organization_id,credential.workspace_id,credential.site_id,
              credential.owner_key,credential.owner_generation)
            is distinct from (new.platform_id,new.organization_id,new.workspace_id,new.site_id,new.owner_key,new.owner_generation) then
          raise exception 'AI payment proposal credential binding is invalid';
        end if;
      end if;
      return new;
    end;
    $ai_payment_setup_proposal_guard$;
    create trigger fuma_ai_payment_setup_proposal_guard_v1 before insert or update or delete on fuma_ai_payment_setup_proposals_v1
      for each row execute function fuma_ai_payment_setup_proposal_guard_v1();

    create function fuma_ai_payment_setup_handoff_guard_v1() returns trigger language plpgsql as $ai_payment_setup_handoff_guard$
    begin
      if tg_op='DELETE' or (new.handoff_id,new.proposal_id,new.token_hash_sha256,new.audience,new.expires_at,new.created_at)
        is distinct from (old.handoff_id,old.proposal_id,old.token_hash_sha256,old.audience,old.expires_at,old.created_at)
        or not ((old.state='issued' and new.state='consuming') or (old.state='consuming' and new.state='consumed')) then
        raise exception 'AI payment secure handoff transition is invalid';
      end if;
      return new;
    end;
    $ai_payment_setup_handoff_guard$;
    create trigger fuma_ai_payment_setup_handoff_guard_v1 before update or delete on fuma_ai_payment_setup_handoffs_v1
      for each row execute function fuma_ai_payment_setup_handoff_guard_v1();

    create index fuma_ai_payment_setup_scope_v1 on fuma_ai_payment_setup_proposals_v1
      (platform_id,organization_id,workspace_id,site_id,owner_key,owner_generation,actor_id,state,created_at desc);
    create index fuma_ai_payment_setup_handoff_expiry_v1 on fuma_ai_payment_setup_handoffs_v1(state,expires_at);
  `,
})
