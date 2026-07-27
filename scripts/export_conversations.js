#!/usr/bin/env node
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

let projectDir = null;
let excludeSessionId = null;
let includeEvents = true;

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--exclude-session') {
    excludeSessionId = process.argv[++i];
  } else if (process.argv[i] === '--no-events') {
    includeEvents = false;
  } else {
    projectDir = path.resolve(process.argv[i]);
  }
}

if (!projectDir) projectDir = process.cwd();
const computedWorktree = projectDir.replace(/\\/g, '/');

const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
if (!fs.existsSync(dbPath)) {
  console.error(`opencode.db not found at: ${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

let project = db.prepare(
  'SELECT * FROM project WHERE worktree = ?'
).get(computedWorktree);

let worktree = computedWorktree;
if (!project) {
  const altWorktree = '/' + computedWorktree;
  project = db.prepare('SELECT * FROM project WHERE worktree = ?').get(altWorktree);
  if (project) worktree = altWorktree;
}

if (!project) {
  console.error(`Project not found for worktree: ${computedWorktree}`);
  process.exit(1);
}

const projectId = project.id;

let gitRemote = '';
try {
  gitRemote = execSync('git remote get-url origin', { cwd: projectDir, encoding: 'utf8' }).trim();
} catch {}

let sessions = db.prepare(
  'SELECT * FROM session WHERE project_id = ? AND time_archived IS NULL'
).all(projectId);

if (excludeSessionId) {
  sessions = sessions.filter(s => s.id !== excludeSessionId);
}

const sessionIds = sessions.map(s => s.id);

// 统计每个会话的消息数量
const messageCounts = sessionIds.length > 0
  ? db.prepare(
      `SELECT session_id, COUNT(*) as count FROM message WHERE session_id IN (${sessionIds.map(() => '?').join(',')}) GROUP BY session_id`
    ).all(...sessionIds)
  : [];

const messageCountMap = new Map(messageCounts.map(m => [m.session_id, m.count]));

const messages = sessionIds.length > 0
  ? db.prepare(
      `SELECT * FROM message WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`
    ).all(...sessionIds)
  : [];

const parts = sessionIds.length > 0
  ? db.prepare(
      `SELECT * FROM part WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`
    ).all(...sessionIds)
  : [];

const todos = sessionIds.length > 0
  ? db.prepare(
      `SELECT * FROM todo WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`
    ).all(...sessionIds)
  : [];

const sessionMessages = sessionIds.length > 0
  ? db.prepare(
      `SELECT * FROM session_message WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`
    ).all(...sessionIds)
  : [];

const sessionInputs = sessionIds.length > 0
  ? db.prepare(
      `SELECT * FROM session_input WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`
    ).all(...sessionIds)
  : [];

const sessionContextEpochs = sessionIds.length > 0
  ? db.prepare(
      `SELECT * FROM session_context_epoch WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`
    ).all(...sessionIds)
  : [];

const eventSequences = sessionIds.length > 0
  ? db.prepare(
      `SELECT * FROM event_sequence WHERE aggregate_id IN (${sessionIds.map(() => '?').join(',')})`
    ).all(...sessionIds)
  : [];

let events = [];
if (includeEvents && sessionIds.length > 0) {
  events = db.prepare(
    `SELECT * FROM event WHERE aggregate_id IN (${sessionIds.map(() => '?').join(',')})`
  ).all(...sessionIds);
}

const projectDirs = db.prepare(
  'SELECT * FROM project_directory WHERE project_id = ?'
).all(projectId);

db.close();

const lines = [];
lines.push('-- OPENCODE_CONVERSATION_BACKUP');
lines.push('-- version: 1');
lines.push(`-- export_time: ${new Date().toISOString()}`);
if (gitRemote) lines.push(`-- git_remote: ${gitRemote}`);
lines.push(`-- source_worktree: ${worktree}`);
lines.push(`-- source_project_id: ${projectId}`);
lines.push(`-- session_count: ${sessions.length}`);
lines.push(`-- message_count: ${messages.length}`);
lines.push(`-- part_count: ${parts.length}`);
lines.push(`-- event_count: ${events.length}`);
lines.push(`-- event_sequence_count: ${eventSequences.length}`);
lines.push(`-- todo_count: ${todos.length}`);
lines.push(`-- session_message_count: ${sessionMessages.length}`);
lines.push(`-- session_input_count: ${sessionInputs.length}`);
lines.push(`-- session_context_epoch_count: ${sessionContextEpochs.length}`);
lines.push('');

const projectCols = ['id', 'worktree', 'vcs', 'name', 'icon_url', 'icon_color',
  'time_created', 'time_updated', 'time_initialized', 'sandboxes', 'commands', 'icon_url_override'];
lines.push(genInsert('project', projectCols, project));

if (projectDirs.length > 0) {
  lines.push(genInsert('project_directory',
    ['project_id', 'directory', 'type', 'strategy', 'time_created'], projectDirs));
}
if (sessions.length > 0) {
  lines.push(genInsert('session', getCols('session', sessions[0]), sessions));
}
if (messages.length > 0) {
  lines.push(genInsert('message', getCols('message', messages[0]), messages));
}
if (parts.length > 0) {
  lines.push(genInsert('part', getCols('part', parts[0]), parts));
}
if (todos.length > 0) {
  lines.push(genInsert('todo', getCols('todo', todos[0]), todos));
}
if (sessionMessages.length > 0) {
  lines.push(genInsert('session_message', getCols('session_message', sessionMessages[0]), sessionMessages));
}
if (sessionInputs.length > 0) {
  lines.push(genInsert('session_input', getCols('session_input', sessionInputs[0]), sessionInputs));
}
if (sessionContextEpochs.length > 0) {
  lines.push(genInsert('session_context_epoch', getCols('session_context_epoch', sessionContextEpochs[0]), sessionContextEpochs));
}
if (eventSequences.length > 0) {
  lines.push(genInsert('event_sequence', getCols('event_sequence', eventSequences[0]), eventSequences));
}
if (events.length > 0) {
  lines.push(genInsert('event', ['id', 'aggregate_id', 'seq', 'type', 'data'], events));
}

let sql = lines.join('\n');

sql = replaceAll(sql, projectId, '{{PROJECT_ID}}');
sql = replaceAll(sql, worktree, '{{WORKTREE}}');
sql = replaceAll(sql, worktree.replace(/\//g, '\\'), '{{WORKTREE}}');
if (worktree.startsWith('/')) {
  const withoutLeading = worktree.substring(1);
  sql = replaceAll(sql, withoutLeading, '{{WORKTREE}}');
  sql = replaceAll(sql, withoutLeading.replace(/\//g, '\\'), '{{WORKTREE}}');
}

const outDir = path.join(projectDir, '.opencode');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'conversations.sql');
fs.writeFileSync(outPath, sql, 'utf8');

// 生成会话摘要（标题 + 轮次）
const sessionsSummary = sessions.map(s => ({
  title: s.title || '(无标题)',
  rounds: messageCountMap.get(s.id) || 0
}));

// 生成准确的 commit message
const now = new Date();
const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
const totalRounds = sessionsSummary.reduce((sum, s) => sum + s.rounds, 0);
const commitMessageLines = [
  `【导出opencode对话记录】截止${timestamp}`,
  ``,
  `摘要：共 ${sessions.length} 个对话，${totalRounds} 轮对话`,
  ``,
  `各对话详情：`
];
sessionsSummary.forEach(s => {
  commitMessageLines.push(`- ${s.title} (${s.rounds}轮)`);
});
const commitMessage = commitMessageLines.join('\n');

console.log(JSON.stringify({
  success: true,
  output: outPath,
  project_id: projectId,
  worktree,
  git_remote: gitRemote,
  excluded_session: excludeSessionId || null,
  sessions_summary: sessionsSummary,
  commit_message: commitMessage,
  counts: {
    project: 1,
    project_directory: projectDirs.length,
    session: sessions.length,
    message: messages.length,
    part: parts.length,
    event: events.length,
    event_sequence: eventSequences.length,
    todo: todos.length,
    session_message: sessionMessages.length,
    session_input: sessionInputs.length,
    session_context_epoch: sessionContextEpochs.length,
  }
}, null, 2));

function replaceAll(str, search, replacement) {
  if (!search) return str;
  return str.split(search).join(replacement);
}

function getCols(_table, row) {
  return Object.keys(row);
}

function genInsert(table, cols, rows) {
  const arr = Array.isArray(rows) ? rows : [rows];
  if (arr.length === 0) return '';
  const colStr = cols.join(', ');
  const valRows = arr.map(row => {
    const vals = cols.map(c => formatVal(row[c])).join(', ');
    return `(${vals})`;
  });
  return `INSERT OR REPLACE INTO ${table} (${colStr}) VALUES\n${valRows.join(',\n')};`;
}

function formatVal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}
