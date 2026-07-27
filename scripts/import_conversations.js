#!/usr/bin/env node
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const crypto = require('crypto');

let mode = null;
let projectDir = null;
let ignoreExisting = false;

for (const arg of process.argv.slice(2)) {
  if (arg === '--dry-run') mode = 'dry-run';
  else if (arg === '--yes') mode = 'yes';
  else if (arg === '--ignore-existing') ignoreExisting = true;
  else projectDir = path.resolve(arg);
}

if (!mode) {
  console.error('Usage: node import_conversations.js [--dry-run|--yes] [--ignore-existing] [project_dir]');
  console.error('  --dry-run          Preview import without making changes');
  console.error('  --yes              Execute the import');
  console.error('  --ignore-existing  Use INSERT OR IGNORE instead of INSERT OR REPLACE');
  process.exit(1);
}

if (!projectDir) projectDir = process.cwd();

const computedWorktree = projectDir.replace(/\\/g, '/');
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

let localProject = db.prepare(
  'SELECT id, worktree FROM project WHERE worktree = ?'
).get(computedWorktree);

let worktree = computedWorktree;
if (!localProject) {
  const altWorktree = '/' + computedWorktree;
  localProject = db.prepare('SELECT id, worktree FROM project WHERE worktree = ?').get(altWorktree);
  if (localProject) worktree = altWorktree;
}

let localProjectId;
if (localProject) {
  localProjectId = localProject.id;
} else {
  localProjectId = crypto.createHash('sha1').update(worktree).digest('hex');
  console.log(`Project not found locally, will create with id: ${localProjectId}`);
}

db.close();

sql = replaceAll(sql, '{{WORKTREE}}', computedWorktree);
sql = replaceAll(sql, '{{WORKTREE}}'.replace(/\//g, '\\\\'), computedWorktree.replace(/\//g, '\\'));
sql = replaceAll(sql, '{{PROJECT_ID}}', localProjectId);
if (worktree !== computedWorktree) {
  sql = sql.replace(
    new RegExp(`(INSERT OR (?:REPLACE|IGNORE) INTO project \\([^)]*worktree[^)]*\\) VALUES[^;]*?)'${computedWorktree.replace(/[.*+?^${}()|[\]]/g, '\\$&')}'`, 'g'),
    `$1'${worktree}'`
  );
}

const insertCount = (sql.match(/^INSERT /gm) || []).length;

let sessionAnalysis = null;
if (localProject) {
  const checkDb = new DatabaseSync(dbPath, { readOnly: true });
  const localSessions = checkDb.prepare(
    'SELECT id FROM session WHERE project_id = ?'
  ).all(localProjectId).map(s => s.id);
  
  const sqlSessionIds = [];
  const sessionInsertBlocks = sql.matchAll(/INSERT OR (?:REPLACE|IGNORE) INTO session\b[^;]+;/g);
  for (const block of sessionInsertBlocks) {
    const idMatches = block[0].matchAll(/\('ses_[a-zA-Z0-9]+'/g);
    for (const m of idMatches) {
      sqlSessionIds.push(m[0].slice(2, -1));
    }
  }
  
  const existingSessions = sqlSessionIds.filter(id => localSessions.includes(id));
  const newSessions = sqlSessionIds.filter(id => !localSessions.includes(id));
  
  sessionAnalysis = {
    sql_session_count: sqlSessionIds.length,
    existing_count: existingSessions.length,
    new_count: newSessions.length,
  };
  
  checkDb.close();
}

console.log(JSON.stringify({
  mode,
  local_worktree: worktree,
  local_project_id: localProjectId,
  insert_count: insertCount,
  ignore_existing: ignoreExisting,
  session_analysis: sessionAnalysis,
  header: headerLines.map(l => l.replace(/^-- /, '')),
}, null, 2));

if (mode === 'dry-run') {
  console.log('\n[DRY RUN] No changes made. Use --yes to execute.');
  process.exit(0);
}

if (ignoreExisting) {
  sql = sql.replace(/^INSERT OR REPLACE/gm, 'INSERT OR IGNORE');
}

const importDb = new DatabaseSync(dbPath);
importDb.prepare('PRAGMA foreign_keys = OFF').run();
const fkStatus = importDb.prepare('PRAGMA foreign_keys').get();
if (fkStatus.foreign_keys !== 0) {
  console.error('WARNING: Failed to disable foreign keys! CASCADE deletes may occur.');
}
importDb.exec('BEGIN TRANSACTION');
try {
  importDb.exec(sql);
  if (sql.includes('INSERT OR REPLACE INTO event ')) {
    importDb.exec(`
      UPDATE event_sequence
      SET seq = (SELECT MAX(e.seq) FROM event e WHERE e.aggregate_id = event_sequence.aggregate_id)
      WHERE aggregate_id IN (
        SELECT es.aggregate_id FROM event_sequence es
        JOIN event e ON e.aggregate_id = es.aggregate_id
        GROUP BY es.aggregate_id
      )
    `);
  }
  importDb.exec('COMMIT');
  importDb.prepare('PRAGMA foreign_keys = ON').run();
  console.log(`\nImport completed: ${insertCount} INSERT statements executed.`);
} catch (err) {
  try { importDb.exec('ROLLBACK'); } catch {}
  try { importDb.prepare('PRAGMA foreign_keys = ON').run(); } catch {}
  console.error(`Import failed: ${err.message}`);
  process.exit(1);
}

function replaceAll(str, search, replacement) {
  if (!search) return str;
  return str.split(search).join(replacement);
}
