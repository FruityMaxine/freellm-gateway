-- CreateTable
CREATE TABLE "playground_presets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "preferredModel" TEXT,
    "temperature" REAL,
    "maxTokens" INTEGER,
    "streaming" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastUsedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "playground_presets_ownerId_lastUsedAt_idx" ON "playground_presets"("ownerId", "lastUsedAt");
