-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_virtual_keys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'live',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowedModelsJson" TEXT,
    "deniedModelsJson" TEXT,
    "allowedProvidersJson" TEXT,
    "maxRequestsPerMinute" INTEGER,
    "maxRequestsPerDay" INTEGER,
    "maxTokensPerDay" INTEGER,
    "maxEmbeddingsPerDay" INTEGER,
    "allowPaidModels" BOOLEAN NOT NULL DEFAULT false,
    "allowStreaming" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" DATETIME,
    "lastUsedAt" DATETIME,
    "lastUsedIp" TEXT,
    "totalRequests" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" BIGINT NOT NULL DEFAULT 0,
    "tagsJson" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    "projectId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "virtual_keys_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_virtual_keys" ("allowPaidModels", "allowStreaming", "allowedModelsJson", "allowedProvidersJson", "createdAt", "createdBy", "deniedModelsJson", "enabled", "environment", "expiresAt", "hash", "id", "label", "lastUsedAt", "lastUsedIp", "maxEmbeddingsPerDay", "maxRequestsPerDay", "maxRequestsPerMinute", "maxTokensPerDay", "notes", "prefix", "projectId", "revokedAt", "tagsJson", "totalRequests", "totalTokens", "updatedAt") SELECT "allowPaidModels", "allowStreaming", "allowedModelsJson", "allowedProvidersJson", "createdAt", "createdBy", "deniedModelsJson", "enabled", "environment", "expiresAt", "hash", "id", "label", "lastUsedAt", "lastUsedIp", "maxEmbeddingsPerDay", "maxRequestsPerDay", "maxRequestsPerMinute", "maxTokensPerDay", "notes", "prefix", "projectId", "revokedAt", "tagsJson", "totalRequests", "totalTokens", "updatedAt" FROM "virtual_keys";
DROP TABLE "virtual_keys";
ALTER TABLE "new_virtual_keys" RENAME TO "virtual_keys";
CREATE UNIQUE INDEX "virtual_keys_hash_key" ON "virtual_keys"("hash");
CREATE INDEX "virtual_keys_enabled_idx" ON "virtual_keys"("enabled");
CREATE INDEX "virtual_keys_projectId_idx" ON "virtual_keys"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
