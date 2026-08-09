-- Better Auth 1.6.25 identity/session schema and Supabase-to-hosted transition.
-- This migration is safe for both a fresh database and an existing Onlook
-- database whose domain tables and Supabase auth schema already contain data.

CREATE TABLE IF NOT EXISTS "auth_users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "email" text NOT NULL UNIQUE,
    "email_verified" boolean DEFAULT false NOT NULL,
    "image" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_users_email_normalized_idx"
    ON "auth_users" (lower("email"));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_sessions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "token" text NOT NULL UNIQUE,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "ip_address" text,
    "user_agent" text,
    "user_id" uuid NOT NULL REFERENCES "auth_users"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_user_id_idx" ON "auth_sessions" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_accounts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "account_id" text NOT NULL,
    "provider_id" text NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "auth_users"("id") ON DELETE cascade,
    "access_token" text,
    "refresh_token" text,
    "id_token" text,
    "access_token_expires_at" timestamp with time zone,
    "refresh_token_expires_at" timestamp with time zone,
    "scope" text,
    "password" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_accounts_user_id_idx" ON "auth_accounts" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_accounts_provider_account_idx"
    ON "auth_accounts" ("provider_id", "account_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_accounts_user_credential_idx"
    ON "auth_accounts" ("user_id") WHERE "provider_id" = 'credential';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_verifications" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "identifier" text NOT NULL,
    "value" text NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_verifications_identifier_idx"
    ON "auth_verifications" ("identifier");
--> statement-breakpoint

-- Preserve Supabase user UUIDs, profile metadata, OAuth identities, and bcrypt
-- credential hashes when the legacy auth schema is present. Better Auth uses a
-- compatible bcrypt verifier for these rows and scrypt for every new password.
DO $transition$
BEGIN
    IF to_regclass('auth.users') IS NOT NULL THEN
        EXECUTE $sql$
            INSERT INTO public.auth_users (
                id, name, email, email_verified, image, created_at, updated_at
            )
            SELECT
                id,
                COALESCE(
                    raw_user_meta_data ->> 'full_name',
                    raw_user_meta_data ->> 'name',
                    split_part(email, '@', 1)
                ),
                lower(email),
                email_confirmed_at IS NOT NULL,
                COALESCE(
                    raw_user_meta_data ->> 'avatar_url',
                    raw_user_meta_data ->> 'picture'
                ),
                COALESCE(created_at, now()),
                COALESCE(updated_at, created_at, now())
            FROM auth.users
            WHERE email IS NOT NULL
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                email = EXCLUDED.email,
                email_verified = EXCLUDED.email_verified,
                image = COALESCE(EXCLUDED.image, public.auth_users.image),
                updated_at = EXCLUDED.updated_at
        $sql$;

        EXECUTE $sql$
            INSERT INTO public.auth_accounts (
                id, account_id, provider_id, user_id, password, created_at, updated_at
            )
            SELECT
                gen_random_uuid(),
                id::text,
                'credential',
                id,
                encrypted_password,
                COALESCE(created_at, now()),
                COALESCE(updated_at, created_at, now())
            FROM auth.users
            WHERE email IS NOT NULL
              AND encrypted_password IS NOT NULL
              AND encrypted_password <> ''
            ON CONFLICT (provider_id, account_id) DO UPDATE SET
                password = EXCLUDED.password,
                updated_at = EXCLUDED.updated_at
        $sql$;
    END IF;

    IF to_regclass('auth.identities') IS NOT NULL THEN
        EXECUTE $sql$
            INSERT INTO public.auth_accounts (
                id, account_id, provider_id, user_id, created_at, updated_at
            )
            SELECT
                gen_random_uuid(),
                COALESCE(provider_id, identity_data ->> 'sub', id::text),
                provider,
                user_id,
                COALESCE(created_at, now()),
                COALESCE(updated_at, created_at, now())
            FROM auth.identities
            WHERE provider IS NOT NULL
              AND provider <> 'email'
              AND EXISTS (
                  SELECT 1 FROM public.auth_users migrated_user
                  WHERE migrated_user.id = auth.identities.user_id
              )
            ON CONFLICT (provider_id, account_id) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                updated_at = EXCLUDED.updated_at
        $sql$;
    END IF;
END
$transition$;
--> statement-breakpoint

-- Also recover identities from domain profiles in hosted databases that no
-- longer contain the legacy auth schema.
INSERT INTO "auth_users" (id, name, email, email_verified, image, created_at, updated_at)
SELECT
    id,
    COALESCE(display_name, first_name, split_part(email, '@', 1)),
    lower(email),
    true,
    avatar_url,
    created_at,
    updated_at
FROM "users"
WHERE email IS NOT NULL
ON CONFLICT (id) DO UPDATE SET
    name = COALESCE("auth_users".name, EXCLUDED.name),
    image = COALESCE("auth_users".image, EXCLUDED.image);
--> statement-breakpoint

DO $constraints$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.users domain_user
        LEFT JOIN public.auth_users auth_user ON auth_user.id = domain_user.id
        WHERE auth_user.id IS NULL
    ) THEN
        RAISE EXCEPTION 'Cannot attach users to auth_users: one or more domain users lack a recoverable identity';
    END IF;

    ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_id_users_id_fk";
    ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_id_auth_users_id_fk";
    ALTER TABLE "users" ADD CONSTRAINT "users_id_auth_users_id_fk"
        FOREIGN KEY ("id") REFERENCES "auth_users"("id")
        ON DELETE cascade ON UPDATE cascade;
END
$constraints$;
--> statement-breakpoint

-- Remove all Supabase auth.uid()-based policy assumptions from the application
-- schema. The database connection is private; every request is authorized by
-- Better Auth plus project/membership checks in server procedures.
DO $policies$
DECLARE
    policy_record record;
    table_record record;
BEGIN
    FOR policy_record IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format(
            'DROP POLICY IF EXISTS %I ON %I.%I',
            policy_record.policyname,
            policy_record.schemaname,
            policy_record.tablename
        );
    END LOOP;

    FOR table_record IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname = 'public' AND rowsecurity
    LOOP
        EXECUTE format(
            'ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY',
            table_record.schemaname,
            table_record.tablename
        );
    END LOOP;
END
$policies$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS handle_conversations_changes ON "conversations";
--> statement-breakpoint
DROP TRIGGER IF EXISTS handle_messages_changes ON "messages";
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.project_changes();
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.user_has_project_access(uuid, text[]);
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.user_has_canvas_access(uuid, text[]);
--> statement-breakpoint
DO $realtime_policy$
BEGIN
    IF to_regclass('realtime.messages') IS NOT NULL THEN
        EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can receive broadcasts" ON realtime.messages';
    END IF;
END
$realtime_policy$;
