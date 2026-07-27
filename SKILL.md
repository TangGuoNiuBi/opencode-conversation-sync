---
name: conversation-backup
description: 当用户提到"对话备份"时导出当前项目的 opencode 对话记录为 SQL 文件并提交推送到远程仓库；当用户提到"对话导入"时从 SQL 文件导入对话记录到本地 opencode 数据库；当用户提到"批量对话备份"时批量备份多个项目目录的对话；当用户提到"批量对话导入"时批量导入多个项目目录的对话。
---

# 对话备份与导入

本 skill 用于在不同设备间迁移 opencode 对话记录。对话数据导出为 SQL 文件，跟随项目代码一起通过 git 管理。

## 脚本路径说明

本 skill 的脚本位于 SKILL.md 同级 `scripts/` 目录下，执行时需使用绝对路径：

```
~/.config/opencode/skills/conversation-backup/scripts/
```

## 前置检查（必须首先执行）

**无论用户说"对话备份"还是"对话导入"，都必须先执行以下检查：**

1. 运行检查脚本：

```bash
node ~/.config/opencode/skills/conversation-backup/scripts/check_session.js
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
git fetch origin conversations-backup
git checkout conversations-backup 2>/dev/null || git checkout -b conversations-backup origin/main
```

2. **预导入检查**：检查 `.opencode/conversations.sql` 是否存在，如果存在则运行 dry-run 检查是否有本地缺失的会话：

```bash
node ~/.config/opencode/skills/conversation-backup/scripts/import_conversations.js --dry-run --ignore-existing "<项目目录>"
```

   - 如果 `session_analysis.new_count > 0`：执行预导入（使用 `--yes --ignore-existing`），只添加本地缺失的会话
   - 如果 `session_analysis.new_count == 0` 或 SQL 文件不存在：跳过预导入

3. 运行导出脚本前，使用 `question` 工具询问用户是否导出 event 表：

   - **问题**：「是否导出 event 表？」
   - **选项 1**：「导出 event 表（推荐）」— 完整备份，导入后可无缝继续对话，但 SQL 文件较大（event 表通常占 90%+ 体积）
   - **选项 2**：「不导出 event 表」— SQL 文件体积小（仅几 MB），导入后可查看历史消息和会话列表，但在新设备上继续对话时可能出现状态异常

4. 根据用户选择运行导出脚本，排除当前对话（将 `<项目目录>` 替换为当前项目的绝对路径，`<session_id>` 替换为前置检查中获取的当前对话 ID）：

   - 如果用户选择导出 event 表：
   ```bash
   node ~/.config/opencode/skills/conversation-backup/scripts/export_conversations.js --exclude-session <session_id> "<项目目录>"
   ```

   - 如果用户选择不导出 event 表：
   ```bash
   node ~/.config/opencode/skills/conversation-backup/scripts/export_conversations.js --exclude-session <session_id> --no-events "<项目目录>"
   ```

5. 检查输出的 JSON，确认 `success: true` 并查看各表导出的记录数
6. 使用输出中的 `commit_message` 字段作为 git commit message，**必须完整使用，不得截断或省略任何内容**（包括各对话详情列表）：

```bash
git add .opencode/conversations.sql
git commit -m "使用 commit_message 字段的内容"
git push -u origin conversations-backup
```

6. 切回用户原来的分支：

```bash
git checkout $ORIGINAL_BRANCH
```

7. 向用户报告导出结果（各表记录数）

## 对话导入

当前置检查通过后，执行以下步骤：

1. 记录当前分支，拉取远程变更，然后切换到 `conversations-backup` 分支：

```bash
ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch origin conversations-backup
git checkout conversations-backup 2>/dev/null || git checkout -b conversations-backup origin/main
```

2. 先运行 dry-run 预览：

```bash
node ~/.config/opencode/skills/conversation-backup/scripts/import_conversations.js --dry-run "<项目目录>"
```

3. 将预览结果展示给用户，包括：
   - 各表将要导入的记录数
   - 本地项目路径和 project_id
   - SQL 文件头部元信息

4. 使用 `question` 工具询问用户是否确认导入，说明导入将使用 `INSERT OR REPLACE` 覆盖同主键的已有记录

5. 用户确认后执行实际导入：

```bash
node ~/.config/opencode/skills/conversation-backup/scripts/import_conversations.js --yes "<项目目录>"
```

6. 切回用户原来的分支：

```bash
git checkout $ORIGINAL_BRANCH
```

7. 向用户报告导入结果

8. **重要提示**：告知用户需要**完全退出并重新启动 opencode** 才能看到导入的对话。仅刷新页面不够，因为 opencode 在启动时加载会话列表到内存缓存中，外部数据库修改不会被自动感知。

## 批量对话备份

当用户提到"批量对话备份"时，对多个项目目录**并行**执行对话备份。

### 流程

1. **执行一次前置检查**（使用当前工作目录）：

```bash
node ~/.config/opencode/skills/conversation-backup/scripts/check_session.js
```

   - 如果 `is_new_session: false`：终止流程，提示用户新建对话
   - 如果 `is_new_session: true`：记录 `session_id`，继续

2. **预筛选目录列表**：对用户指定的每个目录，检查是否存在且为 git 仓库，过滤出有效目录

3. **询问是否导出 event 表**：使用 `question` 工具询问用户（与单项目备份相同的问题和选项）：
   - **问题**：「是否导出 event 表？」
   - **选项 1**：「导出 event 表（推荐）」— 完整备份，导入后可无缝继续对话，但 SQL 文件较大（event 表通常占 90%+ 体积）
   - **选项 2**：「不导出 event 表」— SQL 文件体积小（仅几 MB），导入后可查看历史消息和会话列表，但在新设备上继续对话时可能出现状态异常

4. **并行执行备份**：对每个有效目录启动一个 `@bash` 子 agent **并行**执行（导出脚本以只读模式访问 DB，各目录 git 操作互不干扰）：
   - 记录当前分支，切换到 `conversations-backup` 分支
   - 预导入检查（如有缺失会话则用 `--ignore-existing` 导入）
   - 运行 export 脚本（传入该目录的绝对路径和 `session_id`，根据用户选择决定是否加 `--no-events`）
   - git add + commit + push
   - 切回原分支
   - 返回执行结果（成功/失败及详情）

5. **汇总报告**：所有子 agent 完成后，向用户展示所有目录的执行结果，包括：
   - 成功备份的目录及各表记录数
   - 跳过的目录及原因
   - 失败的目录及错误信息

## 批量对话导入

当用户提到"批量对话导入"时，对多个项目目录**依次**执行对话导入（导入涉及 DB 写操作，SQLite 不支持并发写，必须串行执行）。

### 流程

**阶段 1：前置检查与预筛选**

1. **执行一次前置检查**（使用当前工作目录）：

```bash
node ~/.config/opencode/skills/conversation-backup/scripts/check_session.js
```

   - 如果 `is_new_session: false`：终止流程，提示用户新建对话
   - 如果 `is_new_session: true`：继续

2. **预筛选目录列表**：对用户指定的每个目录，检查是否存在且为 git 仓库（`git rev-parse --is-inside-work-tree`），过滤出有效目录，记录跳过的目录

**阶段 2：切换分支与 dry-run 预览**

3. **依次对每个有效目录执行切分支 + dry-run**（必须串行，每个目录完整执行完**立即自动继续下一个目录，不要等待用户确认**）：

   a. 记录当前分支，切换到 `conversations-backup` 分支：
   ```bash
   ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)
   git fetch origin conversations-backup
   git checkout conversations-backup 2>/dev/null || git checkout -b conversations-backup origin/main
   ```

   b. 运行 dry-run 预览：
   ```bash
   node ~/.config/opencode/skills/conversation-backup/scripts/import_conversations.js --dry-run "<项目目录>"
   ```

   c. 记录该目录的 dry-run 结果和原始分支名，**立即继续处理下一个目录**

4. **所有目录 dry-run 全部完成后**，汇总展示所有目录的 dry-run 结果，使用 `question` 工具一次性询问用户是否确认全部导入

**阶段 3：执行实际导入**

5. **用户确认后，依次对每个目录执行实际导入**（必须串行，每个目录完整执行完再处理下一个）：

   a. 切换到该目录的 `conversations-backup` 分支（如果不在该分支上）
   b. 执行实际导入：
   ```bash
   node ~/.config/opencode/skills/conversation-backup/scripts/import_conversations.js --yes "<项目目录>"
   ```
   c. **必须展示每个目录的导入命令输出**，不得省略或编造结果

**阶段 4：切回与汇总**

6. **依次切回每个目录的原始分支**：
   ```bash
   git checkout $ORIGINAL_BRANCH
   ```

7. **汇总报告**：向用户展示所有目录的执行结果，包括：
   - 成功导入的目录及各表记录数
   - 跳过的目录及原因
   - 失败的目录及错误信息

8. **重要提示**：告知用户需要**完全退出并重新启动 opencode** 才能看到导入的对话。仅刷新页面不够，因为 opencode 在启动时加载会话列表到内存缓存中。

## 注意事项

- SQL 文件中的项目绝对路径和 project_id 使用 `{{WORKTREE}}` 和 `{{PROJECT_ID}}` 占位符，导入时自动替换为当前设备的实际值
- 跨设备识别通过 git remote URL 确认是同一个项目
- 导入使用 `INSERT OR REPLACE`，主键相同的记录会被覆盖，不影响其他项目的对话
- 脚本依赖 Node.js 22+（使用内置 `node:sqlite` 模块，无需 npm install）
- **对话备份/导入必须在新的对话中执行**，避免将执行过程本身的数据导出
- 备份/导入操作在独立的 `conversations-backup` 分支上执行，避免 commit 记录污染用户的工作分支；操作完成后自动切回原分支
