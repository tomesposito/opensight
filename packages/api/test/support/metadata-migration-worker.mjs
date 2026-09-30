import { readFile } from 'node:fs/promises';
import { MetadataMigration } from '../../dist/metadata-migration.js';
import { SqliteMetadataDatabase } from '../../dist/metadata-db.js';
const [configPath, dbPath, stop] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8')), db = new SqliteMetadataDatabase(dbPath);
await new MetadataMigration(db).migrate(config, process.env.OPENSIGHT_AI_ENCRYPTION_KEY, async stage => {
  if (stage === stop) { process.send(stage); await new Promise(() => {}); }
});
await db.close();
