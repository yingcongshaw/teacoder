# 项目/会话分离设计

> 日期：2026-08-06
> 状态：已确认

## 背景

当前左侧栏目的新建会话流程将项目信息和会话信息混合在一起（CLI、Profile、工作目录、标题、颜色、高级选项）。需要将项目和会话分离为两级实体：先新建项目，再在项目下新建会话。

## 决策记录

- 项目数据：前后端都存入 SQLite
- 会话必须归属项目，不允许游离会话
- CLI 参数按工具类型动态显示
- 思考强度：仅前端会话级参数
- 会话模板：前端 localStorage
- 侧栏结构：项目为一级节点，会话为二级节点（树形）

## 数据模型

### 后端 SQLite 新增表（v3_projects.sql）

**projects 表**：

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| name | TEXT | NOT NULL | 项目名称 |
| path | TEXT | NOT NULL UNIQUE | 项目路径（工作目录） |
| color | TEXT | | 颜色标记 |
| created_at | INTEGER | NOT NULL | Unix 毫秒时间戳 |
| updated_at | INTEGER | NOT NULL | Unix 毫秒时间戳 |

**sessions 表**：

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| project_id | TEXT | FK → projects.id ON DELETE CASCADE | 所属项目 |
| title | TEXT | | 标签页标题 |
| tool_type | TEXT | NOT NULL | CLI 工具类型 |
| profile_id | TEXT | | 关联 Profile |
| color | TEXT | | 颜色标记 |
| thinking_intensity | TEXT | DEFAULT 'medium' | 思考强度 |
| template_id | TEXT | | 会话模板 ID（后端仅存引用，模板内容在前端 localStorage） |
| cli_args | TEXT | | JSON 格式 CLI 参数 |
| env_vars | TEXT | | JSON 格式环境变量 |
| is_running | INTEGER | DEFAULT 0 | 是否运行中（应用启动时重置为 0） |
| created_at | INTEGER | NOT NULL | 创建时间 |
| updated_at | INTEGER | NOT NULL | 更新时间 |
| closed_at | INTEGER | | 关闭时间 |

### 前端 TypeScript 类型

```typescript
interface Project {
  id: string;
  name: string;
  path: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

interface Session {
  id: string;
  projectId: string;
  title?: string;
  toolType: ToolType;
  profileId?: string;
  color?: string;
  thinkingIntensity: string;  // 'low' | 'medium' | 'high'
  templateId?: string;
  cliArgs?: Record<string, unknown>;
  envVars?: Record<string, string>;
  isRunning: boolean;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
}
```

### 会话模板（前端 localStorage）

```typescript
interface SessionTemplate {
  id: string;
  name: string;  // '无模板' | '用工作站' | '代码审查' | 'Bug修复' | '功能开发' | '代码重构'
  icon?: string;
  defaultThinkingIntensity?: string;
  defaultCliArgs?: Record<string, unknown>;
  description?: string;
}
```

内置预设模板（不可删除）：无模板、用工作站、代码审查、Bug修复、功能开发、代码重构。

## 侧栏结构

树形布局，项目为一级节点，会话为二级节点：

```
┌─────────────────────────┐
│ [CLI 工具状态图标]  [刷新] │
├─────────────────────────┤
│ 🔍 搜索...              │
├─────────────────────────┤
│ 项目 (3)        [+项目]  │
├─────────────────────────┤
│ ▼ 📁 TeaCoder    [+会话]│
│   🟣 Claude Code        │
│   🔵 Codex CLI          │
│ ▶ 📁 my-app             │
│ ▶ 📁 web-scraper        │
└─────────────────────────┘
```

- 项目节点：显示项目名称 + 折叠箭头 + hover 时显示"新建会话"按钮
- 会话节点：显示颜色圆点 + 标题（或 CLI 工具名）+ 运行中绿色脉冲 + hover 时显示删除按钮
- 项目右键菜单：重命名、删除项目、新建会话
- 会话右键菜单：重命名、复制、移动到其他项目、删除
- 顶部"新建"按钮改为"新建项目"
- 删除项目时级联删除其下所有会话（需确认弹窗）
- 项目折叠状态按 projectId 存储

## 新建流程

### 新建项目对话框

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| 项目名称 | Input | 是 | 用户自定义名称 |
| 项目路径 | Input + 文件夹浏览 | 是 | 选择工作目录，路径唯一约束 |
| 颜色标记 | 8 色圆点选择 | 否 | 项目级颜色 |

提交后：前端创建 Project → IPC `project_create` → 后端写入 SQLite → 前端更新 store → 自动展开该项目节点。

### 新建会话对话框

项目路径已锁定为所属项目路径，不可修改。

**基础区域**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| CLI 工具 | 图标行选择（30px 行高） | 是 | 每个工具占一行，仅显示图标+名称，hover 显示描述/版本/可用状态 |
| 标签页标题 | Input | 否 | 默认自动生成 |
| 颜色标记 | 8 色圆点选择 | 否 | 会话级颜色 |
| 思考强度 | Select/Radio | 否 | low/medium/high，默认继承全局设置 |
| 会话模板 | Select | 否 | 下拉选择模板，默认"无模板" |

**CLI 参数区域**（按 tool_type 动态显示，仅选中 CLI 后出现）：

**Claude Code 参数**：
- 跳过权限（`--dangerously-skip-permissions`）— Switch
- 限制工具（`--allowedTools`）— Tag 输入
- 禁用工具（`--disallowedTools`）— Tag 输入
- 最大轮数（`--max-turns`）— InputNumber
- 追加提示（`--append-system-prompt`）— TextArea
- 详细日志（`--verbose`）— Switch
- MCP 配置（`--mcp-config`）— Input + 文件选择

**Codex CLI / Gemini CLI / OpenCode 参数**：待定，按各工具实际参数补充。

### CLI 工具选择交互

- 每个工具占一行（30px 行高），仅显示图标 + 名称
- 不可用的工具灰显但仍可查看
- hover 时 tooltip 显示：描述、版本号、安装路径
- 选中后下方展开该工具的专属参数区域

## 后端 IPC 命令

### 项目命令（commands/project.rs）

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `project_list` | — | `Vec<Project>` | 列出所有项目 |
| `project_create` | `name, path, color?` | `Project` | 创建项目，path 唯一约束 |
| `project_update` | `id, name?, color?` | `Project` | 更新项目（路径不可改） |
| `project_delete` | `id` | — | 删除项目及级联会话 |

### 会话命令（commands/session.rs，新增）

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `session_list` | `project_id?` | `Vec<Session>` | 列出会话，可按项目过滤 |
| `session_create` | `project_id, tool_type, title?, profile_id?, color?, thinking_intensity?, template_id?, cli_args?, env_vars?` | `Session` | 创建会话 |
| `session_update` | `id, ...` | `Session` | 更新会话字段 |
| `session_delete` | `id` | — | 删除会话 |

### 修改现有命令

- `start_session` — 参数增加 `cli_args: Option<String>`（JSON），替代原来的 `args: Option<String>`

## 数据迁移

### 后端迁移（v3_projects.sql）

1. 创建 `projects` 表
2. 创建 `sessions` 表（含 `project_id` FK，`ON DELETE CASCADE`）
3. 从现有 `session_costs.project_path` 提取去重路径（跳过空值），自动生成 projects 记录

### 前端迁移

- 首次启动检测 localStorage 中有 `teacoder_sessions` 但后端 sessions 表为空时，执行迁移
- 迁移逻辑：按 workDir 分组 → 为每个 workDir 创建 Project → 为每个 TabState 创建 Session（关联对应 project_id）
- 迁移完成后清除 localStorage 中的旧数据

## 前端 Store 重构

### 移除

- `sessions: TabState[]` — 改为从后端加载
- `collapsedProjects: string[]` — 改为按 projectId 存储

### 新增状态

| 字段 | 类型 | 说明 |
|------|------|------|
| `projects: Project[]` | 从后端加载，前端缓存 |
| `sessions: Session[]` | 从后端加载，前端缓存 |
| `collapsedProjectIds: string[]` | 折叠的项目 ID |
| `newProjectModalOpen: boolean` | 新建项目对话框 |
| `newSessionModalOpen: boolean` | 新建会话对话框 |
| `newSessionProjectId: string \| null` | 新建会话所属项目 |
| `sessionTemplates: SessionTemplate[]` | 会话模板（localStorage） |
| `globalThinkingIntensity: string` | 全局思考强度默认值（从设置页配置，存 localStorage） |

### 新增方法

| 方法 | 说明 |
|------|------|
| `loadProjects()` | IPC `project_list` → 更新 projects |
| `createProject(name, path, color?)` | IPC `project_create` → 更新 projects |
| `updateProject(id, ...)` | IPC `project_update` → 更新 projects |
| `deleteProject(id)` | IPC `project_delete` → 移除 project + 关联 sessions |
| `loadSessions(projectId?)` | IPC `session_list` → 更新 sessions |
| `createSession(projectId, ...)` | IPC `session_create` + `start_session` → 更新 sessions |
| `updateSession(id, ...)` | IPC `session_update` → 更新 sessions |
| `deleteSession(id)` | `stop_session` + IPC `session_delete` → 移除 |
| `toggleProjectCollapsed(id)` | 切换折叠状态 |

### 保留方法（逻辑调整）

- `openTab(id)` — 从后端 session 记录恢复，重新启动 PTY
- `closeTab(id)` — 停止 PTY + `session_update` 标记 closed_at
- `setActiveTab(id)` / `openTabIds` / `activeTabId` — 不变

### 数据加载时序

1. App 启动 → 后端重置所有 sessions.is_running 为 0 → `loadProjects()` + `loadSessions()`
2. 项目/会话变更 → 重新 load 对应列表
3. PTY 事件（`pty:output`/`pty:exit`）→ 更新 `isRunning` 状态

## 组件变更

### 新增组件

| 组件 | 路径 | 说明 |
|------|------|------|
| `NewProjectModal` | `src/components/project/NewProjectModal.tsx` | 新建项目对话框 |
| `NewSessionModal` | `src/components/tabs/NewSessionModal.tsx` | 重写，项目内新建会话 |
| `CliArgsClaude` | `src/components/cli/CliArgsClaude.tsx` | Claude Code 专属参数表单 |
| `CliArgsCodex` | `src/components/cli/CliArgsCodex.tsx` | Codex CLI 专属参数表单 |
| `CliArgsGemini` | `src/components/cli/CliArgsGemini.tsx` | Gemini CLI 专属参数表单 |
| `CliArgsOpenCode` | `src/components/cli/CliArgsOpenCode.tsx` | OpenCode 专属参数表单 |
| `ProjectNode` | `src/components/project/ProjectNode.tsx` | 侧栏项目节点 |

### 修改组件

| 组件 | 变更 |
|------|------|
| `AppSidebar` | 改为渲染 ProjectNode 列表，顶部按钮改为"新建项目"，移除按 workDir 分组逻辑 |
| `AppLayout` | NewSessionModal 传入 projectId，新增 NewProjectModal |
| `AppContent` | 空状态改为"选择或新建项目"引导 |
| `TabBar` | 右键菜单"移动到其他项目"改为从 projects 列表选择 |

### 删除/替换

| 旧逻辑 | 替换为 |
|------|------|
| `groupedSessions`（按 workDir 分组） | `projects` + `sessions` 按 projectId 过滤 |
| `collapsedProjects: string[]`（按目录名） | `collapsedProjectIds: string[]`（按 projectId） |
| 旧 `NewSessionModal` 中的 workDir/高级选项 | 新 `NewSessionModal` 项目路径锁定 + CLI 专属参数 |
