ALTER TABLE "projects" ALTER COLUMN "tags" SET DEFAULT '{}'::varchar[];
--> statement-breakpoint
ALTER TABLE "custom_domain_verification"
    DROP CONSTRAINT IF EXISTS "custom_domain_verification_custom_domain_id_custom_domains_id_f";
--> statement-breakpoint
ALTER TABLE "custom_domain_verification"
    DROP CONSTRAINT IF EXISTS "custom_domain_verification_custom_domain_id_custom_domains_id_fk";
--> statement-breakpoint
ALTER TABLE "custom_domain_verification"
    DROP CONSTRAINT IF EXISTS "custom_domain_verification_domain_fk";
--> statement-breakpoint
ALTER TABLE "custom_domain_verification"
    ADD CONSTRAINT "custom_domain_verification_domain_fk"
    FOREIGN KEY ("custom_domain_id") REFERENCES "public"."custom_domains"("id");
