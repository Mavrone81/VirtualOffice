-- CreateTable
CREATE TABLE "sales_quotas" (
    "id" UUID NOT NULL,
    "associate_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "set_by_role" "AppRole" NOT NULL,
    "set_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_quotas_associate_id_month_key" ON "sales_quotas"("associate_id", "month");
