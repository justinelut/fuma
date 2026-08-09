CREATE TABLE "sandbox_claims" (
    "sandbox_id" varchar PRIMARY KEY NOT NULL,
    "user_id" uuid NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "sandbox_claims_user_id_auth_users_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id")
        ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "sandbox_claims_user_id_idx" ON "sandbox_claims" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "sandbox_claims_expires_at_idx" ON "sandbox_claims" USING btree ("expires_at");
