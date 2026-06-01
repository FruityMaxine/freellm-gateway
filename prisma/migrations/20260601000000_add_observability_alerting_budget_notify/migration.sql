-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "httpStatus" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "requestBody" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_deliveries_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "webhook_subscriptions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "threshold" REAL NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warn',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyWebhook" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" DATETIME,
    "lastValue" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "targetId" TEXT,
    "limitUsd" REAL NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'month',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "notify_channels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'email',
    "target" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_admin_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "lastLoginIp" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_admin_users" ("createdAt", "enabled", "failedLogins", "id", "lastLoginAt", "lastLoginIp", "lockedUntil", "passwordHash", "updatedAt", "username") SELECT "createdAt", "enabled", "failedLogins", "id", "lastLoginAt", "lastLoginIp", "lockedUntil", "passwordHash", "updatedAt", "username" FROM "admin_users";
DROP TABLE "admin_users";
ALTER TABLE "new_admin_users" RENAME TO "admin_users";
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");
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
    "reasoningEffort" TEXT NOT NULL DEFAULT 'none',
    "allowReasoning" BOOLEAN NOT NULL DEFAULT true,
    "maxCostUsdPerDay" REAL,
    "expiresAt" DATETIME,
    "lastUsedAt" DATETIME,
    "lastUsedIp" TEXT,
    "totalRequests" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" BIGINT NOT NULL DEFAULT 0,
    "tagsJson" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "ownerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    "projectId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "virtual_keys_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "virtual_keys_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "admin_users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_virtual_keys" ("allowPaidModels", "allowStreaming", "allowedModelsJson", "allowedProvidersJson", "createdAt", "createdBy", "deniedModelsJson", "enabled", "environment", "expiresAt", "hash", "id", "isDemo", "label", "lastUsedAt", "lastUsedIp", "maxEmbeddingsPerDay", "maxRequestsPerDay", "maxRequestsPerMinute", "maxTokensPerDay", "notes", "prefix", "projectId", "revokedAt", "tagsJson", "totalRequests", "totalTokens", "updatedAt") SELECT "allowPaidModels", "allowStreaming", "allowedModelsJson", "allowedProvidersJson", "createdAt", "createdBy", "deniedModelsJson", "enabled", "environment", "expiresAt", "hash", "id", "isDemo", "label", "lastUsedAt", "lastUsedIp", "maxEmbeddingsPerDay", "maxRequestsPerDay", "maxRequestsPerMinute", "maxTokensPerDay", "notes", "prefix", "projectId", "revokedAt", "tagsJson", "totalRequests", "totalTokens", "updatedAt" FROM "virtual_keys";
DROP TABLE "virtual_keys";
ALTER TABLE "new_virtual_keys" RENAME TO "virtual_keys";
CREATE UNIQUE INDEX "virtual_keys_hash_key" ON "virtual_keys"("hash");
CREATE INDEX "virtual_keys_enabled_idx" ON "virtual_keys"("enabled");
CREATE INDEX "virtual_keys_projectId_idx" ON "virtual_keys"("projectId");
CREATE INDEX "virtual_keys_ownerId_idx" ON "virtual_keys"("ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "webhook_deliveries_subscriptionId_createdAt_idx" ON "webhook_deliveries"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "alert_rules_enabled_idx" ON "alert_rules"("enabled");

-- CreateIndex
CREATE INDEX "budgets_enabled_idx" ON "budgets"("enabled");

-- CreateIndex
CREATE INDEX "notify_channels_enabled_idx" ON "notify_channels"("enabled");

