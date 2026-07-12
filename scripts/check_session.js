#!/usr/bin/env node
const { DatabaseSync } = require('node:sqlite');
const os = require('os');
const path = require('path');

const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

const session = db.prepare(
  'SELECT id, title FROM session ORDER BY time_created DESC LIMIT 1'
).get();

if (!session) {
  console.log(JSON.stringify({ error: 'No session found' }));
  db.close();
  process.exit(1);
}

const sessionId = session.id;

const userMessages = db.prepare(
  "SELECT id FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'user' ORDER BY time_created ASC"
).all(sessionId);

const userTexts = userMessages.map(m => {
  const parts = db.prepare(
    "SELECT data FROM part WHERE message_id = ? AND json_extract(data, '$.type') = 'text' ORDER BY time_created ASC LIMIT 1"
  ).all(m.id);
  if (parts.length > 0) {
    try {
      const data = JSON.parse(parts[0].data);
      return data.text || '';
    } catch {
      return '';
    }
  }
  return '';
});

const triggerPhrases = ['对话备份', '对话导入', 'conversation-backup', 'conversation-backup'];
const isBackupCommand = userTexts.length === 1 && triggerPhrases.some(p => userTexts[0].includes(p));

console.log(JSON.stringify({
  session_id: sessionId,
  session_title: session.title,
  user_message_count: userTexts.length,
  first_user_message: userTexts[0] || '',
  is_new_session: isBackupCommand,
}, null, 2));

db.close();
