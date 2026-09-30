/** Durable tenant metadata and trusted hosted-auth operator tools. */
export { initializeAuth } from './auth-schema.js';
export { HostedAuth, activateAuthKey } from './hosted-auth.js';
export { HostedProvisioning } from './hosted-provisioning.js';
export { hostedConfig } from './hosted-config.js';
export { TenantMetadata } from './metadata.js';
export type { TenantContext, Revisions, MetadataEdit } from './metadata.js';
export { SqliteMetadataDatabase, PostgresMetadataDatabase, MetadataError } from './metadata-db.js';
export type { Database, MetadataPool } from './metadata-db.js';
export { initializeMetadata } from './metadata-schema.js';
export { MetadataOperator } from './metadata-operator.js';
export type { ProvisionRequest, TenantOperation } from './metadata-operator.js';
export { MetadataMigration } from './metadata-migration.js';
export type { LegacyMigrationConfig, MigrationReport, MigrationCheckpoint } from './metadata-migration.js';
export type { MetadataKind, ResourceKey, MetadataResource } from './metadata-resources.js';
export { encryptMetadataSecret, decryptMetadataSecret } from './metadata-secrets.js';
