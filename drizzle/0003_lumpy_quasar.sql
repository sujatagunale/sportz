CREATE TYPE "public"."match_status" AS ENUM('scheduled', 'live', 'finished');--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "status" SET DATA TYPE "public"."match_status" USING "status"::"public"."match_status";--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "end_time" timestamp NOT NULL;