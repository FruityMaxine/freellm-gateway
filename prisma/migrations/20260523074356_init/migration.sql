-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "lastLoginIp" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "admin_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "rpmLimit" INTEGER,
    "dailyLimit" INTEGER,
    "timeoutMs" INTEGER NOT NULL DEFAULT 60000,
    "retryPolicyJson" TEXT NOT NULL DEFAULT '{"maxAttempts":3,"backoffMs":500}',
    "supportsStreaming" BOOLEAN NOT NULL DEFAULT true,
    "compatibleMode" TEXT NOT NULL DEFAULT 'openai',
    "headerOverrides" TEXT,
    "region" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "errorCount24h" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" DATETIME,
    "lastErrorAt" DATETIME,
    "lastErrorMessage" TEXT,
    "lastSyncAt" DATETIME,
    "balanceJson" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "upstream_keys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "cipherText" TEXT NOT NULL,
    "keyDigest" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "rpmLimit" INTEGER,
    "dailyLimit" INTEGER,
    "lastUsedAt" DATETIME,
    "errorCount24h" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "upstream_keys_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "virtual_keys" (
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "models" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "upstreamId" TEXT NOT NULL,
    "family" TEXT,
    "displayName" TEXT NOT NULL,
    "contextLength" INTEGER NOT NULL DEFAULT 0,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "isFreeReason" TEXT,
    "pricingJson" TEXT,
    "capabilitiesJson" TEXT NOT NULL DEFAULT '{}',
    "paramsSupported" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "manualOverride" TEXT,
    "weightAdj" REAL NOT NULL DEFAULT 0,
    "blacklisted" BOOLEAN NOT NULL DEFAULT false,
    "whitelisted" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "topProvider" TEXT,
    "lastSeenAt" DATETIME,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "models_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "model_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modelId" TEXT,
    "providerId" TEXT NOT NULL,
    "upstreamId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "isFree" BOOLEAN NOT NULL,
    "contextLength" INTEGER NOT NULL DEFAULT 0,
    "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "model_snapshots_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "models" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "model_scores" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modelId" TEXT NOT NULL,
    "availabilityScore" REAL NOT NULL DEFAULT 0.5,
    "latencyScore" REAL NOT NULL DEFAULT 0.5,
    "rateLimitScore" REAL NOT NULL DEFAULT 0.5,
    "qualityScore" REAL NOT NULL DEFAULT 0.5,
    "contextScore" REAL NOT NULL DEFAULT 0.5,
    "capabilityScore" REAL NOT NULL DEFAULT 0.5,
    "freshnessScore" REAL NOT NULL DEFAULT 0.5,
    "costScore" REAL NOT NULL DEFAULT 1.0,
    "stabilityScore" REAL NOT NULL DEFAULT 0.5,
    "firstTokenLatencyMs" INTEGER,
    "avgLatencyMs" INTEGER,
    "successCount24h" INTEGER NOT NULL DEFAULT 0,
    "failureCount24h" INTEGER NOT NULL DEFAULT 0,
    "rateLimit24h" INTEGER NOT NULL DEFAULT 0,
    "composite" REAL NOT NULL DEFAULT 0,
    "explanationJson" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "model_scores_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "models" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "routing_policies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'auto-best-free',
    "weightsJson" TEXT NOT NULL DEFAULT '{}',
    "paramsJson" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "cooldowns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "modelId" TEXT,
    "providerId" TEXT,
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "backoffMs" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "halfOpen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "cooldowns_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "models" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cooldowns_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "request_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "virtualKeyId" TEXT,
    "upstreamModel" TEXT,
    "upstreamProvider" TEXT,
    "modelAlias" TEXT,
    "routingMode" TEXT,
    "streaming" BOOLEAN NOT NULL DEFAULT false,
    "status" INTEGER,
    "errorKind" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "promptDigest" TEXT,
    "promptText" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "firstTokenMs" INTEGER,
    "clientIp" TEXT,
    "userAgent" TEXT,
    "notes" TEXT,
    CONSTRAINT "request_logs_virtualKeyId_fkey" FOREIGN KEY ("virtualKeyId") REFERENCES "virtual_keys" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "route_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "providerId" TEXT,
    "modelId" TEXT,
    "upstreamModel" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "firstTokenMs" INTEGER,
    "status" INTEGER,
    "errorKind" TEXT,
    "errorMessage" TEXT,
    "bytesIn" INTEGER NOT NULL DEFAULT 0,
    "bytesOut" INTEGER NOT NULL DEFAULT 0,
    "cooldownTriggered" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    CONSTRAINT "route_attempts_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "request_logs" ("requestId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "route_attempts_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "route_attempts_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "models" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "error_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warn',
    "providerId" TEXT,
    "modelId" TEXT,
    "requestId" TEXT,
    "message" TEXT NOT NULL,
    "detailsJson" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "error_events_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "error_events_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "models" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "health_checks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "providerId" TEXT,
    "modelId" TEXT,
    "ok" BOOLEAN NOT NULL,
    "latencyMs" INTEGER,
    "errorKind" TEXT,
    "errorMessage" TEXT,
    "detailsJson" TEXT,
    "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "health_checks_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "health_checks_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "models" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "usage_daily" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "day" DATETIME NOT NULL,
    "virtualKeyId" TEXT,
    "providerId" TEXT,
    "modelId" TEXT,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "successes" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "rateLimits" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" BIGINT NOT NULL DEFAULT 0,
    "completionTokens" BIGINT NOT NULL DEFAULT 0,
    "totalTokens" BIGINT NOT NULL DEFAULT 0,
    "avgLatencyMs" INTEGER
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "providers_slug_key" ON "providers"("slug");

-- CreateIndex
CREATE INDEX "upstream_keys_providerId_idx" ON "upstream_keys"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_keys_hash_key" ON "virtual_keys"("hash");

-- CreateIndex
CREATE INDEX "virtual_keys_enabled_idx" ON "virtual_keys"("enabled");

-- CreateIndex
CREATE INDEX "models_isFree_status_idx" ON "models"("isFree", "status");

-- CreateIndex
CREATE INDEX "models_status_idx" ON "models"("status");

-- CreateIndex
CREATE UNIQUE INDEX "models_providerId_upstreamId_key" ON "models"("providerId", "upstreamId");

-- CreateIndex
CREATE INDEX "model_snapshots_providerId_upstreamId_takenAt_idx" ON "model_snapshots"("providerId", "upstreamId", "takenAt");

-- CreateIndex
CREATE UNIQUE INDEX "model_scores_modelId_key" ON "model_scores"("modelId");

-- CreateIndex
CREATE INDEX "model_scores_composite_idx" ON "model_scores"("composite");

-- CreateIndex
CREATE UNIQUE INDEX "routing_policies_name_key" ON "routing_policies"("name");

-- CreateIndex
CREATE INDEX "cooldowns_scope_expiresAt_idx" ON "cooldowns"("scope", "expiresAt");

-- CreateIndex
CREATE INDEX "cooldowns_modelId_idx" ON "cooldowns"("modelId");

-- CreateIndex
CREATE INDEX "cooldowns_providerId_idx" ON "cooldowns"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "request_logs_requestId_key" ON "request_logs"("requestId");

-- CreateIndex
CREATE INDEX "request_logs_startedAt_idx" ON "request_logs"("startedAt");

-- CreateIndex
CREATE INDEX "request_logs_virtualKeyId_idx" ON "request_logs"("virtualKeyId");

-- CreateIndex
CREATE INDEX "request_logs_status_idx" ON "request_logs"("status");

-- CreateIndex
CREATE INDEX "route_attempts_requestId_idx" ON "route_attempts"("requestId");

-- CreateIndex
CREATE INDEX "route_attempts_modelId_idx" ON "route_attempts"("modelId");

-- CreateIndex
CREATE INDEX "error_events_kind_createdAt_idx" ON "error_events"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "error_events_severity_resolvedAt_idx" ON "error_events"("severity", "resolvedAt");

-- CreateIndex
CREATE INDEX "health_checks_scope_takenAt_idx" ON "health_checks"("scope", "takenAt");

-- CreateIndex
CREATE INDEX "usage_daily_day_idx" ON "usage_daily"("day");

-- CreateIndex
CREATE UNIQUE INDEX "usage_daily_day_virtualKeyId_providerId_modelId_key" ON "usage_daily"("day", "virtualKeyId", "providerId", "modelId");
