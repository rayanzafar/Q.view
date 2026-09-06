// Schema only, in a disposable database selected by the graph builder. No business rows.
import { all, close } from '../../src/core/db/index.js';
const tables = await all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
const schema = [];
for (const { name } of tables) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error('Unexpected schema identifier');
  schema.push({ name, columns: await all(`PRAGMA table_info("${name}")`), foreignKeys: await all(`PRAGMA foreign_key_list("${name}")`) });
}
await close();
process.stdout.write('\nGRAPH_SCHEMA=' + JSON.stringify(schema) + '\n');
