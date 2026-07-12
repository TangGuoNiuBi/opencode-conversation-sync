# opencode-conversation-sync

一个 [OpenCode](https://opencode.ai) 技能，用于在不同设备间备份和恢复对话记录。

## 功能说明

将 OpenCode 的对话数据（会话、消息、内容片段、待办事项等）导出为 SQL 文件，存放在项目的 `.opencode/` 目录下，可通过 Git 进行版本管理。在另一台设备上导入该 SQL 文件即可恢复完整的对话历史。

## 特性

- 将当前项目的所有对话导出为单个 SQL 文件
- 使用 `INSERT OR REPLACE` 导入（幂等、安全）
- 路径和项目 ID 以占位符（`{{WORKTREE}}`、`{{PROJECT_ID}}`）存储，导入时自动替换
- 自动分支隔离 — 备份/恢复在独立的 `conversations-backup` 分支上执行，不污染工作分支
- 零依赖 — 使用 Node.js 22+ 内置 `node:sqlite` 模块

## 安装

将 `SKILL.md` 和 `scripts/` 目录复制到 OpenCode 技能目录：

```
# Windows
%USERPROFILE%\.claude\skills\conversation-backup\

# macOS / Linux
~/.claude/skills/conversation-backup/
```

或在项目的 `opencode.json` 中注册：

```json
{
  "skills": [
    { "path": "path/to/conversation-backup/SKILL.md" }
  ]
}
```

## 使用方法

### 备份

在一个**新的** OpenCode 对话中说：

> 对话备份

技能将：
1. 验证当前为新会话（避免将备份操作本身的数据导出）
2. 切换到 `conversations-backup` 分支
3. 将所有对话导出到 `.opencode/conversations.sql`
4. 提交并推送到远程仓库
5. 切换回原来的分支

### 恢复

在一个**新的** OpenCode 对话中说：

> 对话导入

技能将：
1. 验证当前为新会话
2. 切换到 `conversations-backup` 分支
3. 执行 dry-run 预览，展示各表记录数
4. 询问确认后执行导入
5. 切换回原来的分支

## 前置条件

- **Node.js 22+**（使用内置 `node:sqlite`，无需 `npm install`）
- 项目必须是 Git 仓库且已配置远程仓库
- OpenCode 数据库位于 `~/.local/share/opencode/opencode.db`

## 文件结构

```
├── SKILL.md                          # 技能定义文件
└── scripts/
    ├── check_session.js              # 验证是否为新会话
    ├── export_conversations.js       # 导出对话到 SQL
    └── import_conversations.js       # 从 SQL 导入对话
```

## 工作原理

1. **导出**：读取本地 `opencode.db` SQLite 数据库，提取当前项目（按工作目录匹配）的所有数据，将绝对路径和项目 ID 替换为占位符，将 `INSERT` 语句写入 `.opencode/conversations.sql`。
2. **导入**：读取 SQL 文件，将占位符替换为本机实际路径和项目 ID，在事务中使用 `INSERT OR REPLACE` 执行语句。
3. 跨设备识别通过 Git 远程仓库 URL 完成 — 不同机器上的同一仓库会被识别为同一项目。

## 许可证

MIT
