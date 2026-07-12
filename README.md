# opencode-conversation-sync

An [OpenCode](https://opencode.ai) skill for backing up and restoring conversation history across devices.

## What it does

Exports your OpenCode conversation data (sessions, messages, parts, todos, etc.) as a SQL file, which lives in your project's `.opencode/` directory and can be tracked by Git. Import the SQL on another device to restore your full conversation history.

## Features

- Export all conversations for the current project to a single SQL file
- Import conversations with `INSERT OR REPLACE` (safe, idempotent)
- Path & project ID are stored as placeholders (`{{WORKTREE}}`, `{{PROJECT_ID}}`) and auto-resolved on import
- Automatic branch isolation — backup/restore runs on a dedicated `conversations-backup` branch to keep your working branch clean
- Zero dependencies — uses Node.js 22+ built-in `node:sqlite`

## Installation

Copy the `SKILL.md` and `scripts/` directory into your OpenCode skills folder:

```
# Windows
%USERPROFILE%\.claude\skills\conversation-backup\

# macOS / Linux
~/.claude/skills/conversation-backup/
```

Or register it in your project's `opencode.json`:

```json
{
  "skills": [
    { "path": "path/to/conversation-backup/SKILL.md" }
  ]
}
```

## Usage

### Backup

In a **new** OpenCode session, say:

> 对话备份

The skill will:
1. Verify this is a fresh session (to avoid exporting the backup command itself)
2. Switch to the `conversations-backup` branch
3. Export all conversations to `.opencode/conversations.sql`
4. Commit and push to remote
5. Switch back to your original branch

### Restore

In a **new** OpenCode session, say:

> 对话导入

The skill will:
1. Verify this is a fresh session
2. Switch to the `conversations-backup` branch
3. Run a dry-run preview showing record counts
4. Ask for confirmation, then execute the import
5. Switch back to your original branch

## Prerequisites

- **Node.js 22+** (uses built-in `node:sqlite`, no `npm install` needed)
- The project must be a Git repository with a remote configured
- OpenCode database at `~/.local/share/opencode/opencode.db`

## File Structure

```
├── SKILL.md                          # Skill definition
└── scripts/
    ├── check_session.js              # Verify fresh session
    ├── export_conversations.js       # Export conversations to SQL
    └── import_conversations.js       # Import conversations from SQL
```

## How it works

1. **Export** reads the local `opencode.db` SQLite database, extracts all data for the current project (matched by working directory), replaces absolute paths and project IDs with placeholders, and writes `INSERT` statements to `.opencode/conversations.sql`.
2. **Import** reads the SQL file, replaces placeholders with the local device's actual paths and project ID, then executes the statements with `INSERT OR REPLACE` inside a transaction.
3. Cross-device matching is done via Git remote URL — the same repo on different machines is recognized as the same project.

## License

MIT
