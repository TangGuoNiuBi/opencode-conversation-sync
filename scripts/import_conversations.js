#!/usr/bin/env node
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const crypto = require('crypto');

let mode = null;
let projectDir = null;

for (const arg of process.argv.slice(2)) {
  if (arg === '--dry-run') mode = 'dry-run';
  else if (arg === '--yes') mode = 'yes';
  else projectDir = path.resolve(arg);
}

if (!mode) {
  console.error('Usage: node import_conversations.js [--dry-run|--yes] [project_dir]');
  console.error('  --dry-run  Preview import without making changes');
  console.error('  --yes      Execute the import');
  process.exit(1);
}

if (!projectDir) projectDir = process.cwd();

const worktree = projectDir.replace(/\\/g, '/');
const sqlPath = path.join(projectDir, '.opencode', 'conversations.sql');

if (!fs.existsSync(sqlPath)) {
  console.error(`SQL file not found: ${sqlPath}`);
  process.exit(1);
}

let sql = fs.readFileSync(sqlPath, 'utf8');
const headerLines = sql.split('\n').filter(l => l.startsWith('-- '));

if (!headerLines.some(l => l.includes('OPENCODE_CONVERSATION_BACKUP'))) {
  console.error('Invalid SQL file: missing backup header');
  process.exit(1);
}

const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
if (!fs.existsSync(dbPath)) {
  console.error(`opencode.db not found at: ${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);

const localProject = db.prepare(
  'SELECT id FROM project WHERE worktree = ?'
).get(worktree);

let localProjectId;
if (localProject) {
  localProjectId = localProject.id;
} else {
  localProjectId = crypto.createHash('sha1').update(worktree).digest('hex');
  console.log(`Project not found locally, will create with id: ${localProjectId}`);
}

db.close();

sql = replaceAll(sql, '{{WORKTREE}}', worktree);
sql = replaceAll(sql, '{{WORKTREE}}'.replace(/\//g, '\\\\'), worktree.replace(/\//g, '\\'));
sql = replaceAll(sql, '{{PROJECT_ID}}', localProjectId);

const insertCount = (sql.match(/^INSERT /gm) || []).length;

console.log(JSON.stringify({
  mode,
  local_worktree: worktree,
  local_project_id: localProjectId,
  insert_count: insertCount,
  header: headerLines.map(l => l.replace(/^-- /, '')),
}, null, 2));

if (mode === 'dry-run') {
  console.log('\n[DRY RUN] No changes made. Use --yes to execute.');
  process.exit(0);
}

const importDb = new DatabaseSync(dbPath);
importDb.exec('PRAGMA foreign_keys = OFF');
importDb.exec('BEGIN TRANSACTION');
try {
  importDb.exec(sql);
  importDb.exec(`
    UPDATE event_sequence
    SET seq = (SELECT MAX(e.seq) FROM event e WHERE e.aggregate_id = event_sequence.aggregate_id)
    WHERE aggregate_id IN (
      SELECT es.aggregate_id FROM event_sequence es
      JOIN event e ON e.aggregate_id = es.aggregate_id
      GROUP BY es.aggregate_id
      HAVING es.seq < MAX(e.seq)
    )
  `);
  importDb.exec('COMMIT');
  importDb.exec('PRAGMA foreign_keys = ON');
  console.log(`\nImport completed: ${insertCount} INSERT statements executed.`);
} catch (err) {
  try { importDb.exec('ROLLBACK'); } catch {}
  try { importDb.exec('PRAGMA foreign_keys = ON'); } catch {}
  console.error(`Import failed: ${err.message}`);
  process.exit(1);
}

function replaceAll(str, search, replacement) {
  if (!search) return str;
  return str.split(search).join(replacement);
}
