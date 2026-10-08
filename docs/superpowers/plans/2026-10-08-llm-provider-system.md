# LLM 供应商系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 LLM 供应商系统，从 Profile 中解耦供应商配置（base_url/api_key/模型列表），让 4 个 CLI 工具（Claude/Codex/Gemini/OpenCode）都能灵活切换 LLM，会话级独立绑定。

**Architecture:**
- 新增 `llm_providers` + `llm_provider_models` 两张表，sessions 加 `llm_provider_id` + `model_name`
- 14 个预设供应商（首次启动自动 seed）
- 启动 PTY 时按 (tool_type × provider_kind) 矩阵注入环境变量
- API Key 走 keychain；多会话天然互不干扰（PTY 级独立 env）

**Tech Stack:** Tauri 2.x、Rust（rusqlite/keyring/tokio/serde）、React 19 + TypeScript、Ant Design 6.x、Zustand

**Spec:** `docs/superpowers/specs/2026-10-08-llm-provider-system-design.md`

## Global Constraints

来自项目 CLAUDE.md，强制遵守：
- Tauri 2.x，禁止 1.x
- Ant Design 6.x，禁止 5.x
- React 19，TS 5.x
- Rust 异步用 tokio，**禁止** unwrap() 在非测试代码
- **禁止** Box<dyn Error>，用 thiserror
- **禁止** console.log 出现在生产代码
- 公共 API 必须有 `///` 文档注释
- 数据库 schema 版本化（v8），迁移脚本 `v{N}_description.sql`
- 所有表必须有 `created_at` / `updated_at` INTEGER（Unix 毫秒）
- **禁止** ALTER TABLE DROP COLUMN
- API Key 明文**禁止**进 SQLite/JSONL/日志/任何文件
- 中文 commit：`feat:` / `fix:` / `refactor:` / `docs:` / `test:`

本计划内增量约束：
- 所有代码注释、commit、错误信息使用中文
- Rust 错误返回 `Result<T, String>`，错误用中文描述
- 前端类型用 camelCase
- LLM Provider 命名遵循 `<领域>_<动作>` IPC 规范
- 不要修改现有 icons（git status 已有大量图标修改属未提交改动）

---

## 文件结构

### 新增文件

```
src-tauri/
├── migrations/
│   └── v8_llm_providers.sql
├── src/
│   ├── llm_provider/
│   │   ├── mod.rs              # CRUD + 业务逻辑
│   │   ├── preset.rs           # 14 个预设常量
│   │   └── seed.rs             # 首次启动 seed
│   └── commands/
│       └── llm_provider.rs     # IPC 命令
└── tests/
    └── llm_provider_env_test.rs # env 注入矩阵测试

src/
├── components/
│   ├── settings/
│   │   ├── LlmProvidersPage.tsx
│   │   └── components/
│   │       ├── LlmProviderCard.tsx
│   │       └── LlmProviderEditModal.tsx
│   └── cli/
│       └── CliArgsLlmList.tsx  # CLI 设置页的 LLM 列表选择组件
└── __tests__/
    └── llmProviderStore.test.ts # 前端 store 测试
```

### 修改文件

```
src-tauri/src/
├── lib.rs                       # 注册新 IPC + 调用 seed
├── storage/mod.rs               # 注册 v8 迁移
├── commands/pty.rs              # 修改 start_session 注入 LLM env

src/
├── types/index.ts               # 增 LlmProvider 类型
├── utils/ipc.ts                 # 增 LLM IPC 封装
├── stores/appStore.ts           # 增 llmProviders 状态
├── components/
│   ├── settings/
│   │   ├── ClaudeSettingsPage.tsx  # 移除默认模型三选一 → LLM 列表
│   │   ├── CodexSettingsPage.tsx   # 同上
│   │   ├── GeminiSettingsPage.tsx  # 同上
│   │   └── OpenCodeSettingsPage.tsx # 同上
│   ├── session/
│   │   └── NewSessionModal.tsx     # 加 LLM Provider + Model 下拉
│   └── tabs/
│       └── TabBar.tsx              # 会话 Tab 显示 LLM 图标
```

---

## Phase 1: Rust 后端

### Task 1: v8 数据库迁移

**Files:**
- Create: `src-tauri/migrations/v8_llm_providers.sql`

**Interfaces:**
- Produces: `llm_providers` / `llm_provider_models` 两张表 + sessions 两列

- [ ] **Step 1: 写入迁移文件**

```sql
-- src-tauri/migrations/v8_llm_providers.sql
-- Schema v8: 引入 LLM 供应商系统

CREATE TABLE llm_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider_kind TEXT NOT NULL,
    base_url TEXT,
    icon TEXT,
    color TEXT,
    is_preset INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE llm_provider_models (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (provider_id) REFERENCES llm_providers(id) ON DELETE CASCADE
);

CREATE INDEX idx_llm_provider_models_provider
    ON llm_provider_models(provider_id, sort_order);

ALTER TABLE sessions ADD COLUMN llm_provider_id TEXT;
ALTER TABLE sessions ADD COLUMN model_name TEXT;

INSERT INTO schema_version (version, applied_at) VALUES (8, strftime('%s','now') * 1000);
```

- [ ] **Step 2: 检查现有 storage 模块加载迁移的代码**

读 `src-tauri/src/storage/mod.rs`，确认迁移加载逻辑（应按文件名升序读取 `migrations/` 目录并执行）。如有遗漏补全。

- [ ] **Step 3: 验证迁移在空库上可执行**

```bash
cd src-tauri
cargo test --test migrations_smoke -- --nocapture
```

若无此测试，跳过此步（手动验证见 Step 4）。

- [ ] **Step 4: 手动冒烟验证**

```bash
cd src-tauri
cargo build
# 启动应用一次，确保新表被创建且不破坏现有数据
pnpm tauri dev  # 在测试数据库上启动一次后退出
sqlite3 ~/.local/share/tea-coder/tea-coder.db ".tables"
```

期望看到 `llm_providers` / `llm_provider_models` 在列表中。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/migrations/v8_llm_providers.sql src-tauri/src/storage/mod.rs
git commit -m "feat(db): 新增 v8 LLM 供应商数据迁移"
```

---

### Task 2: 预设供应商常量

**Files:**
- Create: `src-tauri/src/llm_provider/preset.rs`

**Interfaces:**
- Produces: `pub const PRESET_PROVIDERS: &[PresetProvider]` 共 14 项
- 每项含 `name / provider_kind / base_url / icon / color / models`

- [ ] **Step 1: 写预设数据结构**

```rust
// src-tauri/src/llm_provider/preset.rs

/// 预设供应商模板（程序内置，首次启动时 seed）
#[derive(Debug, Clone)]
pub struct PresetProvider {
    pub name: &'static str,
    pub provider_kind: &'static str,
    pub base_url: &'static str,
    pub icon: &'static str,
    pub color: &'static str,
    pub models: &'static [&'static str],
}

pub const PRESET_PROVIDERS: &[PresetProvider] = &[
    PresetProvider {
        name: "Anthropic",
        provider_kind: "anthropic",
        base_url: "https://api.anthropic.com",
        icon: "anthropic",
        color: "#D97757",
        models: &[
            "claude-opus-4-20250514",
            "claude-sonnet-4-20250514",
            "claude-haiku-4-20250514",
        ],
    },
    PresetProvider {
        name: "OpenAI",
        provider_kind: "openai",
        base_url: "https://api.openai.com/v1",
        icon: "openai",
        color: "#10A37F",
        models: &["gpt-4o", "gpt-4-turbo", "o1", "o1-mini"],
    },
    PresetProvider {
        name: "Google AI Studio",
        provider_kind: "google",
        base_url: "https://generativelanguage.googleapis.com/v1beta",
        icon: "google",
        color: "#4285F4",
        models: &["gemini-2.0-pro-exp", "gemini-2.0-flash-exp"],
    },
    PresetProvider {
        name: "DeepSeek",
        provider_kind: "openai",
        base_url: "https://api.deepseek.com/v1",
        icon: "deepseek",
        color: "#1E88E5",
        models: &["deepseek-chat", "deepseek-reasoner"],
    },
    PresetProvider {
        name: "GLM 智谱",
        provider_kind: "openai",
        base_url: "https://open.bigmodel.cn/api/paas/v4",
        icon: "zhipu",
        color: "#3F51B5",
        models: &["glm-4-plus", "glm-4-air", "glm-4-flash"],
    },
    PresetProvider {
        name: "Kimi 月之暗面",
        provider_kind: "openai",
        base_url: "https://api.moonshot.cn/v1",
        icon: "moonshot",
        color: "#1A1A1A",
        models: &["moonshot-v1-128k", "moonshot-v1-32k"],
    },
    PresetProvider {
        name: "Qwen 通义千问",
        provider_kind: "openai",
        base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        icon: "alibaba",
        color: "#FF6A00",
        models: &["qwen-max", "qwen-plus", "qwen-turbo"],
    },
    PresetProvider {
        name: "SiliconFlow 硅基流动",
        provider_kind: "openai",
        base_url: "https://api.siliconflow.cn/v1",
        icon: "siliconflow",
        color: "#7B61FF",
        models: &[
            "Qwen/Qwen2.5-72B-Instruct",
            "deepseek-ai/DeepSeek-V3",
        ],
    },
    PresetProvider {
        name: "豆包 Doubao",
        provider_kind: "openai",
        base_url: "https://ark.cn-beijing.volces.com/api/v3",
        icon: "doubao",
        color: "#0066FF",
        models: &["doubao-pro-32k", "doubao-lite-32k"],
    },
    PresetProvider {
        name: "Hunyuan 混元",
        provider_kind: "openai",
        base_url: "https://api.hunyuan.cloud.tencent.com/v1",
        icon: "tencent",
        color: "#0052D9",
        models: &["hunyuan-pro", "hunyuan-standard"],
    },
    PresetProvider {
        name: "零一万物 Yi",
        provider_kind: "openai",
        base_url: "https://api.lingyiwanwu.com/v1",
        icon: "yi",
        color: "#FF4D4F",
        models: &["yi-large", "yi-medium"],
    },
    PresetProvider {
        name: "百川 Baichuan",
        provider_kind: "openai",
        base_url: "https://api.baichuan-ai.com/v1",
        icon: "baichuan",
        color: "#2D8CF0",
        models: &["Baichuan4", "Baichuan3-Turbo"],
    },
    PresetProvider {
        name: "MiniMax",
        provider_kind: "anthropic",
        base_url: "https://api.MiniMax.chat/anthropic",
        icon: "MiniMax",
        color: "#FF6B6B",
        models: &["MiniMax-Text-01", "MiniMax-Text-01-250415"],
    },
    PresetProvider {
        name: "OpenRouter",
        provider_kind: "openai",
        base_url: "https://openrouter.ai/api/v1",
        icon: "openrouter",
        color: "#5E5EE6",
        models: &["anthropic/claude-sonnet-4", "openai/gpt-4o"],
    },
];
```

- [ ] **Step 2: 写单元测试**

在文件末尾追加：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_preset_count_is_14() {
        assert_eq!(PRESET_PROVIDERS.len(), 14);
    }

    #[test]
    fn test_preset_kinds_are_valid() {
        let valid_kinds = ["anthropic", "openai", "google", "custom"];
        for p in PRESET_PROVIDERS {
            assert!(
                valid_kinds.contains(&p.provider_kind),
                "预设 {} 的 provider_kind={} 不合法",
                p.name,
                p.provider_kind
            );
        }
    }

    #[test]
    fn test_preset_base_urls_look_like_urls() {
        for p in PRESET_PROVIDERS {
            assert!(
                p.base_url.starts_with("http://") || p.base_url.starts_with("https://"),
                "预设 {} 的 base_url={} 不是合法 URL",
                p.name,
                p.base_url
            );
        }
    }

    #[test]
    fn test_preset_models_non_empty() {
        for p in PRESET_PROVIDERS {
            assert!(
                !p.models.is_empty(),
                "预设 {} 必须至少有一个默认模型",
                p.name
            );
        }
    }
}
```

- [ ] **Step 3: 创建 llm_provider 模块骨架**

```rust
// src-tauri/src/llm_provider/mod.rs
pub mod preset;
pub mod seed;
```

- [ ] **Step 4: 跑测试验证通过**

```bash
cd src-tauri
cargo test llm_provider::preset --lib
```

期望：`4 passed`

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/llm_provider/
git commit -m "feat(llm_provider): 新增 14 个预设供应商模板常量"
```

---

### Task 3: Seed 逻辑

**Files:**
- Create: `src-tauri/src/llm_provider/seed.rs`

**Interfaces:**
- Produces: `pub fn seed_preset_providers(db: &AppDatabase) -> Result<usize, String>`
  - 返回插入的 provider 数量
  - 仅当 `llm_providers` 表为空时执行（幂等）

- [ ] **Step 1: 写失败的测试**

```rust
// src-tauri/src/llm_provider/seed.rs
use rusqlite::Connection;

#[cfg(test)]
mod tests {
    use super::*;

    fn make_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../migrations/v1_initial.sql")).unwrap();
        conn.execute_batch(include_str!("../../migrations/v2_tool_settings.sql")).unwrap();
        conn.execute_batch(include_str!("../../migrations/v3_projects.sql")).unwrap();
        conn.execute_batch(include_str!("../../migrations/v4_cli_session_id.sql")).unwrap();
        conn.execute_batch(include_str!("../../migrations/v5_session_categories.sql")).unwrap();
        conn.execute_batch(include_str!("../../migrations/v6_session_messages.sql")).unwrap();
        conn.execute_batch(include_str!("../../migrations/v7_app_settings.sql")).unwrap();
        conn.execute_batch(include_str!("../../migrations/v8_llm_providers.sql")).unwrap();
        conn
    }

    #[test]
    fn test_seed_inserts_14_providers_when_empty() {
        // 还未实现 seed_preset_providers 函数
        let conn = make_db();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM llm_providers", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0, "迁移后表应为空");
    }
}
```

- [ ] **Step 2: 跑测试验证失败**

```bash
cd src-tauri
cargo test llm_provider::seed --lib
```

期望：编译失败（`seed_preset_providers` 未定义）

- [ ] **Step 3: 实现 seed 函数**

```rust
// src-tauri/src/llm_provider/seed.rs
use rusqlite::Connection;

use crate::storage::AppDatabase;

use super::preset::PRESET_PROVIDERS;

/// 首次启动时 seed 预设供应商。表非空时跳过（幂等）。
/// 返回新增的 provider 数量。
pub fn seed_preset_providers(db: &AppDatabase) -> Result<usize, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let existing: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM llm_providers WHERE is_preset = 1",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("查询 llm_providers 失败: {}", e))?;

    if existing > 0 {
        return Ok(0);
    }

    let now = chrono::Utc::now().timestamp_millis();
    let mut count = 0;

    for preset in PRESET_PROVIDERS {
        let provider_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO llm_providers (id, name, provider_kind, base_url, icon, color, is_preset, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 1, ?7, ?7)",
            rusqlite::params![
                provider_id,
                preset.name,
                preset.provider_kind,
                preset.base_url,
                preset.icon,
                preset.color,
                now,
            ],
        )
        .map_err(|e| format!("插入预设供应商 {} 失败: {}", preset.name, e))?;

        for (idx, model_name) in preset.models.iter().enumerate() {
            let model_id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO llm_provider_models (id, provider_id, model_name, is_default, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    model_id,
                    provider_id,
                    model_name,
                    if idx == 0 { 1 } else { 0 },
                    idx as i64,
                    now,
                ],
            )
            .map_err(|e| format!("插入模型 {} 失败: {}", model_name, e))?;
        }
        count += 1;
    }

    Ok(count)
}
```

注意：上面测试中的 `make_db` 函数使用 `Connection`，但 `seed_preset_providers` 接收 `&AppDatabase`。需要重构为：

```rust
// src-tauri/src/llm_provider/seed.rs
use rusqlite::Connection;
use std::sync::{Arc, Mutex};

use crate::storage::AppDatabase;

use super::preset::PRESET_PROVIDERS;

pub fn seed_preset_providers(db: &AppDatabase) -> Result<usize, String> {
    // ... 与上面相同 ...
}

// 测试需要的辅助
#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::AppDatabase;

    fn make_db() -> AppDatabase {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../migrations/v1_initial.sql")).unwrap();
        conn.execute_batch(include_str!("../../migrations/v2_tool_settings.sql")).unwrap();
        conn.execute_batch(include_str!("../../migrations/v3_projects.sql")).unwrap();
        conn.execute_batch(include_str!("../../migrations/v4_cli_session_id.sql")).unwrap();
        conn.execute_batch(include_str!("../../migrations/v5_session_categories.sql")).unwrap();
        conn.execute_batch(include_str!("../../migrations/v6_session_messages.sql")).unwrap();
        conn.execute_batch(include_str!("../../migrations/v7_app_settings.sql")).unwrap();
        conn.execute_batch(include_str!("../../migrations/v8_llm_providers.sql")).unwrap();
        AppDatabase { conn: Arc::new(Mutex::new(conn)) }
    }

    #[test]
    fn test_seed_inserts_14_providers() {
        let db = make_db();
        let count = seed_preset_providers(&db).unwrap();
        assert_eq!(count, 14);

        let conn = db.conn.lock().unwrap();
        let model_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM llm_provider_models", [], |r| r.get(0))
            .unwrap();
        assert!(model_count > 14, "应至少有 14 个模型");
    }

    #[test]
    fn test_seed_is_idempotent() {
        let db = make_db();
        assert_eq!(seed_preset_providers(&db).unwrap(), 14);
        assert_eq!(seed_preset_providers(&db).unwrap(), 0, "二次调用应返回 0");
    }

    #[test]
    fn test_first_model_marked_default() {
        let db = make_db();
        seed_preset_providers(&db).unwrap();
        let conn = db.conn.lock().unwrap();
        let default_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM llm_provider_models WHERE is_default = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(default_count, 14, "每个 provider 应有且仅有一个默认模型");
    }
}
```

需要确认 `AppDatabase` 结构体的字段名，参考 `src-tauri/src/storage/mod.rs`。

- [ ] **Step 4: 跑测试验证通过**

```bash
cd src-tauri
cargo test llm_provider::seed --lib
```

期望：`3 passed`

- [ ] **Step 5: 在 lib.rs 中调用 seed**

读 `src-tauri/src/lib.rs`，找到应用启动时初始化数据库的位置，添加：

```rust
use crate::llm_provider;

// 在数据库初始化之后
match llm_provider::seed::seed_preset_providers(&db) {
    Ok(n) if n > 0 => log::info!("已 seed {} 个预设 LLM 供应商", n),
    Ok(_) => log::debug!("LLM 供应商已存在，跳过 seed"),
    Err(e) => log::error!("seed LLM 供应商失败: {}", e),
}
```

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/llm_provider/seed.rs src-tauri/src/lib.rs
git commit -m "feat(llm_provider): 实现预设供应商 seed 逻辑"
```

---

### Task 4: LLM Provider CRUD 模块

**Files:**
- Create: `src-tauri/src/llm_provider/mod.rs`（已有骨架，扩展 CRUD）

**Interfaces:**
- Produces:
  ```rust
  pub struct LlmProvider { id, name, provider_kind, base_url, icon, color, is_preset, is_active, created_at, updated_at, models: Vec<LlmProviderModel> }
  pub struct LlmProviderModel { id, provider_id, model_name, is_default, sort_order, created_at }
  pub struct CreateLlmProviderInput { name, provider_kind, base_url, icon, color, models: Vec<String>, default_model: Option<String>, api_key: Option<String> }
  pub struct UpdateLlmProviderInput { 同上字段全 Optional }
  pub fn list_providers(db, include_inactive) -> Result<Vec<LlmProvider>, String>
  pub fn get_provider(db, id) -> Result<Option<LlmProvider>, String>
  pub fn create_provider(db, input) -> Result<LlmProvider, String>
  pub fn update_provider(db, id, input) -> Result<LlmProvider, String>
  pub fn delete_provider(db, id) -> Result<(), String>  // 软删除
  pub fn hard_delete_provider(db, id) -> Result<(), String>  // 仅 is_preset=0 且无会话引用
  pub fn set_default_model(db, provider_id, model_id) -> Result<(), String>
  pub fn provider_to_safe_string(p: &LlmProvider) -> String  // 调试用，不含 api_key
  ```

参考 `src-tauri/src/tool_settings/mod.rs` 的模式（Row 解析、Upsert 模式、错误处理）。

- [ ] **Step 1: 写失败测试 - 数据结构和 list**

```rust
// 在 src-tauri/src/llm_provider/mod.rs 末尾追加
#[cfg(test)]
mod tests {
    use super::*;
    // 复用 Task 3 的 make_db

    #[test]
    fn test_list_providers_excludes_inactive_by_default() {
        let db = make_db();
        seed_preset_providers(&db).unwrap();
        let providers = list_providers(&db, false).unwrap();
        assert_eq!(providers.len(), 14);
        assert!(providers.iter().all(|p| p.is_active));
    }

    #[test]
    fn test_get_provider_returns_none_for_missing() {
        let db = make_db();
        let result = get_provider(&db, "non-existent-id").unwrap();
        assert!(result.is_none());
    }
}
```

- [ ] **Step 2: 跑测试验证失败**

```bash
cargo test llm_provider::tests --lib
```

期望：编译失败（list_providers/get_provider 未定义）

- [ ] **Step 3: 实现数据结构与基础查询**

```rust
// src-tauri/src/llm_provider/mod.rs
use serde::{Deserialize, Serialize};
use rusqlite::Connection;

use crate::storage::AppDatabase;

pub mod preset;
pub mod seed;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProvider {
    pub id: String,
    pub name: String,
    pub provider_kind: String,
    pub base_url: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub is_preset: bool,
    pub is_active: bool,
    pub created_at: i64,
    pub updated_at: i64,
    /// 模型列表（按 sort_order 排序）
    pub models: Vec<LlmProviderModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderModel {
    pub id: String,
    pub provider_id: String,
    pub model_name: String,
    pub is_default: bool,
    pub sort_order: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateLlmProviderInput {
    pub name: String,
    pub provider_kind: String,
    pub base_url: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub models: Vec<String>,
    pub default_model: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLlmProviderInput {
    pub name: Option<String>,
    pub provider_kind: Option<String>,
    pub base_url: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub models: Option<Vec<String>>,
    pub default_model: Option<String>,
    pub is_active: Option<bool>,
    pub api_key: Option<String>,
}

fn row_to_model(row: &rusqlite::Row) -> Result<LlmProviderModel, rusqlite::Error> {
    let is_default: i64 = row.get(3)?;
    Ok(LlmProviderModel {
        id: row.get(0)?,
        provider_id: row.get(1)?,
        model_name: row.get(2)?,
        is_default: is_default != 0,
        sort_order: row.get(4)?,
        created_at: row.get(5)?,
    })
}

fn load_models_for(
    conn: &Connection,
    provider_id: &str,
) -> Result<Vec<LlmProviderModel>, String> {
    let mut stmt = conn
        .prepare("SELECT id, provider_id, model_name, is_default, sort_order, created_at FROM llm_provider_models WHERE provider_id = ?1 ORDER BY sort_order ASC")
        .map_err(|e| format!("准备查询模型失败: {}", e))?;
    let rows = stmt
        .query_map([provider_id], row_to_model)
        .map_err(|e| format!("查询模型失败: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("收集模型失败: {}", e))
}

pub fn list_providers(
    db: &AppDatabase,
    include_inactive: bool,
) -> Result<Vec<LlmProvider>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let sql = if include_inactive {
        "SELECT id, name, provider_kind, base_url, icon, color, is_preset, is_active, created_at, updated_at FROM llm_providers ORDER BY is_preset DESC, name ASC"
    } else {
        "SELECT id, name, provider_kind, base_url, icon, color, is_preset, is_active, created_at, updated_at FROM llm_providers WHERE is_active = 1 ORDER BY is_preset DESC, name ASC"
    };

    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("准备查询供应商失败: {}", e))?;

    let providers: Vec<LlmProvider> = stmt
        .query_map([], |row| {
            Ok(LlmProvider {
                id: row.get(0)?,
                name: row.get(1)?,
                provider_kind: row.get(2)?,
                base_url: row.get(3)?,
                icon: row.get(4)?,
                color: row.get(5)?,
                is_preset: row.get::<_, i64>(6)? != 0,
                is_active: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                models: vec![],
            })
        })
        .map_err(|e| format!("查询供应商失败: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("收集供应商失败: {}", e))?;

    // 二次加载 models（避免 N+1 改用 LEFT JOIN；此处数据量小先保持简洁）
    let mut result = Vec::with_capacity(providers.len());
    for mut p in providers {
        p.models = load_models_for(&conn, &p.id)?;
        result.push(p);
    }
    Ok(result)
}

pub fn get_provider(
    db: &AppDatabase,
    id: &str,
) -> Result<Option<LlmProvider>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, name, provider_kind, base_url, icon, color, is_preset, is_active, created_at, updated_at FROM llm_providers WHERE id = ?1")
        .map_err(|e| format!("准备查询供应商失败: {}", e))?;

    let provider = stmt
        .query_row([id], |row| {
            Ok(LlmProvider {
                id: row.get(0)?,
                name: row.get(1)?,
                provider_kind: row.get(2)?,
                base_url: row.get(3)?,
                icon: row.get(4)?,
                color: row.get(5)?,
                is_preset: row.get::<_, i64>(6)? != 0,
                is_active: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                models: vec![],
            })
        })
        .ok();

    match provider {
        Some(mut p) => {
            p.models = load_models_for(&conn, &p.id)?;
            Ok(Some(p))
        }
        None => Ok(None),
    }
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
cd src-tauri
cargo test llm_provider::tests --lib
```

期望：`2 passed`

- [ ] **Step 5: 写 create/update/delete 测试**

在 tests 模块追加：

```rust
#[test]
fn test_create_provider_persists_models() {
    let db = make_db();
    let input = CreateLlmProviderInput {
        name: "Test Provider".into(),
        provider_kind: "openai".into(),
        base_url: Some("https://test.example.com/v1".into()),
        icon: Some("test".into()),
        color: Some("#FF0000".into()),
        models: vec!["model-a".into(), "model-b".into()],
        default_model: Some("model-a".into()),
        api_key: None,
    };
    let created = create_provider(&db, input).unwrap();
    assert_eq!(created.models.len(), 2);
    assert!(created.models.iter().find(|m| m.model_name == "model-a").unwrap().is_default);
}

#[test]
fn test_update_provider_replaces_models() {
    let db = make_db();
    let input = CreateLlmProviderInput {
        name: "P".into(),
        provider_kind: "anthropic".into(),
        base_url: None, icon: None, color: None,
        models: vec!["old-1".into()],
        default_model: None,
        api_key: None,
    };
    let created = create_provider(&db, input).unwrap();
    let update = UpdateLlmProviderInput {
        models: Some(vec!["new-1".into(), "new-2".into()]),
        default_model: Some("new-2".into()),
        ..Default::default()
    };
    let updated = update_provider(&db, &created.id, update).unwrap();
    assert_eq!(updated.models.len(), 2);
    let names: Vec<_> = updated.models.iter().map(|m| m.model_name.as_str()).collect();
    assert!(names.contains(&"new-1") && names.contains(&"new-2"));
    assert!(updated.models.iter().find(|m| m.model_name == "new-2").unwrap().is_default);
}

#[test]
fn test_delete_provider_soft_deletes() {
    let db = make_db();
    let input = CreateLlmProviderInput {
        name: "P".into(), provider_kind: "openai".into(),
        base_url: None, icon: None, color: None,
        models: vec!["m".into()], default_model: None, api_key: None,
    };
    let created = create_provider(&db, input).unwrap();
    delete_provider(&db, &created.id).unwrap();
    let listed = list_providers(&db, false).unwrap();
    assert!(!listed.iter().any(|p| p.id == created.id));
    let listed_inactive = list_providers(&db, true).unwrap();
    let deleted = listed_inactive.iter().find(|p| p.id == created.id).unwrap();
    assert!(!deleted.is_active);
}
```

- [ ] **Step 6: 跑测试验证失败**

```bash
cargo test llm_provider::tests --lib
```

期望：编译失败（create_provider/update_provider/delete_provider 未定义）

- [ ] **Step 7: 实现 create/update/delete**

```rust
pub fn create_provider(
    db: &AppDatabase,
    input: CreateLlmProviderInput,
) -> Result<LlmProvider, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT INTO llm_providers (id, name, provider_kind, base_url, icon, color, is_preset, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 1, ?7, ?7)",
        rusqlite::params![
            id,
            input.name,
            input.provider_kind,
            input.base_url,
            input.icon,
            input.color,
            now,
        ],
    )
    .map_err(|e| format!("插入供应商失败: {}", e))?;

    // 插入模型列表
    for (idx, model_name) in input.models.iter().enumerate() {
        let model_id = uuid::Uuid::new_v4().to_string();
        let is_default = match &input.default_model {
            Some(d) => d == model_name,
            None => idx == 0,
        };
        conn.execute(
            "INSERT INTO llm_provider_models (id, provider_id, model_name, is_default, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![model_id, id, model_name, is_default as i64, idx as i64, now],
        )
        .map_err(|e| format!("插入模型 {} 失败: {}", model_name, e))?;
    }

    // API Key 存 keychain（若提供）
    if let Some(ref key) = input.api_key {
        if !key.is_empty() {
            crate::crypto::keychain::store_secret(&id, "api_key", key)
                .map_err(|e| format!("存储 API Key 到 keychain 失败: {}", e))?;
        }
    }

    // 返回完整对象
    drop(conn);
    get_provider(db, &id)?.ok_or_else(|| "新建的供应商查询不到".to_string())
}

pub fn update_provider(
    db: &AppDatabase,
    id: &str,
    input: UpdateLlmProviderInput,
) -> Result<LlmProvider, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();

    // 动态构建 UPDATE
    let mut sets = vec!["updated_at = ?1".to_string()];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    let field_map: &[(&str, &str)] = &[
        ("name", "name"),
        ("providerKind", "provider_kind"),
        ("baseUrl", "base_url"),
        ("icon", "icon"),
        ("color", "color"),
    ];

    // ... (与 profile::update_profile 相同模式，省略重复代码)

    if let Some(name) = &input.name {
        sets.push("name = ?".into());
        params.push(Box::new(name.clone()));
    }
    if let Some(pk) = &input.provider_kind {
        sets.push("provider_kind = ?".into());
        params.push(Box::new(pk.clone()));
    }
    if let Some(url) = &input.base_url {
        sets.push("base_url = ?".into());
        params.push(Box::new(url.clone()));
    }
    if let Some(icon) = &input.icon {
        sets.push("icon = ?".into());
        params.push(Box::new(icon.clone()));
    }
    if let Some(color) = &input.color {
        sets.push("color = ?".into());
        params.push(Box::new(color.clone()));
    }
    if let Some(active) = input.is_active {
        sets.push("is_active = ?".into());
        params.push(Box::new(active as i64));
    }

    let sql = format!("UPDATE llm_providers SET {} WHERE id = ?", sets.join(", "));
    let mut all_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();
    all_refs.push(&id);
    conn.execute(&sql, all_refs.as_slice())
        .map_err(|e| format!("更新供应商失败: {}", e))?;

    // 若提供 models，全量替换
    if let Some(models) = &input.models {
        conn.execute("DELETE FROM llm_provider_models WHERE provider_id = ?1", [id])
            .map_err(|e| format!("清除旧模型失败: {}", e))?;
        for (idx, model_name) in models.iter().enumerate() {
            let model_id = uuid::Uuid::new_v4().to_string();
            let is_default = match &input.default_model {
                Some(d) => d == model_name,
                None => idx == 0,
            };
            conn.execute(
                "INSERT INTO llm_provider_models (id, provider_id, model_name, is_default, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![model_id, id, model_name, is_default as i64, idx as i64, now],
            )
            .map_err(|e| format!("插入新模型失败: {}", e))?;
        }
    }

    // API Key 存 keychain（若提供）
    if let Some(key) = &input.api_key {
        if !key.is_empty() {
            crate::crypto::keychain::store_secret(id, "api_key", key)
                .map_err(|e| format!("存储 API Key 到 keychain 失败: {}", e))?;
        }
    }

    drop(conn);
    get_provider(db, id)?.ok_or_else(|| "更新的供应商查询不到".to_string())
}

pub fn delete_provider(db: &AppDatabase, id: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();
    let updated = conn.execute(
        "UPDATE llm_providers SET is_active = 0, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, id],
    )
    .map_err(|e| format!("软删除供应商失败: {}", e))?;
    if updated == 0 {
        return Err(format!("供应商 {} 不存在", id));
    }
    Ok(())
}

pub fn hard_delete_provider(db: &AppDatabase, id: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // 检查是否预设
    let is_preset: i64 = conn
        .query_row("SELECT is_preset FROM llm_providers WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|e| format!("查询供应商失败: {}", e))?;
    if is_preset != 0 {
        return Err("预设供应商不可硬删除".to_string());
    }

    // 检查是否被会话引用
    let refs: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE llm_provider_id = ?1",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| format!("查询会话引用失败: {}", e))?;
    if refs > 0 {
        return Err(format!("供应商被 {} 个会话引用，无法硬删除", refs));
    }

    conn.execute("DELETE FROM llm_providers WHERE id = ?1", [id])
        .map_err(|e| format!("硬删除供应商失败: {}", e))?;

    // 清理 keychain
    let _ = crate::crypto::keychain::delete_secret(id, "api_key");

    Ok(())
}

pub fn set_default_model(
    db: &AppDatabase,
    provider_id: &str,
    model_id: &str,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // 验证 model 属于该 provider
    let belongs: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM llm_provider_models WHERE id = ?1 AND provider_id = ?2)",
            rusqlite::params![model_id, provider_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("验证模型归属失败: {}", e))?;
    if !belongs {
        return Err("模型不属于该供应商".to_string());
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("开启事务失败: {}", e))?;
    tx.execute(
        "UPDATE llm_provider_models SET is_default = 0 WHERE provider_id = ?1",
        [provider_id],
    )
    .map_err(|e| format!("取消旧默认模型失败: {}", e))?;
    tx.execute(
        "UPDATE llm_provider_models SET is_default = 1 WHERE id = ?1",
        [model_id],
    )
    .map_err(|e| format!("设置新默认模型失败: {}", e))?;
    tx.commit().map_err(|e| format!("提交事务失败: {}", e))?;

    Ok(())
}
```

- [ ] **Step 8: 跑全部测试验证通过**

```bash
cd src-tauri
cargo test llm_provider::tests --lib
```

期望：`5 passed`

- [ ] **Step 9: 验证 cargo clippy 无 warning**

```bash
cd src-tauri
cargo clippy --all-targets -- -D warnings
```

期望：无任何 warning

- [ ] **Step 10: 提交**

```bash
git add src-tauri/src/llm_provider/mod.rs
git commit -m "feat(llm_provider): 实现 LLM Provider CRUD 与软删除"
```

---

### Task 5: LLM Provider IPC 命令

**Files:**
- Create: `src-tauri/src/commands/llm_provider.rs`
- Modify: `src-tauri/src/lib.rs`（注册命令）

**Interfaces:**
- Produces: 8 个 `#[tauri::command]` 函数，命名见 spec

- [ ] **Step 1: 写命令包装**

```rust
// src-tauri/src/commands/llm_provider.rs
use tauri::State;

use crate::llm_provider::{
    self, CreateLlmProviderInput, LlmProvider, UpdateLlmProviderInput,
};
use crate::storage::AppDatabase;

#[tauri::command]
pub fn llm_provider_list(
    db: State<AppDatabase>,
    include_inactive: Option<bool>,
) -> Result<Vec<LlmProvider>, String> {
    llm_provider::list_providers(&db, include_inactive.unwrap_or(false))
}

#[tauri::command]
pub fn llm_provider_get(
    db: State<AppDatabase>,
    id: String,
) -> Result<Option<LlmProvider>, String> {
    llm_provider::get_provider(&db, &id)
}

#[tauri::command]
pub fn llm_provider_create(
    db: State<AppDatabase>,
    input: CreateLlmProviderInput,
) -> Result<LlmProvider, String> {
    llm_provider::create_provider(&db, input)
}

#[tauri::command]
pub fn llm_provider_update(
    db: State<AppDatabase>,
    id: String,
    input: UpdateLlmProviderInput,
) -> Result<LlmProvider, String> {
    llm_provider::update_provider(&db, &id, input)
}

#[tauri::command]
pub fn llm_provider_delete(db: State<AppDatabase>, id: String) -> Result<(), String> {
    llm_provider::delete_provider(&db, &id)
}

#[tauri::command]
pub fn llm_provider_hard_delete(
    db: State<AppDatabase>,
    id: String,
) -> Result<(), String> {
    llm_provider::hard_delete_provider(&db, &id)
}

#[tauri::command]
pub fn llm_provider_set_default_model(
    db: State<AppDatabase>,
    provider_id: String,
    model_id: String,
) -> Result<(), String> {
    llm_provider::set_default_model(&db, &provider_id, &model_id)
}

#[tauri::command]
pub fn llm_provider_list_presets() -> Result<Vec<llm_provider::preset::PresetProviderView>, String> {
    Ok(llm_provider::preset::PRESET_PROVIDERS
        .iter()
        .map(|p| llm_provider::preset::PresetProviderView {
            name: p.name.to_string(),
            provider_kind: p.provider_kind.to_string(),
            base_url: p.base_url.to_string(),
            icon: p.icon.to_string(),
            color: p.color.to_string(),
            models: p.models.iter().map(|s| s.to_string()).collect(),
        })
        .collect())
}
```

需要在 `preset.rs` 加一个 `PresetProviderView`：

```rust
// 在 preset.rs 末尾（mod tests 之前）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetProviderView {
    pub name: String,
    pub provider_kind: String,
    pub base_url: String,
    pub icon: String,
    pub color: String,
    pub models: Vec<String>,
}
```

- [ ] **Step 2: 注册 IPC 命令**

读 `src-tauri/src/lib.rs`，找到 `invoke_handler` 列表（`tauri::generate_handler![...]`），添加：

```rust
mod commands;
use commands::llm_provider;

.invoke_handler(tauri::generate_handler![
    // ... 现有命令 ...
    llm_provider::llm_provider_list,
    llm_provider::llm_provider_get,
    llm_provider::llm_provider_create,
    llm_provider::llm_provider_update,
    llm_provider::llm_provider_delete,
    llm_provider::llm_provider_hard_delete,
    llm_provider::llm_provider_set_default_model,
    llm_provider::llm_provider_list_presets,
])
```

- [ ] **Step 3: cargo build 验证**

```bash
cd src-tauri
cargo build
```

期望：编译成功

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/commands/llm_provider.rs src-tauri/src/llm_provider/preset.rs src-tauri/src/lib.rs
git commit -m "feat(llm_provider): 新增 8 个 LLM Provider IPC 命令"
```

---

### Task 6: 修改 start_session 注入 LLM 环境变量

**Files:**
- Modify: `src-tauri/src/commands/pty.rs:10-110`（start_session 函数签名与实现）

**Interfaces:**
- 修改 start_session 签名加 `llm_provider_id: Option<String>, model_name: Option<String>`
- env 注入顺序：Profile → LLM Provider → user_env_vars（后者覆盖前者）
- 按 (tool_type, provider_kind) 矩阵注入环境变量

- [ ] **Step 1: 读现有 start_session 实现**

确认 `commands/pty.rs` 第 10-110 行的代码，识别需要修改的位置。

- [ ] **Step 2: 写失败测试 - env 注入映射**

创建 `src-tauri/tests/llm_provider_env_test.rs`：

```rust
// src-tauri/tests/llm_provider_env_test.rs
use std::collections::HashMap;

#[derive(Debug, PartialEq)]
struct EnvInjection {
    api_key_var: Option<(&'static str, &'static str)>,
    base_url_var: Option<(&'static str, &'static str)>,
    model_args: Vec<&'static str>,
}

fn compute_injection(
    tool_type: &str,
    provider_kind: &str,
    api_key: Option<&str>,
    base_url: Option<&str>,
    model: Option<&str>,
) -> EnvInjection {
    // 此函数从 commands/pty.rs 中提取出来便于测试
    todo!("实现后此函数返回正确的映射")
}

#[test]
fn test_claude_anthropic_env() {
    let inj = compute_injection(
        "claude", "anthropic",
        Some("sk-test"), Some("https://api.anthropic.com"),
        Some("claude-sonnet-4"),
    );
    assert_eq!(inj.api_key_var, Some(("ANTHROPIC_API_KEY", "sk-test")));
    assert_eq!(inj.base_url_var, Some(("ANTHROPIC_BASE_URL", "https://api.anthropic.com")));
    assert_eq!(inj.model_args, vec!["--model", "claude-sonnet-4"]);
}

#[test]
fn test_codex_openai_env() {
    let inj = compute_injection(
        "codex", "openai",
        Some("sk-x"), Some("https://api.openai.com/v1"),
        Some("gpt-4o"),
    );
    assert_eq!(inj.api_key_var, Some(("OPENAI_API_KEY", "sk-x")));
    assert_eq!(inj.base_url_var, Some(("OPENAI_BASE_URL", "https://api.openai.com/v1")));
    assert_eq!(inj.model_args, vec!["--model", "gpt-4o"]);
}

#[test]
fn test_gemini_google_env() {
    let inj = compute_injection(
        "gemini", "google",
        Some("gkey"), Some("https://generativelanguage.googleapis.com/v1beta"),
        Some("gemini-2.0-pro"),
    );
    assert_eq!(inj.api_key_var, Some(("GOOGLE_API_KEY", "gkey")));
    assert_eq!(inj.base_url_var, Some(("GOOGLE_BASE_URL", "https://generativelanguage.googleapis.com/v1beta")));
    assert!(inj.model_args.contains(&"--model"));
}

#[test]
fn test_kind_mismatch_returns_empty() {
    let inj = compute_injection(
        "claude", "openai", // 不兼容组合
        Some("k"), Some("u"), Some("m"),
    );
    assert_eq!(inj.api_key_var, None);
    assert_eq!(inj.base_url_var, None);
    assert!(inj.model_args.is_empty());
}
```

- [ ] **Step 3: 跑测试验证失败**

```bash
cd src-tauri
cargo test --test llm_provider_env_test
```

期望：`4 failed`（todo!() panic）

- [ ] **Step 4: 重构出 compute_injection 函数**

在 `commands/pty.rs` 上方添加：

```rust
// src-tauri/src/commands/pty.rs 文件顶部
#[derive(Debug, PartialEq)]
pub(crate) struct EnvInjection {
    pub api_key_var: Option<(&'static str, String)>,
    pub base_url_var: Option<(&'static str, String)>,
    pub model_args: Vec<String>,
}

/// 根据 tool_type 和 provider_kind 计算 LLM 环境变量注入。
/// 不兼容组合返回全 None。
pub(crate) fn compute_injection(
    tool_type: &str,
    provider_kind: &str,
    api_key: Option<&str>,
    base_url: Option<&str>,
    model: Option<&str>,
) -> EnvInjection {
    let (api_key_name, base_url_name) = match (tool_type, provider_kind) {
        ("claude", "anthropic") => (Some("ANTHROPIC_API_KEY"), Some("ANTHROPIC_BASE_URL")),
        ("codex", "openai") => (Some("OPENAI_API_KEY"), Some("OPENAI_BASE_URL")),
        ("gemini", "google") => (Some("GOOGLE_API_KEY"), Some("GOOGLE_BASE_URL")),
        ("opencode", _) => (Some("OPENCODE_API_KEY"), None),
        _ => (None, None),
    };

    EnvInjection {
        api_key_var: api_key_name
            .zip(api_key)
            .map(|(n, v)| (n, v.to_string())),
        base_url_var: base_url_name
            .zip(base_url)
            .map(|(n, v)| (n, v.to_string())),
        model_args: match model {
            Some(m) if !m.is_empty() => vec!["--model".to_string(), m.to_string()],
            _ => vec![],
        },
    }
}
```

更新 `src-tauri/tests/llm_provider_env_test.rs` 中的 `compute_injection` 引用为 `tea_coder_lib::commands::pty::compute_injection`（或对应 crate 名称），或 `pub(crate)` 改为 `pub` 用于测试可见。

更简单的方式：把 `compute_injection` 放到 `llm_provider` 模块下而非 `commands::pty`，因为它是纯函数。

修改：移到 `src-tauri/src/llm_provider/env_inject.rs`：

```rust
// src-tauri/src/llm_provider/env_inject.rs

#[derive(Debug, PartialEq, Clone)]
pub struct EnvInjection {
    pub api_key_var: Option<(&'static str, String)>,
    pub base_url_var: Option<(&'static str, String)>,
    pub model_args: Vec<String>,
}

/// 根据 tool_type 和 provider_kind 计算 LLM 环境变量注入。
/// 不兼容组合返回全 None。
pub fn compute_injection(
    tool_type: &str,
    provider_kind: &str,
    api_key: Option<&str>,
    base_url: Option<&str>,
    model: Option<&str>,
) -> EnvInjection {
    // ... 同上代码 ...
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claude_anthropic_env() { /* 同上 */ }
    #[test]
    fn test_codex_openai_env() { /* 同上 */ }
    #[test]
    fn test_gemini_google_env() { /* 同上 */ }
    #[test]
    fn test_kind_mismatch_returns_empty() { /* 同上 */ }
}
```

并把 `tests/llm_provider_env_test.rs` 删除（移到模块内）。

在 `llm_provider/mod.rs` 加 `pub mod env_inject;`。

- [ ] **Step 5: 跑测试验证通过**

```bash
cd src-tauri
cargo test llm_provider::env_inject --lib
```

期望：`4 passed`

- [ ] **Step 6: 修改 start_session 集成 LLM 注入**

修改 `src-tauri/src/commands/pty.rs`：

```rust
// 在 start_session 函数签名增加
pub fn start_session(
    app: tauri::AppHandle,
    pty_manager: tauri::State<PtyManager>,
    db: tauri::State<AppDatabase>,
    tab_id: String,
    tool_type: ToolType,
    work_dir: String,
    profile_id: Option<String>,
    user_env_vars: Option<HashMap<String, String>>,
    cli_args: Option<String>,
    cli_session_id: Option<String>,
    llm_provider_id: Option<String>,    // 新增
    model_name: Option<String>,         // 新增
) -> Result<(), String> {
    let mut env_vars = HashMap::new();

    // 1. Profile 注入（数据隔离目录）
    if let Some(ref pid) = profile_id {
        // ... 现有代码不变 ...
    }

    // 2. LLM Provider 注入（API Key + Base URL + Model）
    if let Some(ref lpid) = llm_provider_id {
        if let Some(provider) = crate::llm_provider::get_provider(&db, lpid)? {
            if !provider.is_active {
                return Err(format!(
                    "LLM 供应商「{}」已停用，请重新选择",
                    provider.name
                ));
            }
            let api_key = crate::crypto::keychain::get_secret(lpid, "api_key")
                .map_err(|e| format!("读取 API Key 失败: {}", e))?
                .unwrap_or_default();

            let tool_str = match tool_type {
                ToolType::Claude => "claude",
                ToolType::Codex => "codex",
                ToolType::Gemini => "gemini",
                ToolType::OpenCode => "opencode",
                _ => "",
            };

            let inj = crate::llm_provider::env_inject::compute_injection(
                tool_str,
                &provider.provider_kind,
                if api_key.is_empty() { None } else { Some(&api_key) },
                provider.base_url.as_deref(),
                model_name.as_deref(),
            );

            if let Some((name, value)) = inj.api_key_var {
                if value.is_empty() {
                    return Err(format!("LLM 供应商「{}」未配置 API Key", provider.name));
                }
                env_vars.insert(name.to_string(), value);
            }
            if let Some((name, value)) = inj.base_url_var {
                env_vars.insert(name.to_string(), value);
            }

            // Model 参数合并到 cli_args（OpenCode 不通过 cli args，单独处理）
            // 此处只预计算，在下面的 cli_args 处理时统一插入
            // （实际逻辑：把 model_args 暂存到 env_vars 的特殊 key，下游处理）
            // 简化做法：model_args 直接追加到本地 args，向 PtyManager 传递扩展签名
            // 见 Step 7
        }
    }

    // 3. user_env_vars 覆盖
    if let Some(user_vars) = user_env_vars {
        for (k, v) in user_vars {
            env_vars.insert(k, v);
        }
    }

    // ... 后续 cli_args 处理不变，但需要根据 LLM Provider 注入 model_args ...
    // 简化：把 model_args 通过 cli_args 合并逻辑处理

    // ... 启动 PTY ...
}
```

model 参数注入（避免污染 cli_args JSON）：改用本地变量：

```rust
    let mut args: Vec<String> = if let Some(json) = cli_args {
        serde_json::from_str(&json).unwrap_or_default()
    } else {
        vec![]
    };

    // Claude/Codex/Gemini: 在启动前插入 --model 参数
    if let Some(ref _lpid) = llm_provider_id {
        if let Some(ref m) = model_name {
            if !m.is_empty()
                && matches!(tool_type, ToolType::Claude | ToolType::Codex | ToolType::Gemini)
            {
                if !args.iter().any(|a| a == "--model") {
                    args.push("--model".to_string());
                    args.push(m.clone());
                }
            }
        }
    }

    // Claude Code: --session-id 注入（现有逻辑）
    // ...
```

- [ ] **Step 7: cargo build 验证**

```bash
cd src-tauri
cargo build
```

期望：编译成功

- [ ] **Step 8: 跑全部后端测试**

```bash
cargo test --lib
```

期望：所有测试通过

- [ ] **Step 9: 提交**

```bash
git add src-tauri/src/commands/pty.rs src-tauri/src/llm_provider/
git commit -m "feat(pty): start_session 注入 LLM Provider 环境变量与 model 参数"
```

---

### Task 7: Rust 端集成测试 - 端到端启动流程

**Files:**
- Create: `src-tauri/tests/start_session_llm_integration.rs`

**Interfaces:**
- 验证 start_session 组合 (Profile + LLM Provider + user_env_vars) 后，注入到 PTY 的 env_vars 内容正确

- [ ] **Step 1: 写测试**

```rust
// src-tauri/tests/start_session_llm_integration.rs
use std::collections::HashMap;
use tea_coder_lib::commands::pty::compute_injection; // 或重命名后的模块路径

#[test]
fn test_user_env_vars_override_provider() {
    // Profile + Provider + user_env_vars 三者合并后，user_env_vars 应胜出
    let mut env = HashMap::new();
    let inj = compute_injection(
        "claude", "anthropic",
        Some("provider-key"), Some("https://provider.url"),
        None,
    );
    if let Some((k, v)) = inj.api_key_var {
        env.insert(k.to_string(), v);
    }
    if let Some((k, v)) = inj.base_url_var {
        env.insert(k.to_string(), v);
    }
    // 用户覆盖
    env.insert("ANTHROPIC_API_KEY".to_string(), "user-key".to_string());

    assert_eq!(env.get("ANTHROPIC_API_KEY"), Some(&"user-key".to_string()));
    assert_eq!(env.get("ANTHROPIC_BASE_URL"), Some(&"https://provider.url".to_string()));
}

#[test]
fn test_inactive_provider_causes_start_failure() {
    // 通过 mock 验证（实际需要 DB，此处只验证 compute_injection 不感知 active 状态）
    // 实际 inactive 检查在 start_session 函数体内，不在 compute_injection
    // 此测试留给后续手动验证
}
```

（实际 end-to-end 测试需要 mock Tauri AppHandle，比较复杂；本任务简化为 compute_injection 层面的覆盖测试，详细的手动验证见 Phase 4）

- [ ] **Step 2: 跑测试**

```bash
cd src-tauri
cargo test --test start_session_llm_integration
```

- [ ] **Step 3: 提交**

```bash
git add src-tauri/tests/start_session_llm_integration.rs
git commit -m "test: start_session LLM 注入组合验证"
```

---

## Phase 2: 前端核心

### Task 8: TypeScript 类型定义

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces: `LlmProvider`, `LlmProviderModel`, `CreateLlmProviderInput`, `UpdateLlmProviderInput`, `PresetProviderView`

- [ ] **Step 1: 读现有 types/index.ts 末尾**

确认文件位置和导出风格。

- [ ] **Step 2: 添加类型**

在文件末尾追加：

```typescript
// LLM Provider 相关类型

export interface LlmProviderModel {
  id: string;
  providerId: string;
  modelName: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: number;
}

export interface LlmProvider {
  id: string;
  name: string;
  providerKind: 'anthropic' | 'openai' | 'google' | 'custom';
  baseUrl: string | null;
  icon: string | null;
  color: string | null;
  isPreset: boolean;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  models: LlmProviderModel[];
}

export interface CreateLlmProviderInput {
  name: string;
  providerKind: 'anthropic' | 'openai' | 'google' | 'custom';
  baseUrl?: string;
  icon?: string;
  color?: string;
  models: string[];
  defaultModel?: string;
  apiKey?: string;
}

export interface UpdateLlmProviderInput {
  name?: string;
  providerKind?: 'anthropic' | 'openai' | 'google' | 'custom';
  baseUrl?: string;
  icon?: string;
  color?: string;
  models?: string[];
  defaultModel?: string;
  isActive?: boolean;
  apiKey?: string;
}

export interface PresetProviderView {
  name: string;
  providerKind: 'anthropic' | 'openai' | 'google' | 'custom';
  baseUrl: string;
  icon: string;
  color: string;
  models: string[];
}

/** CLI 工具兼容的 provider_kind 映射 */
export const TOOL_PROVIDER_KIND_MAP: Record<string, ReadonlyArray<'anthropic' | 'openai' | 'google' | 'custom'>> = {
  claude: ['anthropic'],
  codex: ['openai'],
  gemini: ['google'],
  opencode: ['anthropic', 'openai', 'google', 'custom'],
};
```

- [ ] **Step 3: TypeScript 编译验证**

```bash
cd /work/CodingTea/TeaCoder/src
npx tsc --noEmit
```

期望：无错误

- [ ] **Step 4: 提交**

```bash
git add src/types/index.ts
git commit -m "feat(types): 新增 LLM Provider 类型定义"
```

---

### Task 9: 前端 IPC 封装

**Files:**
- Modify: `src/utils/ipc.ts`

**Interfaces:**
- Produces: 8 个 IPC 包装函数，命名对应后端命令

- [ ] **Step 1: 读现有 ipc.ts 风格**

确认 invoke 调用的命名约定（camelCase vs snake_case）。

- [ ] **Step 2: 添加 IPC 包装**

在文件末尾追加：

```typescript
import type {
  LlmProvider,
  CreateLlmProviderInput,
  UpdateLlmProviderInput,
  PresetProviderView,
} from '../types';

// LLM Provider IPC 封装

export async function listLlmProviders(includeInactive = false): Promise<LlmProvider[]> {
  return await invoke<LlmProvider[]>('llm_provider_list', { includeInactive });
}

export async function getLlmProvider(id: string): Promise<LlmProvider | null> {
  return await invoke<LlmProvider | null>('llm_provider_get', { id });
}

export async function createLlmProvider(input: CreateLlmProviderInput): Promise<LlmProvider> {
  return await invoke<LlmProvider>('llm_provider_create', { input });
}

export async function updateLlmProvider(
  id: string,
  input: UpdateLlmProviderInput,
): Promise<LlmProvider> {
  return await invoke<LlmProvider>('llm_provider_update', { id, input });
}

export async function deleteLlmProvider(id: string): Promise<void> {
  await invoke('llm_provider_delete', { id });
}

export async function hardDeleteLlmProvider(id: string): Promise<void> {
  await invoke('llm_provider_hard_delete', { id });
}

export async function setLlmProviderDefaultModel(
  providerId: string,
  modelId: string,
): Promise<void> {
  await invoke('llm_provider_set_default_model', { providerId, modelId });
}

export async function listLlmProviderPresets(): Promise<PresetProviderView[]> {
  return await invoke<PresetProviderView[]>('llm_provider_list_presets');
}
```

- [ ] **Step 3: TypeScript 编译验证**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: 提交**

```bash
git add src/utils/ipc.ts
git commit -m "feat(ipc): 新增 LLM Provider IPC 封装"
```

---

### Task 10: appStore 集成 llmProviders

**Files:**
- Modify: `src/stores/appStore.ts`

**Interfaces:**
- Produces: state `llmProviders: LlmProvider[]`, action `setLlmProviders`, thunks `loadLlmProviders`, `createLlmProvider`, `updateLlmProvider`, `deleteLlmProvider`

- [ ] **Step 1: 读现有 appStore.ts 的 profiles 状态模式**

理解现有结构。

- [ ] **Step 2: 添加状态和 actions**

修改：
- imports 增加 LlmProvider、相关 IPC 封装
- interface AppState 增加 `llmProviders: LlmProvider[]`、`setLlmProviders: (ps: LlmProvider[]) => void`
- 实现 `setLlmProviders`、`loadLlmProviders`、`createLlmProviderStore`、`updateLlmProviderStore`、`deleteLlmProviderStore`

具体代码（参考现有 profiles 模式）：

```typescript
// 在 AppState interface 内
llmProviders: LlmProvider[];
setLlmProviders: (providers: LlmProvider[]) => void;
loadLlmProviders: () => Promise<void>;
createLlmProvider: (input: CreateLlmProviderInput) => Promise<LlmProvider>;
updateLlmProvider: (id: string, input: UpdateLlmProviderInput) => Promise<LlmProvider>;
deleteLlmProvider: (id: string) => Promise<void>;
toggleLlmProviderActive: (id: string, isActive: boolean) => Promise<void>;

// 实现（在 create 函数体内）
llmProviders: [],
setLlmProviders: (providers) => set({ llmProviders: providers }),
loadLlmProviders: async () => {
  const providers = await listLlmProviders(false);
  set({ llmProviders: providers });
},
createLlmProvider: async (input) => {
  const created = await createLlmProvider(input);
  await get().loadLlmProviders();
  return created;
},
updateLlmProvider: async (id, input) => {
  const updated = await updateLlmProvider(id, input);
  await get().loadLlmProviders();
  return updated;
},
deleteLlmProvider: async (id) => {
  await deleteLlmProvider(id);
  await get().loadLlmProviders();
},
toggleLlmProviderActive: async (id, isActive) => {
  await updateLlmProvider(id, { isActive });
  await get().loadLlmProviders();
},
```

- [ ] **Step 3: TypeScript 编译验证**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: 在应用启动处调用 loadLlmProviders**

找到 App.tsx 或初始化位置，添加 useEffect：

```typescript
useEffect(() => {
  loadLlmProviders();
}, [loadLlmProviders]);
```

- [ ] **Step 5: 提交**

```bash
git add src/stores/appStore.ts src/App.tsx
git commit -m "feat(store): appStore 集成 llmProviders 状态"
```

---

### Task 11: LlmProviderCard 组件

**Files:**
- Create: `src/components/settings/components/LlmProviderCard.tsx`

**Interfaces:**
- Props: `provider: LlmProvider`, `onEdit: (p: LlmProvider) => void`, `onDelete: (p: LlmProvider) => void`, `onToggleActive: (p: LlmProvider) => void`
- 显示：icon、name、kind tag、模型数量、默认模型、active 状态

- [ ] **Step 1: 写组件**

```typescript
import { Tag, Switch, Button, Tooltip } from 'antd';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { LlmProvider } from '../../../types';

interface Props {
  provider: LlmProvider;
  onEdit: (p: LlmProvider) => void;
  onDelete: (p: LlmProvider) => void;
  onToggleActive: (p: LlmProvider, checked: boolean) => void;
}

const KIND_COLORS: Record<string, string> = {
  anthropic: 'orange',
  openai: 'green',
  google: 'blue',
  custom: 'default',
};

export default function LlmProviderCard({ provider, onEdit, onDelete, onToggleActive }: Props) {
  const defaultModel = provider.models.find((m) => m.isDefault);

  return (
    <div
      style={{
        border: '1px solid var(--ant-color-border)',
        borderRadius: 8,
        padding: 16,
        background: provider.isActive ? 'var(--ant-color-bg-container)' : 'var(--ant-color-fill-quaternary)',
        opacity: provider.isActive ? 1 : 0.6,
      }}
    >
      <div className="flex items-start justify-between" style={{ marginBottom: 8 }}>
        <div className="flex items-center gap-2">
          {provider.icon && (
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: provider.color ?? 'var(--ant-color-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {provider.name.charAt(0)}
            </div>
          )}
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{provider.name}</div>
            <div style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)' }}>
              {provider.baseUrl ?? '未设置 base_url'}
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          <Tooltip title="编辑">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => onEdit(provider)}
            />
          </Tooltip>
          {!provider.isPreset && (
            <Tooltip title="删除">
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => onDelete(provider)}
              />
            </Tooltip>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
        <Tag color={KIND_COLORS[provider.providerKind] ?? 'default'} style={{ fontSize: 11 }}>
          {provider.providerKind}
        </Tag>
        {provider.isPreset && (
          <Tag style={{ fontSize: 11 }}>预设</Tag>
        )}
        <span style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)' }}>
          {provider.models.length} 个模型
        </span>
      </div>

      {defaultModel && (
        <div style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)', marginBottom: 8 }}>
          默认模型：<span style={{ color: 'var(--ant-color-text)' }}>{defaultModel.modelName}</span>
        </div>
      )}

      <div className="flex items-center justify-between" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--ant-color-border-secondary)' }}>
        <span style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)' }}>
          {provider.isActive ? '启用中' : '已停用'}
        </span>
        <Switch
          size="small"
          checked={provider.isActive}
          onChange={(checked) => onToggleActive(provider, checked)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
git add src/components/settings/components/LlmProviderCard.tsx
git commit -m "feat(ui): 新增 LlmProviderCard 组件"
```

---

### Task 12: LlmProviderEditModal 组件

**Files:**
- Create: `src/components/settings/components/LlmProviderEditModal.tsx`

**Interfaces:**
- Props: `open, provider?, onCancel, onSave`
- 支持新建（provider=undefined）和编辑
- 字段：name、provider_kind 下拉、base_url、api_key、模型列表（增删改）、默认模型、icon/color

- [ ] **Step 1: 写组件骨架**

```typescript
import { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, Button, App, InputNumber } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { LlmProvider, CreateLlmProviderInput } from '../../../types';
import {
  createLlmProvider,
  updateLlmProvider,
  setLlmProviderDefaultModel,
} from '../../../utils/ipc';
import { useAppStore } from '../../../stores/appStore';

interface Props {
  open: boolean;
  provider?: LlmProvider;
  onCancel: () => void;
  onSaved: () => void;
}

const PROVIDER_KINDS = [
  { value: 'anthropic', label: 'Anthropic 协议' },
  { value: 'openai', label: 'OpenAI 协议' },
  { value: 'google', label: 'Google 协议' },
  { value: 'custom', label: '自定义' },
];

export default function LlmProviderEditModal({ open, provider, onCancel, onSaved }: Props) {
  const { message } = App.useApp();
  const updateStore = useAppStore((s) => s.updateLlmProvider);
  const createStore = useAppStore((s) => s.createLlmProvider);

  const [form] = Form.useForm();
  const [models, setModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (provider) {
        form.setFieldsValue({
          name: provider.name,
          providerKind: provider.providerKind,
          baseUrl: provider.baseUrl ?? '',
          icon: provider.icon ?? '',
          color: provider.color ?? '',
        });
        setModels(provider.models.map((m) => m.modelName));
        const def = provider.models.find((m) => m.isDefault);
        setDefaultModel(def?.modelName ?? null);
        setApiKey('');
      } else {
        form.resetFields();
        setModels([]);
        setDefaultModel(null);
        setApiKey('');
      }
    }
  }, [open, provider, form]);

  const handleAddModel = () => {
    setModels([...models, '']);
  };

  const handleRemoveModel = (idx: number) => {
    const removed = models[idx];
    const next = models.filter((_, i) => i !== idx);
    setModels(next);
    if (defaultModel === removed) setDefaultModel(null);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const cleanedModels = models.map((m) => m.trim()).filter(Boolean);
      if (cleanedModels.length === 0) {
        message.warning('请至少添加一个模型');
        return;
      }
      const effectiveDefault = defaultModel && cleanedModels.includes(defaultModel)
        ? defaultModel
        : cleanedModels[0];

      setSaving(true);
      if (provider) {
        await updateStore(provider.id, {
          name: values.name,
          providerKind: values.providerKind,
          baseUrl: values.baseUrl || undefined,
          icon: values.icon || undefined,
          color: values.color || undefined,
          models: cleanedModels,
          defaultModel: effectiveDefault,
          apiKey: apiKey || undefined,
        });
        message.success('已更新');
      } else {
        await createStore({
          name: values.name,
          providerKind: values.providerKind,
          baseUrl: values.baseUrl || undefined,
          icon: values.icon || undefined,
          color: values.color || undefined,
          models: cleanedModels,
          defaultModel: effectiveDefault,
          apiKey: apiKey || undefined,
        });
        message.success('已创建');
      }
      onSaved();
      onCancel();
    } catch (err) {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={provider ? `编辑供应商：${provider.name}` : '新建供应商'}
      open={open}
      onCancel={onCancel}
      onOk={handleSave}
      confirmLoading={saving}
      width={560}
      okText="保存"
      cancelText="取消"
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input placeholder="例如：Anthropic、GLM 智谱" />
        </Form.Item>
        <Form.Item name="providerKind" label="协议类型" rules={[{ required: true }]}>
          <Select options={PROVIDER_KINDS} placeholder="选择协议类型" />
        </Form.Item>
        <Form.Item name="baseUrl" label="Base URL">
          <Input placeholder="https://api.example.com/v1" />
        </Form.Item>
        <Form.Item label="API Key">
          <Input.Password
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider ? '留空保持原值' : '请输入 API Key'}
          />
        </Form.Item>
        <div className="grid grid-cols-2 gap-3">
          <Form.Item name="icon" label="图标名">
            <Input placeholder="anthropic" />
          </Form.Item>
          <Form.Item name="color" label="颜色（hex）">
            <Input placeholder="#D97757" />
          </Form.Item>
        </div>
      </Form>

      <div style={{ marginTop: 8, marginBottom: 8 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>模型列表</span>
          <Button size="small" icon={<PlusOutlined />} onClick={handleAddModel}>
            添加模型
          </Button>
        </div>
        {models.map((m, idx) => (
          <div key={idx} className="flex items-center gap-2" style={{ marginBottom: 6 }}>
            <Input
              value={m}
              size="small"
              placeholder="model-id"
              style={{ flex: 1 }}
              onChange={(e) => {
                const next = [...models];
                next[idx] = e.target.value;
                setModels(next);
              }}
            />
            <input
              type="radio"
              checked={defaultModel === m && m !== ''}
              disabled={!m}
              onChange={() => setDefaultModel(m)}
            />
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleRemoveModel(idx)}
            />
          </div>
        ))}
        <div style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)' }}>
          选中单选按钮标记默认模型
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
git add src/components/settings/components/LlmProviderEditModal.tsx
git commit -m "feat(ui): 新增 LlmProviderEditModal 编辑模态框"
```

---

### Task 13: LlmProvidersPage 主页面

**Files:**
- Create: `src/components/settings/LlmProvidersPage.tsx`

**Interfaces:**
- 入口组件：管理所有 LLM Provider
- 含：操作栏（添加按钮、显示已停用开关）、卡片网格、编辑/新建模态框

- [ ] **Step 1: 写主页面**

```typescript
import { useState } from 'react';
import { Button, Switch, App, Modal, Empty } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useAppStore } from '../../stores/appStore';
import { listLlmProviderPresets } from '../../utils/ipc';
import type { LlmProvider } from '../../types';
import SectionHeader from './components/SectionHeader';
import LlmProviderCard from './components/LlmProviderCard';
import LlmProviderEditModal from './components/LlmProviderEditModal';

export default function LlmProvidersPage() {
  const { message, modal } = App.useApp();
  const llmProviders = useAppStore((s) => s.llmProviders);
  const loadLlmProviders = useAppStore((s) => s.loadLlmProviders);
  const deleteStore = useAppStore((s) => s.deleteLlmProvider);
  const toggleActive = useAppStore((s) => s.toggleLlmProviderActive);

  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LlmProvider | undefined>(undefined);
  const [presetModalOpen, setPresetModalOpen] = useState(false);

  const filtered = showInactive
    ? llmProviders
    : llmProviders.filter((p) => p.isActive);

  const handleNew = () => {
    setEditing(undefined);
    setModalOpen(true);
  };

  const handleEdit = (p: LlmProvider) => {
    setEditing(p);
    setModalOpen(true);
  };

  const handleDelete = (p: LlmProvider) => {
    modal.confirm({
      title: `删除供应商「${p.name}」？`,
      content: '该操作将停用该供应商，已关联的会话将标记失效',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteStore(p.id);
          message.success('已停用');
        } catch {
          message.error('删除失败');
        }
      },
    });
  };

  const handleToggleActive = async (p: LlmProvider, checked: boolean) => {
    try {
      await toggleActive(p.id, checked);
      message.success(checked ? '已启用' : '已停用');
    } catch {
      message.error('操作失败');
    }
  };

  return (
    <div>
      <SectionHeader title="LLM 供应商" />

      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <div className="flex gap-2">
          <Button type="primary" icon={<PlusOutlined />} onClick={handleNew}>
            自定义新建
          </Button>
          <Button icon={<PlusOutlined />} onClick={() => setPresetModalOpen(true)}>
            从模板添加
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 12 }}>显示已停用</span>
          <Switch size="small" checked={showInactive} onChange={setShowInactive} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty description="暂无供应商" />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filtered.map((p) => (
            <LlmProviderCard
              key={p.id}
              provider={p}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggleActive={(provider, checked) => handleToggleActive(provider, checked)}
            />
          ))}
        </div>
      )}

      <LlmProviderEditModal
        open={modalOpen}
        provider={editing}
        onCancel={() => setModalOpen(false)}
        onSaved={() => loadLlmProviders()}
      />

      <PresetPickerModal
        open={presetModalOpen}
        onCancel={() => setPresetModalOpen(false)}
        onPicked={() => {
          setPresetModalOpen(false);
          loadLlmProviders();
        }}
      />
    </div>
  );
}

// 简化版：从模板添加的弹窗
function PresetPickerModal({ open, onCancel, onPicked }: {
  open: boolean;
  onCancel: () => void;
  onPicked: () => void;
}) {
  const { message } = App.useApp();
  const createStore = useAppStore((s) => s.createLlmProvider);
  const [presets, setPresets] = useState<Awaited<ReturnType<typeof listLlmProviderPresets>>>([]);

  useState(() => {
    if (open) {
      listLlmProviderPresets().then(setPresets).catch(() => message.error('加载模板失败'));
    }
  });

  const handlePick = async (preset: typeof presets[number]) => {
    try {
      await createStore({
        name: preset.name,
        providerKind: preset.providerKind as 'anthropic' | 'openai' | 'google' | 'custom',
        baseUrl: preset.baseUrl,
        icon: preset.icon,
        color: preset.color,
        models: preset.models,
        defaultModel: preset.models[0],
      });
      message.success(`已添加：${preset.name}`);
      onPicked();
    } catch {
      message.error('添加失败');
    }
  };

  return (
    <Modal title="从模板添加" open={open} onCancel={onCancel} footer={null} width={520}>
      <div className="grid grid-cols-2 gap-2" style={{ marginTop: 16 }}>
        {presets.map((p) => (
          <Button key={p.name} onClick={() => handlePick(p)} style={{ height: 'auto', padding: 12, textAlign: 'left' }}>
            <div style={{ fontWeight: 500 }}>{p.name}</div>
            <div style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)' }}>
              {p.models.length} 个模型 · {p.providerKind}
            </div>
          </Button>
        ))}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
git add src/components/settings/LlmProvidersPage.tsx
git commit -m "feat(ui): 新增 LlmProvidersPage 主页面"
```

---

### Task 14: 设置导航集成

**Files:**
- Modify: 找到设置入口（很可能是 `src/components/settings/` 下的菜单或 `AppLayout.tsx`）

**Interfaces:**
- 在「对话窗口」分组下加「LLM 设置」菜单项

- [ ] **Step 1: 找到设置菜单注册位置**

读 `src/components/settings/` 下的设置入口文件（可能是 `SettingsPage.tsx` 或类似），确认菜单结构。

- [ ] **Step 2: 加菜单项**

参考现有菜单项的写法，加入：

```typescript
{
  key: 'llm-providers',
  label: 'LLM 设置',
  icon: <CloudOutlined />,  // 或合适的图标
}
```

具体位置：在「终端设置」之后或根据现有分组约定。

- [ ] **Step 3: 验证菜单点击进入新页面**

启动 dev，验证菜单项可点击跳转到 LlmProvidersPage。

- [ ] **Step 4: 提交**

```bash
git add <modified-menu-file>
git commit -m "feat(ui): 设置菜单新增 LLM 设置入口"
```

---

## Phase 3: 前端集成

### Task 15: CliArgsLlmList 组件

**Files:**
- Create: `src/components/cli/CliArgsLlmList.tsx`

**Interfaces:**
- Props: `toolType: ToolType, value: { llmProviderIds: string[], defaultLlmProviderId?: string }, onChange`
- 显示：该 toolType 兼容的所有 LLM Provider 多选 + 默认 LLM Provider 单选
- 保存：调 IPC 更新 Profile 的 settings_json（持久化字段需扩展，见 Step 6）

- [ ] **Step 1: 读现有 CliArgsClaude.tsx 风格**

确认组件风格。

- [ ] **Step 2: 写组件**

```typescript
import { useEffect, useState } from 'react';
import { Select, Tag } from 'antd';
import { useAppStore } from '../../stores/appStore';
import { TOOL_PROVIDER_KIND_MAP } from '../../types';
import type { LlmProvider } from '../../types';

interface Props {
  toolType: 'claude' | 'codex' | 'gemini' | 'opencode';
  value: {
    llmProviderIds?: string[];
    defaultLlmProviderId?: string;
  };
  onChange: (val: { llmProviderIds: string[]; defaultLlmProviderId?: string }) => void;
}

export default function CliArgsLlmList({ toolType, value, onChange }: Props) {
  const llmProviders = useAppStore((s) => s.llmProviders);
  const loadLlmProviders = useAppStore((s) => s.loadLlmProviders);

  useEffect(() => {
    if (llmProviders.length === 0) {
      loadLlmProviders();
    }
  }, [llmProviders.length, loadLlmProviders]);

  const allowedKinds = TOOL_PROVIDER_KIND_MAP[toolType] ?? [];
  const compatible = llmProviders.filter(
    (p) => p.isActive && allowedKinds.includes(p.providerKind as any),
  );

  const selectedIds = value.llmProviderIds ?? [];
  const defaultId = value.defaultLlmProviderId;

  return (
    <div className="space-y-3">
      <div>
        <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', marginBottom: 4 }}>
          LLM 列表（多选）
        </div>
        <Select
          mode="multiple"
          size="small"
          style={{ width: '100%' }}
          placeholder="选择该 Profile 可用的 LLM 供应商"
          value={selectedIds}
          onChange={(ids) => {
            // 默认 LLM 若不在新列表中，清除
            const newDefault = ids.includes(defaultId ?? '') ? defaultId : undefined;
            onChange({ llmProviderIds: ids, defaultLlmProviderId: newDefault });
          }}
          options={compatible.map((p) => ({
            value: p.id,
            label: (
              <span>
                <Tag color={providerKindColor(p.providerKind)} style={{ marginRight: 4 }}>
                  {p.providerKind}
                </Tag>
                {p.name}
              </span>
            ),
          }))}
        />
      </div>

      <div>
        <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)', marginBottom: 4 }}>
          默认 LLM 供应商模型（单选）
        </div>
        <Select
          size="small"
          style={{ width: '100%' }}
          placeholder="选择新建会话时的默认 LLM"
          value={defaultId}
          allowClear
          onChange={(id) => onChange({ llmProviderIds: selectedIds, defaultLlmProviderId: id })}
          options={compatible
            .filter((p) => selectedIds.includes(p.id))
            .flatMap((p) => {
              const defModel = p.models.find((m) => m.isDefault);
              return [
                {
                  value: p.id,
                  label: (
                    <span>
                      <strong>{p.name}</strong>
                      {defModel && (
                        <span style={{ marginLeft: 6, color: 'var(--ant-color-text-tertiary)' }}>
                          {defModel.modelName}
                        </span>
                      )}
                    </span>
                  ),
                },
              ];
            })}
        />
      </div>
    </div>
  );
}

function providerKindColor(kind: string): string {
  return { anthropic: 'orange', openai: 'green', google: 'blue', custom: 'default' }[kind] ?? 'default';
}
```

- [ ] **Step 3: TypeScript 编译验证**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: 提交**

```bash
git add src/components/cli/CliArgsLlmList.tsx
git commit -m "feat(ui): 新增 CliArgsLlmList LLM 列表选择组件"
```

---

### Task 16: 修改 ClaudeSettingsPage 集成 CliArgsLlmList

**Files:**
- Modify: `src/components/settings/ClaudeSettingsPage.tsx`

- [ ] **Step 1: 移除默认模型三选一**

删除 CLAUDE_MODELS 数组（约 11-15 行）和渲染"默认模型"区块（约 173-215 行）。

- [ ] **Step 2: 添加 CliArgsLlmList**

找到合适位置（如原"默认模型"位置），添加：

```typescript
import CliArgsLlmList from '../cli/CliArgsLlmList';

// 在 state 中加
const [llmConfig, setLlmConfig] = useState<{
  llmProviderIds: string[];
  defaultLlmProviderId?: string;
}>({ llmProviderIds: [] });

// 在 loadSettings 中加解析
const data = await getToolSettings(profileId);
if (data?.settingsJson) {
  try {
    const parsed = JSON.parse(data.settingsJson);
    if (parsed.llmProviderIds) {
      setLlmConfig({
        llmProviderIds: parsed.llmProviderIds,
        defaultLlmProviderId: parsed.defaultLlmProviderId,
      });
    }
  } catch {}
}

// 在 saveToBackend 中合并 settings_json
settingsJson: JSON.stringify({
  llmProviderIds: llmConfig.llmProviderIds,
  defaultLlmProviderId: llmConfig.defaultLlmProviderId,
  // 保留旧字段
  permissionMode: next.permissionMode,
  maxOutputLength: next.maxOutputLength,
}),

// 在 JSX 中渲染
<SectionHeader title="LLM 供应商" />
<CliArgsLlmList
  toolType="claude"
  value={llmConfig}
  onChange={setLlmConfig}
/>
```

- [ ] **Step 3: TypeScript 编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: 提交**

```bash
git add src/components/settings/ClaudeSettingsPage.tsx
git commit -m "refactor(settings): Claude 设置页改为 LLM 列表选择"
```

---

### Task 17-19: Codex/Gemini/OpenCode 设置页类似改造

**Files:**
- Modify: `src/components/settings/CodexSettingsPage.tsx`、`GeminiSettingsPage.tsx`、`OpenCodeSettingsPage.tsx`

每个文件重复 Task 16 的步骤，仅 `toolType` 参数不同。

- [ ] **Step 17.1-19.1: 对每个文件应用 Task 16 的修改模式**

参考 Task 16，每个设置页：
1. 移除默认模型三选一（如有）
2. 加 CliArgsLlmList，toolType 分别为 codex/gemini/opencode
3. 持久化到 settings_json

- [ ] **Step 17.2-19.2: 逐文件 TypeScript 编译**

每个文件修改后跑 `npx tsc --noEmit`。

- [ ] **Step 17.3-19.3: 提交（每个文件一个 commit）**

```bash
git add src/components/settings/CodexSettingsPage.tsx
git commit -m "refactor(settings): Codex 设置页改为 LLM 列表选择"

git add src/components/settings/GeminiSettingsPage.tsx
git commit -m "refactor(settings): Gemini 设置页改为 LLM 列表选择"

git add src/components/settings/OpenCodeSettingsPage.tsx
git commit -m "refactor(settings): OpenCode 设置页改为 LLM 列表选择"
```

---

### Task 20: 修改 NewSessionModal 集成 LLM 下拉

**Files:**
- Modify: `src/components/session/NewSessionModal.tsx`

**Interfaces:**
- 选择 Profile / toolType 后，加 LLM Provider 下拉（按 toolType 过滤）和 Model 下拉
- 默认值来自 Profile 的 settings_json（defaultLlmProviderId）

- [ ] **Step 1: 读现有 NewSessionModal 结构**

确认现有字段。

- [ ] **Step 2: 加 LLM 下拉联动**

添加 state：
```typescript
const [llmProviderId, setLlmProviderId] = useState<string | undefined>();
const [modelName, setModelName] = useState<string | undefined>();
```

Profile 变化时初始化默认值（从 profile.toolSettings 解析 defaultLlmProviderId）：

```typescript
useEffect(() => {
  if (selectedProfile && selectedProfile.toolType) {
    // 从 settings_json 解析 defaultLlmProviderId
    const settings = selectedProfile.toolSettings?.settingsJson
      ? JSON.parse(selectedProfile.toolSettings.settingsJson)
      : {};
    const defId = settings.defaultLlmProviderId;
    setLlmProviderId(defId);
    // 设置默认 model
    if (defId) {
      const provider = llmProviders.find((p) => p.id === defId);
      const defModel = provider?.models.find((m) => m.isDefault);
      if (defModel) setModelName(defModel.modelName);
    }
  }
}, [selectedProfile?.id]);
```

JSX 中加（在 Profile 选择之后）：
```typescript
<Form.Item label="LLM 供应商">
  <Select
    value={llmProviderId}
    placeholder="选择 LLM 供应商"
    allowClear
    onChange={(id) => {
      setLlmProviderId(id);
      const provider = llmProviders.find((p) => p.id === id);
      const defModel = provider?.models.find((m) => m.isDefault);
      setModelName(defModel?.modelName);
    }}
    options={compatibleProviders(selectedProfile?.toolType).map((p) => ({
      value: p.id,
      label: `${p.name} (${p.providerKind})`,
    }))}
  />
</Form.Item>
<Form.Item label="模型">
  <Select
    value={modelName}
    placeholder="选择模型"
    allowClear
    onChange={setModelName}
    options={
      llmProviders
        .find((p) => p.id === llmProviderId)
        ?.models.map((m) => ({ value: m.modelName, label: m.modelName + (m.isDefault ? ' (默认)' : '') })) ?? []
    }
  />
</Form.Item>
```

提交时把 llmProviderId 和 modelName 传到 create_session IPC。

- [ ] **Step 3: TypeScript 编译**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: 提交**

```bash
git add src/components/session/NewSessionModal.tsx
git commit -m "feat(session): 新建会话对话框集成 LLM Provider 与 Model 选择"
```

---

### Task 21: Session Tab 显示 LLM 标记

**Files:**
- Modify: `src/components/tabs/TabBar.tsx`

**Interfaces:**
- 会话 Tab 旁显示 LLM Provider 的 icon 缩写（首字母或前两字）
- 颜色取自 Provider.color

- [ ] **Step 1: 读 TabBar 现有结构**

- [ ] **Step 2: 加 LLM 标记**

在 Tab 标题旁：
```typescript
{session.llmProviderId && (
  <span
    style={{
      display: 'inline-block',
      width: 16,
      height: 16,
      borderRadius: 3,
      background: providerColor ?? 'var(--ant-color-primary)',
      color: '#fff',
      fontSize: 9,
      lineHeight: '16px',
      textAlign: 'center',
      marginLeft: 4,
    }}
  >
    {providerNameFirstChar}
  </span>
)}
```

- [ ] **Step 3: TypeScript 编译**

- [ ] **Step 4: 提交**

```bash
git add src/components/tabs/TabBar.tsx
git commit -m "feat(ui): 会话 Tab 显示 LLM Provider 颜色标记"
```

---

## Phase 4: 验证

### Task 22: clippy + 全测试套件

**Files:** 无新增

- [ ] **Step 1: Rust clippy**

```bash
cd src-tauri
cargo clippy --all-targets -- -D warnings
```

期望：无 warning

- [ ] **Step 2: Rust 测试**

```bash
cd src-tauri
cargo test --lib
cargo test --tests
```

期望：全通过

- [ ] **Step 3: 前端 typecheck + lint**

```bash
npx tsc --noEmit
npm run lint  # 若有配置
```

- [ ] **Step 4: 构建**

```bash
pnpm tauri build
```

期望：构建成功

- [ ] **Step 5: 不需要单独 commit（无代码变更）**

---

### Task 23: 手动跨平台验证

**Files:** 无新增

按 spec 第 9 节「手动验证清单」逐项验证：

- [ ] **Step 1: 首次启动自动 seed 14 个预设**

```bash
rm -rf ~/.local/share/tea-coder  # Linux
# 或 macOS: rm -rf ~/Library/Application\ Support/tea-coder
# 或 Windows: rmdir /s %APPDATA%\tea-coder
pnpm tauri dev
```

启动后进入设置 → LLM 设置，确认 14 个预设供应商存在。

- [ ] **Step 2: Claude Code + Anthropic 官方启动**

配置 Profile toolType=claude，选择 Anthropic 预设，提供有效 API Key。启动会话，确认 PTY 中能正常调用 Claude API。

- [ ] **Step 3: Claude Code + GLM 切换**

配置 LLM Provider（GLM 智谱），新建会话选择该 Provider + glm-4-plus。启动会话，确认请求走 GLM 端点（可通过日志或抓包验证）。

- [ ] **Step 4: Codex CLI + DeepSeek**

类似 Step 3，但 toolType=codex，Provider=DeepSeek。

- [ ] **Step 5: 多会话同时互不干扰**

开两个会话，分别用 Anthropic 和 GLM。在每个会话执行一次查询，确认 LLM 路由正确（通过响应内容或日志）。

- [ ] **Step 6: 软删除验证**

软删除一个 Provider，重启引用该 Provider 的会话，确认启动失败并提示。

- [ ] **Step 7: 跨平台**

在 macOS 和 Windows（如有）上重复 Step 2-6。

- [ ] **Step 8: 文档**

更新 `CLAUDE.md` 或 `docs/` 下加简要说明（如有需要）。

---

## Self-Review Checklist

### Spec 覆盖

- ✅ v8 迁移（Task 1）
- ✅ 14 个预设（Task 2）
- ✅ Seed 逻辑（Task 3）
- ✅ CRUD + 软删除 + 硬删除（Task 4）
- ✅ 8 个 IPC 命令（Task 5）
- ✅ start_session env 注入（Task 6）
- ✅ 矩阵测试（Task 7）
- ✅ TypeScript 类型（Task 8）
- ✅ IPC 封装（Task 9）
- ✅ appStore（Task 10）
- ✅ LlmProviderCard（Task 11）
- ✅ LlmProviderEditModal（Task 12）
- ✅ LlmProvidersPage（Task 13）
- ✅ 设置菜单（Task 14）
- ✅ CliArgsLlmList（Task 15）
- ✅ Claude/Codex/Gemini/OpenCode 设置页（Task 16-19）
- ✅ 新建会话对话框（Task 20）
- ✅ 会话 Tab 标记（Task 21）
- ✅ 验证（Task 22-23）

### 一致性

- 类型/函数名 `LlmProvider` / `LlmProviderModel` / `CreateLlmProviderInput` 等在 Task 8 定义，Task 9-21 引用，名称一致
- IPC 命令名 `llm_provider_list` / `create` / `update` / `delete` / `set_default_model` 等跨 Rust/TS 一致
- `TOOL_PROVIDER_KIND_MAP` 在 Task 8 定义，Task 15 引用

### 风险与回退

- **Gemini/OpenCode 实际 env 注入机制**未在 spec 中验证，Task 6 的实现按"环境变量优先"假设；若实装失败，OpenCode/Gemini 可降级为不支持 LLM Provider
- **API Key 在 keychain 中的清理**已包含在 hard_delete 中
- **旧 Profile 兼容**通过 env 注入顺序自然实现
