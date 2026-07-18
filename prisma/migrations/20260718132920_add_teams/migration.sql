-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "director_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "associate_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_team_id_associate_id_key" ON "team_members"("team_id", "associate_id");

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
