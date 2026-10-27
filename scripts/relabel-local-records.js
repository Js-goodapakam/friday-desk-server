const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync('.local/friday-development.sqlite');
const clean = (value) => value
  .replaceAll('DEMO', 'LOCAL')
  .replaceAll('Demo ', '')
  .replaceAll('demo ', '');
const tables = [
  'friday_demo_workspace',
  'friday_demo_room_type',
  'friday_demo_room',
  'friday_demo_guest',
  'friday_demo_reservation',
  'friday_demo_record',
];

db.exec('BEGIN');
try {
  for (const table of tables) {
    for (const row of db.prepare(`SELECT rowid AS __rowid, * FROM ${table}`).all()) {
      for (const column of ['state_json', 'payload']) {
        if (typeof row[column] === 'string') {
          db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`)
            .run(clean(row[column]), row.__rowid);
        }
      }
    }
  }
  db.prepare("UPDATE friday_demo_workspace SET seed = 'friday-taj-demo-v1', state_json = replace(state_json, 'friday-taj-LOCAL-v1', 'friday-taj-demo-v1')").run();
  db.prepare("UPDATE user SET name = replace(replace(name, 'Demo ', ''), ' demo', ''), email = replace(email, 'demo-', 'local-')").run();
  db.exec('COMMIT');
  console.log('Relabeled local records without deleting operational data.');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
