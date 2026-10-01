// Synthetic engineering envelope, not a product entitlement or runtime default.
export const tenantLimits = { running: 1, queued: 4, executionMs: 10000, queueMs: 30000,
  sourceRows: 100000, resultBytes: 1048576, workingBytes: 16777216, cacheBytes: 16777216,
  workerRssBytes: 536870912, workerHeapMb: 128, duckdbMemoryMb: 64, cellChars: 16384 };
export const budgetConfig = { node: { ...tenantLimits, running: 3, queued: 12, refreshSlots: 1, workingBytes: 67108864, cacheBytes: 67108864, workerRssBytes: 1610612736 }, defaults: tenantLimits, tenants: {} };
