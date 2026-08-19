CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "api_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"rate_limit_per_min" integer DEFAULT 120 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now(),
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "distributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"response_cap" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "distributions_key_unique" UNIQUE("key"),
	CONSTRAINT "distributions_kind_check" CHECK ("distributions"."kind" IN ('public','tokenized')),
	CONSTRAINT "distributions_status_check" CHECK ("distributions"."status" IN ('active','paused','closed'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"client_id" uuid,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "instrument_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"draft_definition" jsonb NOT NULL,
	"current_version" integer,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "instruments_slug_unique" UNIQUE("slug"),
	CONSTRAINT "instruments_type_check" CHECK ("instruments"."type" IN ('poll','survey','quiz','feedback','intake')),
	CONSTRAINT "instruments_status_check" CHECK ("instruments"."status" IN ('draft','live','closed','archived'))
);
--> statement-breakpoint
CREATE TABLE "response_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid,
	"question_key" text NOT NULL,
	"s3_key" text NOT NULL,
	"filename" text,
	"size_bytes" integer,
	"mime" text,
	"scanned" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "response_items" (
	"response_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"option_key" text,
	"value_text" text,
	"value_number" numeric,
	"value_date" timestamp with time zone,
	"value_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"response_key" text NOT NULL,
	"instrument_id" uuid NOT NULL,
	"instrument_version" integer NOT NULL,
	"distribution_id" uuid NOT NULL,
	"token_id" uuid,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'partial' NOT NULL,
	"score" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "responses_response_key_unique" UNIQUE("response_key"),
	CONSTRAINT "responses_status_check" CHECK ("responses"."status" IN ('partial','completed','disqualified'))
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"distribution_id" uuid NOT NULL,
	"token" text NOT NULL,
	"invitee_email" text,
	"invitee_label" text,
	"state" text DEFAULT 'issued' NOT NULL,
	"opened_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "tokens_token_unique" UNIQUE("token"),
	CONSTRAINT "tokens_state_check" CHECK ("tokens"."state" IN ('issued','opened','partial','completed','void'))
);
--> statement-breakpoint
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_versions" ADD CONSTRAINT "instrument_versions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_files" ADD CONSTRAINT "response_files_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_items" ADD CONSTRAINT "response_items_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_distribution_id_distributions_id_fk" FOREIGN KEY ("distribution_id") REFERENCES "public"."distributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_distribution_id_distributions_id_fk" FOREIGN KEY ("distribution_id") REFERENCES "public"."distributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instrument_versions_instrument_version_uq" ON "instrument_versions" USING btree ("instrument_id","version");--> statement-breakpoint
CREATE INDEX "response_items_qk_num_idx" ON "response_items" USING btree ("question_key","value_number");--> statement-breakpoint
CREATE INDEX "response_items_qk_opt_idx" ON "response_items" USING btree ("question_key","option_key");--> statement-breakpoint
CREATE INDEX "responses_instrument_status_idx" ON "responses" USING btree ("instrument_id","status");--> statement-breakpoint
CREATE INDEX "responses_distribution_idx" ON "responses" USING btree ("distribution_id");--> statement-breakpoint
CREATE INDEX "responses_completed_at_idx" ON "responses" USING btree ("completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_distribution_invitee_uq" ON "tokens" USING btree ("distribution_id","invitee_email");