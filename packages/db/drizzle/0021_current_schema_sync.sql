-- Synchronize the historical Onlook domain migrations with the current editor
-- schema. This file was derived by applying db:push to a disposable database
-- after the hosted migration chain, then recording every resulting DDL change.

DO $enum$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_type') THEN
        CREATE TYPE "public"."agent_type" AS ENUM('root', 'user');
    END IF;
END
$enum$;
--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "show_mini_chat" SET DEFAULT false;
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "tags" SET DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "agent_type" "agent_type" DEFAULT 'root';
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "usage" jsonb;
--> statement-breakpoint

ALTER TABLE "custom_domain_verification"
    DROP CONSTRAINT IF EXISTS "custom_domain_verification_custom_domain_id_custom_domains_id_f";
--> statement-breakpoint
ALTER TABLE "custom_domain_verification"
    DROP CONSTRAINT IF EXISTS "custom_domain_verification_custom_domain_id_custom_domains_id_fk";
--> statement-breakpoint
ALTER TABLE "custom_domain_verification"
    ADD CONSTRAINT "custom_domain_verification_custom_domain_id_custom_domains_id_fk"
    FOREIGN KEY ("custom_domain_id") REFERENCES "public"."custom_domains"("id");
--> statement-breakpoint

ALTER TABLE "deployments" DROP CONSTRAINT IF EXISTS "deployments_requested_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_requested_by_users_id_fk"
    FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_price_id_prices_id_fk";
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id")
    ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_price_id_prices_id_fk"
    FOREIGN KEY ("price_id") REFERENCES "public"."prices"("id")
    ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "rate_limits" DROP CONSTRAINT IF EXISTS "rate_limits_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "rate_limits" DROP CONSTRAINT IF EXISTS "rate_limits_subscription_id_subscriptions_id_fk";
--> statement-breakpoint
ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_subscription_id_subscriptions_id_fk"
    FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id")
    ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "usage_records" DROP CONSTRAINT IF EXISTS "usage_records_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint

ALTER TABLE "auth_users" DROP CONSTRAINT IF EXISTS "auth_users_email_key";
--> statement-breakpoint
ALTER TABLE "auth_users" DROP CONSTRAINT IF EXISTS "auth_users_email_unique";
--> statement-breakpoint
ALTER TABLE "auth_users" ADD CONSTRAINT "auth_users_email_unique" UNIQUE("email");
--> statement-breakpoint
ALTER TABLE "auth_sessions" DROP CONSTRAINT IF EXISTS "auth_sessions_token_key";
--> statement-breakpoint
ALTER TABLE "auth_sessions" DROP CONSTRAINT IF EXISTS "auth_sessions_token_unique";
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_token_unique" UNIQUE("token");
--> statement-breakpoint
ALTER TABLE "auth_sessions" DROP CONSTRAINT IF EXISTS "auth_sessions_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "auth_sessions" DROP CONSTRAINT IF EXISTS "auth_sessions_user_id_auth_users_id_fk";
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "auth_accounts" DROP CONSTRAINT IF EXISTS "auth_accounts_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "auth_accounts" DROP CONSTRAINT IF EXISTS "auth_accounts_user_id_auth_users_id_fk";
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_auth_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade;
