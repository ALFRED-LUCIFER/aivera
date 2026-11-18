CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE TABLE "identity"."sign_in_method" (
	"user_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sign_in_method_pkey" PRIMARY KEY("issuer","subject")
);
--> statement-breakpoint
CREATE TABLE "identity"."user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_email_lower_case" CHECK ("identity"."user"."email" = lower("identity"."user"."email"))
);
--> statement-breakpoint
ALTER TABLE "identity"."sign_in_method" ADD CONSTRAINT "sign_in_method_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."user"("id") ON DELETE no action ON UPDATE no action;