ALTER TABLE "commentary" ADD COLUMN "sequence" integer;--> statement-breakpoint
ALTER TABLE "commentary" ADD COLUMN "period" text;--> statement-breakpoint
ALTER TABLE "commentary" ADD COLUMN "event_type" text;--> statement-breakpoint
ALTER TABLE "commentary" ADD COLUMN "actor" text;--> statement-breakpoint
ALTER TABLE "commentary" ADD COLUMN "team" text;--> statement-breakpoint
ALTER TABLE "commentary" ADD COLUMN "tags" jsonb;