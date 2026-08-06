ALTER TYPE "public"."audit_type" ADD VALUE 'invoice';--> statement-breakpoint
ALTER TYPE "public"."permission_key" ADD VALUE 'finManage' BEFORE 'setUsers';