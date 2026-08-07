import type { HostedMigration } from '../migrationPolicy'

/**
 * DNS instructions that can express email.
 *
 * The original `fuma_domain_dns_instructions` cannot carry a mail configuration, for
 * two separate reasons — and neither is fixable in place, because hosted migrations
 * are additive and forward-only, so dropping a check constraint or replacing a
 * primary key is not available.
 *
 *   1. `record_type` permits only CNAME, TXT and A. Mail needs MX.
 *   2. The primary key is `(domain_id, record_type, name, purpose)`. Zoho publishes
 *      **three** MX records at the same name for the same purpose, differing only in
 *      value and preference. That key holds one of them. The other two would be lost
 *      on insert, and nothing would look wrong until the primary mail server went
 *      down and there was no backup to fall to.
 *
 * So authority moves to a v2 table whose key is the whole record. The legacy table
 * stays immutable and is backfilled across, matching how free-host portability was
 * handled in 000082.
 *
 * The `priority` column is nullable and constrained: MX rows must carry a preference,
 * and other types must not. A priority on a CNAME would be meaningless, and an MX
 * without one is not a valid record.
 */
export const emailDnsInstructionsMigration: HostedMigration = Object.freeze({
  id: '000085_email_dns_instructions',
  description: 'Add v2 DNS instructions supporting MX records and email purposes',
  sql: String.raw`
create table fuma_domain_dns_instructions_v2 (
  domain_id text not null references fuma_domains(domain_id) on update cascade on delete restrict,
  record_type text not null check(record_type in ('CNAME','TXT','A','MX')),
  name text not null,
  value text not null,
  priority integer null check(priority is null or (priority between 0 and 65535)),
  ttl_seconds integer not null default 3600 check(ttl_seconds between 60 and 604800),
  purpose text not null check(purpose in (
    'routing','ownership','tls-validation',
    'mail-routing','spf','dkim','dmarc','mail-verification','autodiscover'
  )),
  required boolean not null default true,
  version bigint not null,
  -- Value is part of the identity, which is what allows a provider's full MX set to
  -- coexist instead of collapsing to one row.
  --
  -- Priority is deliberately NOT in the key. PostgreSQL forces every primary-key
  -- column to be NOT NULL, which would contradict the rule below that non-MX records
  -- carry no preference. It is also unnecessary: a provider's MX records differ by
  -- host, so value alone separates them — and two MX rows with the same host at
  -- different preferences would be a misconfiguration this key correctly rejects.
  primary key(domain_id,record_type,name,purpose,value),
  -- An MX record without a preference is invalid; a preference on anything else is
  -- meaningless. Both are refused rather than stored and ignored.
  constraint fuma_dns_v2_mx_requires_priority check (
    (record_type='MX' and priority is not null)
    or (record_type<>'MX' and priority is null)
  ),
  -- A domain may publish exactly one SPF record. Two make SPF invalid for the whole
  -- domain, which shows up as mail failing authentication rather than as an error.
  constraint fuma_dns_v2_spf_is_txt check (purpose<>'spf' or record_type='TXT'),
  constraint fuma_dns_v2_name_shape check (
    name=lower(name) and length(name) between 1 and 253
  )
);

insert into fuma_domain_dns_instructions_v2(
  domain_id,record_type,name,value,priority,ttl_seconds,purpose,required,version
)
select domain_id,record_type,name,value,null,3600,purpose,true,version
from fuma_domain_dns_instructions;

-- One SPF record per domain, enforced by the database rather than by convention.
create unique index fuma_dns_v2_single_spf_idx
  on fuma_domain_dns_instructions_v2(domain_id) where purpose='spf';

-- Mail routing is read as a set ordered by preference, so the index matches the read.
create index fuma_dns_v2_mail_routing_idx
  on fuma_domain_dns_instructions_v2(domain_id,priority)
  where record_type='MX' and purpose='mail-routing';

create index fuma_dns_v2_domain_purpose_idx
  on fuma_domain_dns_instructions_v2(domain_id,purpose,record_type);
`,
})
