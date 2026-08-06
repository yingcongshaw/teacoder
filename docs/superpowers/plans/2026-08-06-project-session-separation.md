# 项目/会话分离 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将左侧栏目的新建流程从"混合项目/会话信息"重构为"先新建项目，再项目下新建会话"的两级实体结构。

**Architecture:** 后端新增 projects/sessions SQLite 表和对应 IPC 命令，前端新增 Project/Session 类型替换 TabState，Zustand store 改为从后端加载数据，侧栏改为项目→会话树形结构，新建流程拆为 NewProjectModal + NewSessionModal 两个对话框。

**Tech Stack:** Rust/Tauri 2.x, rusqlite, React 19, TypeScript 5.x, Ant Design 6.x, Zustand, TailwindCSS 4.x

## Global Constraints

- Rust 公共 API 必须有 `///` 文档注释，禁止 `unwrap()` 在非测试代码中使用
- TypeScript 严格模式 `"strict": true`，禁止 `any`
- Ant Design 负责 UI 组件，TailwindCSS 仅用于布局/间距/自定义样式，禁止用 TailwindCSS 覆盖 AntD 样式
- IPC 命令命名：`<领域>_<动作>`，事件命名：`<领域>:<事件>`
- Git commit message 使用中文，格式：`<类型>: <描述>`
- 所有表必须有 `created_at` / `updated_at` 字段（INTEGER，Unix 毫秒时间戳）
- 禁止 `ALTER TABLE` 删除列，使用新增列 + 代码层忽略
- axum 网关仅监听 127.0.0.1

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `src-tauri/migrations/v3_projects.sql` | projects + sessions 建表迁移 |
| `src-tauri/src/project/mod.rs` | Project 数据模型 + CRUD 操作 |
| `src-tauri/src/session/mod.rs` | Session 数据模型 + CRUD 操作 |
| `src-tauri/src/commands/project.rs` | 项目 IPC 命令 |
| `src-tauri/src/commands/session.rs` | 会话 IPC 命令 |
| `src/components/project/NewProjectModal.tsx` | 新建项目对话框 |
| `src/components/project/ProjectNode.tsx` | 侧栏项目节点组件 |
| `src/components/cli/CliArgsClaude.tsx` | Claude Code 专属参数表单 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src-tauri/src/lib.rs` | 注册新命令 + 管理 ProjectManager |
| `src-tauri/src/commands/mod.rs` | 新增 project/session 模块 |
| `src-tauri/src/commands/pty.rs` | start_session 增加 cli_args 参数 |
| `src/types/index.ts` | 新增 Project/Session/SessionTemplate 类型，移除 TabState |
| `src/stores/appStore.ts` | 全面重构：新增 projects/sessions 状态和方法 |
| `src/utils/ipc.ts` | 新增项目/会话 IPC 调用 |
| `src/components/layout/AppSidebar.tsx` | 改为渲染 ProjectNode 列表 |
| `src/components/tabs/NewSessionModal.tsx` | 重写为项目内新建会话 |
| `src/components/layout/AppLayout.tsx` | 新增 NewProjectModal，传 projectId 给 NewSessionModal |
| `src/components/layout/AppContent.tsx` | 空状态改为"选择或新建项目" |
| `src/components/tabs/TabBar.tsx` | 移动到其他项目改为从 projects 列表选择 |

---

### Task 1: 后端 — 数据库迁移

**Files:**
- Create: `src-tauri/migrations/v3_projects.sql`

**Interfaces:**
- Produces: `projects` 表（id, name, path, color, created_at, updated_at），`sessions` 表（id, project_id FK CASCADE, title, tool_type, profile_id, color, thinking_intensity, template_id, cli_args, env_vars, is_running, created_at, updated_at, closed_at）

- [ ] **Step 1: 创建迁移文件 v3_projects.sql**

```sql
-- Schema v3: 项目/会话分离

CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    color TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT,
    tool_type TEXT NOT NULL,
    profile_id TEXT,
    color TEXT,
    thinking_intensity TEXT DEFAULT 'medium',
    template_id TEXT,
    cli_args TEXT,
    env_vars TEXT,
    is_running INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    closed_at INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 从现有 session_costs.project_path 提取去重路径（跳过空值），自动生成 projects 记录
INSERT OR IGNORE INTO projects (id, name, path, created_at, updated_at)
SELECT
    lower(hex(randomblob(16))),
    -- 取路径最后一段作为项目名
    CASE
        WHEN instr(reverse(project_path), '/') > 0
        THEN substr(project_path, length(project_path) - instr(reverse(project_path), '/') + 2)
        ELSE project_path
    END,
    project_path,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
FROM (SELECT DISTINCT project_path FROM session_costs WHERE project_path IS NOT NULL AND project_path != '');

INSERT INTO schema_version (version, applied_at) VALUES (3, strftime('%s', 'now') * 1000);
```

- [ ] **Step 2: 验证迁移**

运行: `cd /work/CodingTea/CondingTea/src && pnpm tauri dev`，启动后检查 SQLite 数据库中 projects 和 sessions 表是否存在。

- [ ] **Step 3: 提交**

```bash
git add src-tauri/migrations/v3_projects.sql
git commit -m "feat: 添加 projects 和 sessions 表迁移"
```

---

### Task 2: 后端 — Project 数据模型与 CRUD

**Files:**
- Create: `src-tauri/src/project/mod.rs`

**Interfaces:**
- Consumes: `AppDatabase`（from `crate::storage`）
- Produces: `Project` struct（id, name, path, color, created_at, updated_at）, `CreateProjectInput` struct, `UpdateProjectInput` struct, 函数 `list_projects`, `create_project`, `update_project`, `delete_project`

- [ ] **Step 1: 创建 project/mod.rs**

```rust
use serde::{Deserialize, Serialize};

use crate::storage::AppDatabase;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
    pub path: String,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub color: Option<String>,
}

/// 列出所有项目
pub fn list_projects(db: &AppDatabase) -> Result<Vec<Project>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, path, color, created_at, updated_at FROM projects ORDER BY updated_at DESC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                color: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to query projects: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect projects: {}", e))
}

/// 创建项目，path 必须唯一
pub fn create_project(db: &AppDatabase, input: CreateProjectInput) -> Result<Project, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO projects (id, name, path, color, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, input.name, input.path, input.color, now, now],
    )
    .map_err(|e| {
        if e.to_string().contains("UNIQUE constraint failed") {
            format!("项目路径已存在: {}", input.path)
        } else {
            format!("Failed to insert project: {}", e)
        }
    })?;
    Ok(Project {
        id,
        name: input.name,
        path: input.path,
        color: input.color,
        created_at: now,
        updated_at: now,
    })
}

/// 更新项目（路径不可改）
pub fn update_project(db: &AppDatabase, id: &str, input: UpdateProjectInput) -> Result<Project, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();
    let mut set_clauses: Vec<String> = vec!["updated_at = ?1".to_string()];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
    if let Some(ref name) = input.name {
        set_clauses.push("name = ?".to_string());
        params.push(Box::new(name.clone()));
    }
    if let Some(ref color) = input.color {
        set_clauses.push("color = ?".to_string());
        params.push(Box::new(color.clone()));
    }
    let sql = format!("UPDATE projects SET {} WHERE id = ?", set_clauses.join(", "));
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut all_refs: Vec<&dyn rusqlite::types::ToSql> = param_refs;
    all_refs.push(&id);
    conn.execute(&sql, all_refs.as_slice())
        .map_err(|e| format!("Failed to update project: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, name, path, color, created_at, updated_at FROM projects WHERE id = ?1")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;
    stmt.query_row([id], |row| {
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            color: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })
    .map_err(|e| format!("Failed to fetch updated project: {}", e))
}

/// 删除项目及级联会话
pub fn delete_project(db: &AppDatabase, id: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM projects WHERE id = ?1", [id])
        .map_err(|e| format!("Failed to delete project: {}", e))?;
    Ok(())
}
```

- [ ] **Step 2: 在 lib.rs 中添加 mod 声明**

在 `src-tauri/src/lib.rs` 顶部添加 `mod project;`

- [ ] **Step 3: 运行 cargo check**

```bash
cd /work/CodingTea/CondingTea/src/src-tauri && cargo check
```

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/project/mod.rs src-tauri/src/lib.rs
git commit -m "feat: 添加 Project 数据模型与 CRUD"
```

---

### Task 3: 后端 — Session 数据模型与 CRUD

**Files:**
- Create: `src-tauri/src/session/mod.rs`

**Interfaces:**
- Consumes: `AppDatabase`（from `crate::storage`）
- Produces: `Session` struct（id, project_id, title, tool_type, profile_id, color, thinking_intensity, template_id, cli_args, env_vars, is_running, created_at, updated_at, closed_at）, `CreateSessionInput` struct, `UpdateSessionInput` struct, 函数 `list_sessions`, `create_session`, `update_session`, `delete_session`, `reset_all_running`

- [ ] **Step 1: 创建 session/mod.rs**

```rust
use serde::{Deserialize, Serialize};

use crate::storage::AppDatabase;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub title: Option<String>,
    pub tool_type: String,
    pub profile_id: Option<String>,
    pub color: Option<String>,
    pub thinking_intensity: String,
    pub template_id: Option<String>,
    pub cli_args: Option<String>,
    pub env_vars: Option<String>,
    pub is_running: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub closed_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionInput {
    pub project_id: String,
    pub tool_type: String,
    pub title: Option<String>,
    pub profile_id: Option<String>,
    pub color: Option<String>,
    pub thinking_intensity: Option<String>,
    pub template_id: Option<String>,
    pub cli_args: Option<String>,
    pub env_vars: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionInput {
    pub title: Option<String>,
    pub profile_id: Option<String>,
    pub color: Option<String>,
    pub thinking_intensity: Option<String>,
    pub template_id: Option<String>,
    pub cli_args: Option<String>,
    pub env_vars: Option<String>,
    pub is_running: Option<bool>,
    pub closed_at: Option<i64>,
    pub project_id: Option<String>,
}

/// 列出会话，可按项目过滤
pub fn list_sessions(db: &AppDatabase, project_id: Option<&str>) -> Result<Vec<Session>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let sql = if project_id.is_some() {
        "SELECT id, project_id, title, tool_type, profile_id, color, thinking_intensity, template_id, cli_args, env_vars, is_running, created_at, updated_at, closed_at FROM sessions WHERE project_id = ?1 ORDER BY updated_at DESC"
    } else {
        "SELECT id, project_id, title, tool_type, profile_id, color, thinking_intensity, template_id, cli_args, env_vars, is_running, created_at, updated_at, closed_at FROM sessions ORDER BY updated_at DESC"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| format!("Failed to prepare query: {}", e))?;
    let rows = if let Some(pid) = project_id {
        stmt.query_map([pid], map_session)?
    } else {
        stmt.query_map([], map_session)?
    };
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect sessions: {}", e))
}

fn map_session(row: &rusqlite::Row) -> rusqlite::Result<Session> {
    Ok(Session {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        tool_type: row.get(3)?,
        profile_id: row.get(4)?,
        color: row.get(5)?,
        thinking_intensity: row.get(6)?,
        template_id: row.get(7)?,
        cli_args: row.get(8)?,
        env_vars: row.get(9)?,
        is_running: row.get::<_, i64>(10)? != 0,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        closed_at: row.get(13)?,
    })
}

/// 创建会话
pub fn create_session(db: &AppDatabase, input: CreateSessionInput) -> Result<Session, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let thinking_intensity = input.thinking_intensity.unwrap_or_else(|| "medium".to_string());
    conn.execute(
        "INSERT INTO sessions (id, project_id, title, tool_type, profile_id, color, thinking_intensity, template_id, cli_args, env_vars, is_running, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, ?12)",
        rusqlite::params![
            id, input.project_id, input.title, input.tool_type,
            input.profile_id, input.color, thinking_intensity,
            input.template_id, input.cli_args, input.env_vars,
            now, now,
        ],
    )
    .map_err(|e| format!("Failed to insert session: {}", e))?;
    Ok(Session {
        id,
        project_id: input.project_id,
        title: input.title,
        tool_type: input.tool_type,
        profile_id: input.profile_id,
        color: input.color,
        thinking_intensity,
        template_id: input.template_id,
        cli_args: input.cli_args,
        env_vars: input.env_vars,
        is_running: true,
        created_at: now,
        updated_at: now,
        closed_at: None,
    })
}

/// 更新会话
pub fn update_session(db: &AppDatabase, id: &str, input: UpdateSessionInput) -> Result<Session, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();
    let mut set_clauses: Vec<String> = vec!["updated_at = ?".to_string()];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
    let fields: [(&str, Option<&String>); 10] = [
        ("title", input.title.as_ref()),
        ("profile_id", input.profile_id.as_ref()),
        ("color", input.color.as_ref()),
        ("thinking_intensity", input.thinking_intensity.as_ref()),
        ("template_id", input.template_id.as_ref()),
        ("cli_args", input.cli_args.as_ref()),
        ("env_vars", input.env_vars.as_ref()),
        ("project_id", input.project_id.as_ref()),
        // closed_at 和 is_running 需要特殊处理
        ("closed_at", None),
        ("is_running", None),
    ];
    for (col, val) in &fields {
        if let Some(v) = val {
            set_clauses.push(format!("{} = ?", col));
            params.push(Box::new(v.clone()));
        }
    }
    if let Some(running) = input.is_running {
        set_clauses.push("is_running = ?".to_string());
        params.push(Box::new(if running { 1i64 } else { 0i64 }));
    }
    if let Some(closed) = input.closed_at {
        set_clauses.push("closed_at = ?".to_string());
        params.push(Box::new(closed));
    }
    let sql = format!("UPDATE sessions SET {} WHERE id = ?", set_clauses.join(", "));
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut all_refs: Vec<&dyn rusqlite::types::ToSql> = param_refs;
    all_refs.push(&id);
    conn.execute(&sql, all_refs.as_slice())
        .map_err(|e| format!("Failed to update session: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, project_id, title, tool_type, profile_id, color, thinking_intensity, template_id, cli_args, env_vars, is_running, created_at, updated_at, closed_at FROM sessions WHERE id = ?1")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;
    stmt.query_row([id], map_session)
        .map_err(|e| format!("Failed to fetch updated session: {}", e))
}

/// 删除会话
pub fn delete_session(db: &AppDatabase, id: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sessions WHERE id = ?1", [id])
        .map_err(|e| format!("Failed to delete session: {}", e))?;
    Ok(())
}

/// 应用启动时重置所有 is_running 为 0
pub fn reset_all_running(db: &AppDatabase) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE sessions SET is_running = 0 WHERE is_running = 1", [])
        .map_err(|e| format!("Failed to reset running state: {}", e))?;
    Ok(())
}
```

- [ ] **Step 2: 在 lib.rs 中添加 mod 声明**

在 `src-tauri/src/lib.rs` 顶部添加 `mod session;`

- [ ] **Step 3: 运行 cargo check**

```bash
cd /work/CodingTea/CondingTea/src/src-tauri && cargo check
```

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/session/mod.rs src-tauri/src/lib.rs
git commit -m "feat: 添加 Session 数据模型与 CRUD"
```

---

### Task 4: 后端 — IPC 命令注册

**Files:**
- Create: `src-tauri/src/commands/project.rs`
- Create: `src-tauri/src/commands/session.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands/pty.rs`

**Interfaces:**
- Consumes: `project::list_projects`, `project::create_project`, `project::update_project`, `project::delete_project`, `session::list_sessions`, `session::create_session`, `session::update_session`, `session::delete_session`, `session::reset_all_running`
- Produces: IPC 命令 `project_list`, `project_create`, `project_update`, `project_delete`, `session_list`, `session_create`, `session_update`, `session_delete`

- [ ] **Step 1: 创建 commands/project.rs**

```rust
use crate::project;
use crate::storage::AppDatabase;
use crate::project::{CreateProjectInput, UpdateProjectInput, Project};

#[tauri::command]
pub fn project_list(db: tauri::State<AppDatabase>) -> Result<Vec<Project>, String> {
    project::list_projects(&db)
}

#[tauri::command]
pub fn project_create(
    db: tauri::State<AppDatabase>,
    input: CreateProjectInput,
) -> Result<Project, String> {
    project::create_project(&db, input)
}

#[tauri::command]
pub fn project_update(
    db: tauri::State<AppDatabase>,
    id: String,
    input: UpdateProjectInput,
) -> Result<Project, String> {
    project::update_project(&db, &id, input)
}

#[tauri::command]
pub fn project_delete(
    db: tauri::State<AppDatabase>,
    id: String,
) -> Result<(), String> {
    project::delete_project(&db, &id)
}
```

- [ ] **Step 2: 创建 commands/session.rs**

```rust
use crate::session;
use crate::storage::AppDatabase;
use crate::session::{CreateSessionInput, UpdateSessionInput, Session};

#[tauri::command]
pub fn session_list(
    db: tauri::State<AppDatabase>,
    project_id: Option<String>,
) -> Result<Vec<Session>, String> {
    session::list_sessions(&db, project_id.as_deref())
}

#[tauri::command]
pub fn session_create(
    db: tauri::State<AppDatabase>,
    input: CreateSessionInput,
) -> Result<Session, String> {
    session::create_session(&db, input)
}

#[tauri::command]
pub fn session_update(
    db: tauri::State<AppDatabase>,
    id: String,
    input: UpdateSessionInput,
) -> Result<Session, String> {
    session::update_session(&db, &id, input)
}

#[tauri::command]
pub fn session_delete(
    db: tauri::State<AppDatabase>,
    id: String,
) -> Result<(), String> {
    session::delete_session(&db, &id)
}
```

- [ ] **Step 3: 修改 commands/mod.rs**

添加两行：
```rust
pub mod project;
pub mod session;
```

- [ ] **Step 4: 修改 lib.rs — 注册命令 + 启动时重置 is_running**

在 `invoke_handler` 宏中添加：
```rust
commands::project::project_list,
commands::project::project_create,
commands::project::project_update,
commands::project::project_delete,
commands::session::session_list,
commands::session::session_create,
commands::session::session_update,
commands::session::session_delete,
```

在 `setup` 闭包中，`app.manage(db)` 之后添加：
```rust
// 启动时重置所有会话运行状态
{
    use crate::session;
    let db_state = app.state::<AppDatabase>();
    session::reset_all_running(&db_state).ok();
}
```

- [ ] **Step 5: 修改 commands/pty.rs — start_session 增加 cli_args 参数**

在 `start_session` 函数签名中，将 `args: Option<Vec<String>>` 替换为 `cli_args: Option<String>`。

在函数体中，替换 `let args = args.unwrap_or_default();` 为：
```rust
let args: Vec<String> = if let Some(json) = cli_args {
    serde_json::from_str(&json).unwrap_or_default()
} else {
    vec![]
};
```

- [ ] **Step 6: 运行 cargo check**

```bash
cd /work/CodingTea/CondingTea/src/src-tauri && cargo check
```

- [ ] **Step 7: 提交**

```bash
git add src-tauri/src/commands/project.rs src-tauri/src/commands/session.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/src/commands/pty.rs
git commit -m "feat: 注册项目和会话 IPC 命令，start_session 增加 cli_args"
```

---

### Task 5: 前端 — 类型定义与 IPC 封装

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/utils/ipc.ts`

**Interfaces:**
- Produces: `Project`, `Session`, `SessionTemplate` 类型；IPC 函数 `projectList`, `projectCreate`, `projectUpdate`, `projectDelete`, `sessionList`, `sessionCreate`, `sessionUpdate`, `sessionDelete`

- [ ] **Step 1: 在 types/index.ts 中添加新类型**

在 `TabState` 接口之前添加：

```typescript
export interface Project {
  id: string;
  name: string;
  path: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  projectId: string;
  title?: string;
  toolType: ToolType;
  profileId?: string;
  color?: string;
  thinkingIntensity: string;
  templateId?: string;
  cliArgs?: string;
  envVars?: string;
  isRunning: boolean;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
}

export interface SessionTemplate {
  id: string;
  name: string;
  icon?: string;
  defaultThinkingIntensity?: string;
  defaultCliArgs?: Record<string, unknown>;
  description?: string;
}

export const BUILTIN_SESSION_TEMPLATES: SessionTemplate[] = [
  { id: "none", name: "无模板", description: "空白会话" },
  { id: "workstation", name: "用工作站", description: "通用工作站模式", defaultThinkingIntensity: "high" },
  { id: "code-review", name: "代码审查", description: "代码审查专用", defaultThinkingIntensity: "medium" },
  { id: "bug-fix", name: "Bug修复", description: "Bug 定位与修复", defaultThinkingIntensity: "medium" },
  { id: "feature-dev", name: "功能开发", description: "新功能开发", defaultThinkingIntensity: "high" },
  { id: "refactor", name: "代码重构", description: "代码重构与优化", defaultThinkingIntensity: "medium" },
];
```

保留 `TabState` 接口不变（迁移期间兼容），后续 Task 中逐步替换引用。

- [ ] **Step 2: 在 ipc.ts 中添加项目和会话 IPC 调用**

在文件末尾添加：

```typescript
// Project IPC
export async function projectList(): Promise<Project[]> {
  return invoke<Project[]>("project_list");
}

export async function projectCreate(input: {
  name: string;
  path: string;
  color?: string;
}): Promise<Project> {
  return invoke<Project>("project_create", { input });
}

export async function projectUpdate(
  id: string,
  input: { name?: string; color?: string },
): Promise<Project> {
  return invoke<Project>("project_update", { id, input });
}

export async function projectDelete(id: string): Promise<void> {
  return invoke("project_delete", { id });
}

// Session IPC
export async function sessionList(projectId?: string): Promise<Session[]> {
  return invoke<Session[]>("session_list", { projectId });
}

export async function sessionCreate(input: {
  projectId: string;
  toolType: string;
  title?: string;
  profileId?: string;
  color?: string;
  thinkingIntensity?: string;
  templateId?: string;
  cliArgs?: string;
  envVars?: string;
}): Promise<Session> {
  return invoke<Session>("session_create", { input });
}

export async function sessionUpdate(
  id: string,
  input: {
    title?: string;
    profileId?: string;
    color?: string;
    thinkingIntensity?: string;
    templateId?: string;
    cliArgs?: string;
    envVars?: string;
    isRunning?: boolean;
    closedAt?: number;
    projectId?: string;
  },
): Promise<Session> {
  return invoke<Session>("session_update", { id, input });
}

export async function sessionDelete(id: string): Promise<void> {
  return invoke("session_delete", { id });
}
```

同时在文件顶部的 import 中添加 `Project` 和 `Session` 类型。

- [ ] **Step 3: 修改 startSession IPC 签名**

将 `startSession` 的参数类型中 `args?: string[]` 改为 `cliArgs?: string`：

```typescript
export async function startSession(params: {
  toolType: string;
  profileId: string;
  workDir: string;
  tabId: string;
  envVars?: Record<string, string>;
  cliArgs?: string;
}): Promise<void> {
  return invoke("start_session", params);
}
```

- [ ] **Step 4: 运行 typecheck**

```bash
cd /work/CodingTea/CondingTea/src && pnpm tsc --noEmit
```

- [ ] **Step 5: 提交**

```bash
git add src/types/index.ts src/utils/ipc.ts
git commit -m "feat: 添加 Project/Session 类型和 IPC 封装"
```

---

### Task 6: 前端 — Zustand Store 重构

**Files:**
- Modify: `src/stores/appStore.ts`

**Interfaces:**
- Consumes: `Project`, `Session`, `SessionTemplate` 类型，IPC 函数
- Produces: 新的 AppState 接口，包含 projects/sessions 状态和方法

- [ ] **Step 1: 重写 appStore.ts**

核心变更：
1. 移除 `loadSessions`/`saveSessions` 的 localStorage 逻辑
2. 新增 `projects: Project[]` 和 `sessions: Session[]` 状态
3. 新增 `collapsedProjectIds: string[]`（替代 `collapsedProjects: string[]`）
4. 新增 `newProjectModalOpen`/`newSessionProjectId` 状态
5. 新增 `sessionTemplates`/`globalThinkingIntensity`
6. 所有 create/update/delete 操作改为 IPC 调用后更新本地缓存
7. `openTab` 从 sessions 列表获取 session 信息，调用 startSession
8. `closeTab` 调用 stopSession + sessionUpdate 标记 closed_at/is_running
9. 初始化时从 IPC 加载数据而非 localStorage

关键方法实现：
```typescript
loadProjects: async () => {
  const projects = await projectList();
  set({ projects });
},

loadSessions: async () => {
  const sessions = await sessionList();
  set({ sessions });
},

createProject: async (name, path, color) => {
  const project = await projectCreate({ name, path, color });
  set((state) => ({ projects: [...state.projects, project] }));
  return project;
},

createSession: async (input) => {
  const session = await sessionCreate(input);
  // 启动 PTY
  const project = get().projects.find(p => p.id === input.projectId);
  const envVars = input.envVars ? JSON.parse(input.envVars) : undefined;
  await startSession({
    toolType: input.toolType,
    profileId: input.profileId || "",
    workDir: project?.path || "~",
    tabId: session.id,
    envVars,
    cliArgs: input.cliArgs,
  });
  set((state) => ({
    sessions: [...state.sessions, { ...session, isRunning: true }],
    openTabIds: [...state.openTabIds, session.id],
    activeTabId: session.id,
  }));
},
```

- [ ] **Step 2: 运行 typecheck**

```bash
cd /work/CodingTea/CondingTea/src && pnpm tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
git add src/stores/appStore.ts
git commit -m "feat: 重构 Zustand store，项目/会话从后端加载"
```

---

### Task 7: 前端 — 侧栏重构（AppSidebar + ProjectNode）

**Files:**
- Create: `src/components/project/ProjectNode.tsx`
- Modify: `src/components/layout/AppSidebar.tsx`

**Interfaces:**
- Consumes: `Project`, `Session` 类型，`useAppStore` 中的 projects/sessions/collapsedProjectIds

- [ ] **Step 1: 创建 ProjectNode.tsx**

项目节点组件，包含：
- 项目名称 + 折叠箭头
- hover 时显示"新建会话"按钮
- 右键菜单：重命名、删除项目、新建会话
- 展开后渲染该项目下的会话列表
- 会话条目：颜色圆点 + 标题 + 运行中脉冲 + hover 删除

- [ ] **Step 2: 重写 AppSidebar.tsx**

变更：
- 顶部按钮改为"新建项目"（调用 `setNewProjectModalOpen(true)`）
- 区域标题改为"项目"（+ 项目数量 Badge）
- 移除 `groupedSessions` 逻辑
- 渲染 `projects` 列表，每个项目用 `ProjectNode` 组件
- 搜索过滤改为按项目名称/会话标题过滤

- [ ] **Step 3: 提交**

```bash
git add src/components/project/ProjectNode.tsx src/components/layout/AppSidebar.tsx
git commit -m "feat: 重构侧栏为项目/会话树形结构"
```

---

### Task 8: 前端 — NewProjectModal

**Files:**
- Create: `src/components/project/NewProjectModal.tsx`
- Modify: `src/components/layout/AppLayout.tsx`

**Interfaces:**
- Consumes: `useAppStore` 中的 `newProjectModalOpen`/`setNewProjectModalOpen`/`createProject`
- Produces: 创建项目后自动展开该项目

- [ ] **Step 1: 创建 NewProjectModal.tsx**

字段：
- 项目名称 — Input（必填）
- 项目路径 — Input + 文件夹浏览（必填，UNIQUE）
- 颜色标记 — 8 色圆点选择

提交逻辑：调用 `createProject` → 成功后关闭对话框 → 自动展开新项目

- [ ] **Step 2: 修改 AppLayout.tsx**

添加 NewProjectModal 渲染：
```tsx
<NewProjectModal
  open={newProjectModalOpen}
  onClose={() => setNewProjectModalOpen(false)}
/>
```

- [ ] **Step 3: 提交**

```bash
git add src/components/project/NewProjectModal.tsx src/components/layout/AppLayout.tsx
git commit -m "feat: 添加新建项目对话框"
```

---

### Task 9: 前端 — NewSessionModal 重写

**Files:**
- Modify: `src/components/tabs/NewSessionModal.tsx`
- Create: `src/components/cli/CliArgsClaude.tsx`

**Interfaces:**
- Consumes: `projectId`（锁定项目），`useAppStore` 中的 `createSession`/`cliTools`/`profiles`/`sessionTemplates`/`globalThinkingIntensity`
- Produces: 创建会话后调用 `createSession`

- [ ] **Step 1: 创建 CliArgsClaude.tsx**

Claude Code 专属参数表单：
- 跳过权限（`--dangerously-skip-permissions`）— Switch
- 限制工具（`--allowedTools`）— Tag 输入
- 禁用工具（`--disallowedTools`）— Tag 输入
- 最大轮数（`--max-turns`）— InputNumber
- 追加提示（`--append-system-prompt`）— TextArea
- 详细日志（`--verbose`）— Switch
- MCP 配置（`--mcp-config`）— Input + 文件选择

Props：`value: Record<string, unknown>` / `onChange: (val: Record<string, unknown>) => void`

- [ ] **Step 2: 重写 NewSessionModal.tsx**

核心变更：
1. Props 增加 `projectId: string`，项目路径锁定
2. CLI 工具选择改为 30px 行高的图标行列表（仅图标+名称），hover 显示 tooltip
3. 移除 workDir 字段（从项目获取）
4. 移除 Profile 字段（简化，后续可加回）
5. 移除高级选项（envVars/args 文本框），替换为 CLI 专属参数组件
6. 新增思考强度 Select（low/medium/high），默认继承全局设置
7. 新增会话模板 Select
8. 提交逻辑改为调用 `createSession` IPC

- [ ] **Step 3: 修改 AppLayout.tsx**

NewSessionModal 传入 projectId：
```tsx
<NewSessionModal
  open={newSessionModalOpen}
  projectId={newSessionProjectId}
  onClose={() => setNewSessionModalOpen(false)}
/>
```

- [ ] **Step 4: 提交**

```bash
git add src/components/tabs/NewSessionModal.tsx src/components/cli/CliArgsClaude.tsx src/components/layout/AppLayout.tsx
git commit -m "feat: 重写新建会话对话框，支持 CLI 专属参数"
```

---

### Task 10: 前端 — AppContent 和 TabBar 适配

**Files:**
- Modify: `src/components/layout/AppContent.tsx`
- Modify: `src/components/tabs/TabBar.tsx`

**Interfaces:**
- Consumes: `Project`/`Session` 类型，`useAppStore` 中的 `projects`/`sessions`

- [ ] **Step 1: 修改 AppContent.tsx**

- 空状态改为"选择或新建项目"引导
- 移除旧的新建会话虚线卡片，改为"新建项目"引导
- 会话卡片中 `session.workDir` 改为从 projects 查找项目名称

- [ ] **Step 2: 修改 TabBar.tsx**

- "移动到其他项目" 对话框改为从 `projects` 列表选择（Select 下拉），替代手动输入路径
- 会话属性面板中 `workDir` 改为显示项目名称
- 类型引用从 `TabState` 改为 `Session`

- [ ] **Step 3: 提交**

```bash
git add src/components/layout/AppContent.tsx src/components/tabs/TabBar.tsx
git commit -m "feat: 适配 AppContent 和 TabBar 为项目/会话模型"
```

---

### Task 11: 前端数据迁移

**Files:**
- Modify: `src/stores/appStore.ts` 或新建 `src/utils/migration.ts`

**Interfaces:**
- Consumes: localStorage `codingtea_sessions` 中的旧 `TabState[]` 数据
- Produces: 通过 IPC 创建 Project 和 Session 记录

- [ ] **Step 1: 在 AppLayout.tsx 的初始化逻辑中添加迁移检查**

在 AppLayout 的 useEffect 中，`listProfiles` 之后添加：

```typescript
// 迁移旧 localStorage 数据到后端
const oldSessionsRaw = localStorage.getItem("codingtea_sessions");
if (oldSessionsRaw) {
  try {
    const oldSessions = JSON.parse(oldSessionsRaw);
    if (Array.isArray(oldSessions) && oldSessions.length > 0) {
      const existingProjects = await projectList();
      if (existingProjects.length === 0) {
        // 按 workDir 分组创建项目
        const workDirMap = new Map<string, string[]>(); // workDir -> session ids
        for (const s of oldSessions) {
          const dir = s.workDir || "~";
          if (!workDirMap.has(dir)) workDirMap.set(dir, []);
          workDirMap.get(dir)!.push(s.id);
        }
        // 为每个 workDir 创建项目
        for (const [workDir, _] of workDirMap) {
          const name = workDir.split(/[/\\]/).pop() || workDir;
          await projectCreate({ name, path: workDir });
        }
        // 重新加载项目列表
        const projects = await projectList();
        // 为每个旧会话创建 Session
        for (const s of oldSessions) {
          const project = projects.find(p => p.path === (s.workDir || "~"));
          if (project) {
            await sessionCreate({
              projectId: project.id,
              toolType: s.toolType,
              title: s.title || undefined,
              profileId: s.profileId || undefined,
              color: s.color || undefined,
              envVars: s.envVars || undefined,
            });
          }
        }
        // 迁移完成，清除旧数据
        localStorage.removeItem("codingtea_sessions");
        localStorage.removeItem("codingtea_tabs");
      }
    }
  } catch {
    // 迁移失败不影响启动
  }
}
```

- [ ] **Step 2: 测试迁移**

1. 确保旧版 localStorage 中有会话数据
2. 启动应用，验证项目和会话自动迁移
3. 确认 localStorage 旧数据已清除

- [ ] **Step 3: 提交**

```bash
git add src/components/layout/AppLayout.tsx
git commit -m "feat: 添加前端数据迁移，从 localStorage 迁移到 SQLite"
```

---

### Task 12: 集成验证

**Files:**
- 无新文件，验证所有变更

- [ ] **Step 1: 运行后端检查**

```bash
cd /work/CodingTea/CondingTea/src/src-tauri && cargo clippy && cargo test
```

- [ ] **Step 2: 运行前端检查**

```bash
cd /work/CodingTea/CondingTea/src && pnpm tsc --noEmit
```

- [ ] **Step 3: 启动应用手动验证**

```bash
cd /work/CodingTea/CondingTea/src && pnpm tauri dev
```

验证点：
1. 侧栏显示项目列表，可展开/折叠
2. 新建项目对话框正常工作
3. 项目内新建会话对话框正常工作
4. CLI 工具选择为 30px 行高图标行
5. Claude Code 参数表单正常显示
6. 会话启动/停止正常
7. 删除项目级联删除会话
8. 数据迁移正常

- [ ] **Step 4: 修复发现的问题**

- [ ] **Step 5: 最终提交**

```bash
git add -A
git commit -m "fix: 修复集成验证中发现的问题"
```
