CREATE SCHEMA "search";
--> statement-breakpoint
CREATE TABLE "search"."chunk" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_module" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"text_hash" text NOT NULL,
	"embedding" halfvec(3072) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "chunk_owner_index" UNIQUE("workspace_id","owner_module","owner_id","chunk_index")
);
--> statement-breakpoint
ALTER TABLE "search"."chunk" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "chunk_embedding_idx" ON "search"."chunk" USING hnsw ("embedding" halfvec_cosine_ops);--> statement-breakpoint
CREATE POLICY "chunk_tenant_isolation" ON "search"."chunk" AS PERMISSIVE FOR ALL TO public USING ("search"."chunk"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("search"."chunk"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);