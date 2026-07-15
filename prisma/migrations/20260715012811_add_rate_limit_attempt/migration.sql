-- CreateTable
CREATE TABLE "rate_limit_attempts" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_attempts_identifier_action_key" ON "rate_limit_attempts"("identifier", "action");
