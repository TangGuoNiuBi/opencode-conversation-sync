---
name: conversation-backup
description: 当用户提到"对话备份"时导出当前项目的 opencode 对话记录为 SQL 文件并提交推送到远程仓库；当用户提到"对话导入"时从 SQL 文件导入对话记录到本地 opencode 数据库。
---

# 对话备份与导入

本 skill 用于在不同设备间迁移 opencode 对话记录。对话数据导出为 SQL 文件，跟随项目代码一起通过 git 管理。

## 脚本路径说明

本 skill 的脚本位于 SKILL.md 同级 `scripts/` 目录下，执行时需使用绝对路径：

```
C:/Users/Administrator/.claude/skills/conversation-backup/scripts/
```

## 前置检查（必须首先执行）

**无论用户说"对话备份"还是"对话导入"，都必须先执行以下检查：**

1. 运行检查脚本：

```bash
node C:/Users/Administrator/.claude/skills/conversation-backup/scripts/check_session.js
```

2. 检查输出的 JSON：
   - 如果 `is_new_session: false`：**终止流程**，告诉用户：「对话备份/导入必须在新的对话中执行，当前对话已有历史记录，请新建一个对话后再执行此操作。」
   - 如果 `is_new_session: true`：继续执行后续流程

3. 记录输出中的 `session_id`，后续步骤需要用到

## 对话备份

当前置检查通过后，执行以下步骤：

1. 记录当前分支，拉取远程变更，然后切换到 `conversations-backup` 分支：

```bash
ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch origin
git checkout conversations-backup 2>/dev/null || git checkout -b conversations-backup origin/main
```

2. 运行导出脚本，排除当前对话（将 `<项目目录>` 替换为当前项目的绝对路径，`<session_id>` 替换为前置检查中获取的当前对话 ID）：

```bash
node C:/Users/Administrator/.claude/skills/conversation-backup/scripts/export_conversations.js --exclude-session <session_id> "<项目目录>"
```

3. 检查输出的 JSON，确认 `success: true` 并查看各表导出的记录数
4. 使用输出中的 `commit_message` 字段作为 git commit message，**必须完整使用，不得截断或省略任何内容**（包括各对话详情列表）：

```bash
git add .opencode/conversations.sql
git commit -m "使用 commit_message 字段的内容"
git push -u origin conversations-backup
```

5. 切回用户原来的分支：

```bash
git checkout $ORIGINAL_BRANCH
```

6. 向用户报告导出结果（各表记录数）

## 对话导入

当前置检查通过后，执行以下步骤：

1. 记录当前分支，拉取远程变更，然后切换到 `conversations-backup` 分支：

```bash
ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch origin
git checkout conversations-backup 2>/dev/null || git checkout -b conversations-backup origin/main
```

2. 先运行 dry-run 预览：

```bash
node C:/Users/Administrator/.claude/skills/conversation-backup/scripts/import_conversations.js --dry-run "<项目目录>"
```

3. 将预览结果展示给用户，包括：
   - 各表将要导入的记录数
   - 本地项目路径和 project_id
   - SQL 文件头部元信息

4. 使用 `question` 工具询问用户是否确认导入，说明导入将使用 `INSERT OR REPLACE` 覆盖同主键的已有记录

5. 用户确认后执行实际导入：

```bash
node C:/Users/Administrator/.claude/skills/conversation-backup/scripts/import_conversations.js --yes "<项目目录>"
```

6. 切回用户原来的分支：

```bash
git checkout $ORIGINAL_BRANCH
```

7. 向用户报告导入结果

## 注意事项

- SQL 文件中的项目绝对路径和 project_id 使用 `{{WORKTREE}}` 和 `{{PROJECT_ID}}` 占位符，导入时自动替换为当前设备的实际值
- 跨设备识别通过 git remote URL 确认是同一个项目
- 导入使用 `INSERT OR REPLACE`，主键相同的记录会被覆盖，不影响其他项目的对话
- 脚本依赖 Node.js 22+（使用内置 `node:sqlite` 模块，无需 npm install）
- **对话备份/导入必须在新的对话中执行**，避免将执行过程本身的数据导出
- 备份/导入操作在独立的 `conversations-backup` 分支上执行，避免 commit 记录污染用户的工作分支；操作完成后自动切回原分支
