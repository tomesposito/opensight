import { referenceDatabase } from '../dist/reference-postgres.js';
import { seedReference } from './reference-pilot-helpers.mjs';
const db = await referenceDatabase(process.env, () => {});
try { process.stdout.write(JSON.stringify(await seedReference(db.membershipDatabase, db.tenantDatabase, process.env))); }
finally { await db.close(); }
