-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "rpmLimit" INTEGER;

-- AlterTable
ALTER TABLE "request_logs" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "request_logs" ADD COLUMN "projectId" TEXT;

-- CreateIndex
CREATE INDEX "request_logs_organizationId_idx" ON "request_logs"("organizationId");

-- CreateIndex
CREATE INDEX "request_logs_projectId_idx" ON "request_logs"("projectId");
