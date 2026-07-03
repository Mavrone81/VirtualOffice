-- Self-service password reset token (hashed) + expiry
ALTER TABLE "users" ADD COLUMN "reset_token_hash" TEXT;
ALTER TABLE "users" ADD COLUMN "reset_token_expires_at" TIMESTAMP(3);
