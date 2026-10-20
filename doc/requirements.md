# TeaCoder — 需求说明书 v0.1.0

> 本文档面向 Claude Code 开发实现，描述 v0.1.0 已发布版本的完整需求与功能明细。
> 
> **版本统一**：原 v0.1 (MVP) 规划已实现落地，代码当前版本为 **v0.1.0**（`tauri.conf.json` `version: "0.1.0"`、`identifier: com.codingtea.teacoder`）。

## 1. 项目概述

### 1.1 项目名称

**TeaCoder**

- 产品名（display）：`TeaCoder`
- Tauri `productName`：`teacoder`
- 包标识符（identifier）：`com.codingtea.teacoder`

### 1.2 版本

v0.1.0（已发布）

### 1.3 项目目标

构建一款 AI 编程 CLI 工具的桌面管理客户端，为 Claude Code / Codex CLI / Gemini CLI / OpenCode / Antigravity / 裸终端 / SSH 提供图形化的会话管理、账号管理、费用追踪、配置管理等"周边设施"，核心原则是**零额外 Token 开销**。

### 1.4 核心价值

- PTY 直通，不拦截/代理 API 请求，零额外 Token 消耗
- 多工具统一管理（Claude Code / Codex / Gemini / OpenCode / Antigravity / 裸 terminal / SSH）
- 多账号完全隔离
- Token 费用通过读取 CLI 本地数据文件统计（非解析 PTY 输出）

---

## 2. 技术栈

### 2.1 桌面端

- **框架**：Tauri 2.x
- **后端**：Rust（stable）
- **前端**：React 19 + TypeScript
- **UI 组件库**：Ant Design 6
- **样式**：TailwindCSS 4（仅用于布局/间距/自定义样式，避免与 AntD 类名冲突；`preflight: false`）
- **状态管理**：Zustand
- **终端渲染**：xterm.js + xterm-addon-fit
- **数据存储**：SQLite（rusqlite，bundled）+ JSONL

### 2.2 关键 Rust 依赖

| Crate                     | 用途                |
| ------------------------- | ----------------- |
| `tauri 2.x`               | 桌面框架              |
| `tokio` (feature = full)  | 异步运行时             |
| `portable-pty 0.8`        | PTY 伪终端           |
| `rusqlite 0.35` (bundled) | SQLite 操作         |
| `keyring 3`               | 系统 Keychain       |
| `base64`                  | LlmProvider 凭据编码  |
| `serde + serde_json`      | 序列化               |
| `thiserror 2`             | 错误类型              |
| `uuid 1` (v4)             | ID 生成             |
| `chrono 0.4`              | 时间处理              |
| `walkdir`                 | Claude JSONL 目录遍历 |
| `async-trait`             | 异步 trait          |

### 2.3 打包产物

- Windows：`.exe` (NSIS 安装程序)
- macOS：`.dmg`
- Ubuntu：`.deb`
- 其他 Linux：`.AppImage`

### 2.4 项目结构

```
/
├── src-tauri/                  # Rust 后端
│   ├── src/
│   │   ├── main.rs / lib.rs
│   │   ├── pty/                # PTY 终端管理（支持 cli / ssh 双路径）
│   │   ├── cli/                # CLI 工具检测与启动
│   │   ├── profile/            # Profile 管理（keychain 凭据）
│   │   ├── llm_provider/       # LLM 供应商系统（预设/凭据/env_inject）
│   │   ├── cost/              # Token 费用追踪（CostProvider）
│   │   │   ├── mod.rs
│   │   │   ├── provider.rs
│   │   │   ├── claude.rs       # 完整
│   │   │   ├── codex.rs        # 框架
│   │   │   ├── gemini.rs       # 框架
│   │   │   └── opencode.rs     # 框架
│   │   ├── project/            # Project + Session
│   │   ├── session_category/    # 会话分类
│   │   ├── session_message.rs   # 会话消息
│   │   ├── tool_settings/      # 各 CLI 工具的 per-tool 设置
│   │   ├── crypto/             # Keychain
│   │   ├── storage/             # SQLite schema + migrations
│   │   ├── tray.rs             # 系统托盘
│   │   └── commands/           # Tauri IPC 命令
│   ├── migrations/             # schema v1~v12
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                        # React 前端
│   ├── components/
│   │   ├── layout/             # AppHeader / AppSidebar / AppContent / AppStatusBar
│   │   ├── terminal/           # TerminalView (xterm.js) / UserMessageTracker
│   │   ├── tabs/               # TabBar / NewSessionModal / EditSessionModal / SearchPanel
│   │   ├── panes/              # PaneView / PaneSplitter (分屏)
│   │   ├── project/            # ProjectNode / NewProjectModal / NewCategoryModal
│   │   ├── profile/            # ProfileFormModal / ProfileManager
│   │   ├── cost/               # CostDashboard / PricingConfigPanel
│   │   ├── cli/                # cliTools / CliArgsClaude / CliArgsLlmList / CliToolStatus
│   │   ├── quick-commands/     # QuickCommands / QuickCommandsEditor
│   │   ├── settings/           # 18 个设置页面（详见 §6.7）
│   │   ├── common/             # ErrorBoundary / WindowControls
│   │   └── onboarding/         # OnboardingFlow
│   ├── stores/appStore.ts      # Zustand 全局 store
│   ├── types/index.ts
│   ├── utils/                  # ipc / font / image / claudeModels
│   ├── hooks/useKeyboardShortcuts.ts
│   ├── themes/
│   ├── App.tsx
│   └── main.tsx
├── doc/
│   ├── teacoder-roadmap.md     # 路线文档
│   └── requirements.md         # 本文档
└── public/                      # 静态资源（logo、CLI 图标）
```

---

## 3. 功能需求（v0.1.0 已实现）

### 3.1 多工具终端管理

#### 3.1.1 支持的工具类型 ✅

- `claude` — Claude Code
- `codex` — Codex CLI
- `gemini` — Gemini CLI
- `opencode` — OpenCode
- `antigravity` — Antigravity CLI
- `terminal` — 裸终端（不依赖 CLI，直接开 bash/zsh）
- `ssh` — SSH 远程会话（自动 askpass 注入密码）

#### 3.1.2 CLI 工具检测 ✅

- IPC 命令：`cli::detect_cli_tools`
- 检测方式：检查 PATH 环境变量中的可执行文件
- 检测内容：是否安装、版本号（执行 `<tool> --version`）、可执行文件路径
- 触发时机：应用启动时自动检测 + 用户手动重新检测
- 输出：工具列表 `{toolType, version, path, isAvailable, lastDetectedAt}`

#### 3.1.3 CLI 工具启动（PTY 直通）✅

- IPC 命令：`pty::start_session` / `pty::stop_session` / `pty::write_to_pty` / `pty::resize_pty`
- 使用 `portable-pty` crate 创建 PTY
- 启动参数：工作目录、Profile 环境变量注入、CLI 参数（`Session.cliArgs`）、环境变量（`Session.envVars`）
- PTY 输出事件：`pty:output`（广播到所有订阅者，支持分屏双开共享）
- PTY 退出事件：`pty:exit`（携带 exitCode）
- 后端 `start_session` 幂等：同一 tabId 已存在则 no-op 复用现有 PtyEntry

#### 3.1.4 SSH 会话 ✅

- IPC 命令：`pty::test_ssh_connection`
- 实现：在 PtyManager 中走独立分支（`ToolType::Ssh → "ssh"`）
- 自动 askpass：检测密码型连接时生成 `teacoder-ssh-askpass-{pid}.sh` 临时脚本与 `teacoder-ssh-pwd-{pid}.txt` 密码文件，密码读取后立即清理
- 调用方负责在会话关闭时清理 askpass 文件（`remove_ssh_askpass`）

### 3.2 会话与项目层级管理

v0.1.0 引入了四层模型，关系为：Project → SessionCategory → Session

#### 3.2.1 Project（项目）✅

- 定义：工作目录路径即为项目
- IPC：`project::{project_list, project_create, project_update, project_delete}`
- 表：`projects`
- 字段：id / name / path / color / createdAt / updatedAt
- 操作：新建（`NewProjectModal`）、编辑、删除、收藏

#### 3.2.2 SessionCategory（会话分类）✅

- 定义：项目下的二级分组（如"实验性 / 线上 / 历史"）
- IPC：`session_category::{category_list, category_create, category_update, category_delete}`
- 表：`session_categories`
- 字段：id / projectId / name / createdAt / updatedAt
- UI：侧边栏树形展示，折叠状态记录在 `collapsedCategoryIds`

#### 3.2.3 Session（会话）✅

- 定义：CLI 工具的具体一次会话（标签页对应一个 Session 实例）
- IPC：`session::{session_list, session_create, session_update, session_delete, claude_jsonl_exists}`
- 表：`sessions`
- 字段：id / projectId / categoryId / title / toolType / profileId / llmProviderId / modelName / claudeModels（sonnet/opus/haiku 子字段） / thinkingIntensity / templateId / cliArgs / envVars / isRunning / cliSessionId / color / createdAt / updatedAt / closedAt
- 会话模板：`SessionTemplate` 表，new session 时可应用模板的默认 cliArgs/envVars/thinkingIntensity

#### 3.2.4 SessionMessage（会话消息）✅

- 定义：手动记录的用户/AI 消息（独立于 CLI 工具自身的会话日志）
- IPC：`session_message::{session_message_list, session_message_create, session_message_delete}`
- 表：`session_messages`
- 用途：用户回顾关键决策、分享会话要点

### 3.3 标签与分屏

#### 3.3.1 多标签（Tab）✅

- 每个 Session 可作为 Tab 打开
- 标签属性：title / toolType 图标 / color / profile / 模型显示
- 操作：
  - 新建（Ctrl+T → `NewSessionModal`）
  - 关闭（Ctrl+W 直接关闭，无确认框）
  - 切换（Ctrl+Tab 顺向 / Ctrl+Shift+Tab 逆向）
  - 拖拽排序（在同 pane 内 reorder）
  - 跨 pane 拖拽（`moveTabToPane`）
  - 右键菜单：分屏左右 / 关闭分屏 / 关闭其他 / 关闭所有 / 关闭右侧 / 重新打开
- 持久化：`teacoder_panes_layout`（version=2，存全量 panes + activePaneId）；`teacoder_open_tabs` 兼容旧版本

#### 3.3.2 多分屏（Pane）✅

- 最多 2 个 pane（左右/上下两种方向；v0.1.0 实际上限为左右 2 pane）
- IPC：无（纯前端 store 操作）
- 操作：分屏（`splitPane(tabId, direction)`）、关闭分屏（`closePane(paneId)`）、调整分屏比例（`setSplitRatio`）
- 分屏 UI：`PaneSplitter` 拖拽条 + `PaneView` 渲染单个 pane

#### 3.3.3 共享 PTY 双开 ✅

- 同一 Session 可在两个 pane 各开一个实例
- 后端 `start_session` 幂等：第二个 start 直接复用现有 PtyEntry
- 前端：`terminalRefs` 用复合 key `${paneId}:${tabId}`，Copy/Paste 按复合 key 取 handle
- 输入限制：只有 activePane 的 TerminalView 启用 `enableInput`（避免双写 PTY）
- 关闭一个实例：`closeTab(id, paneId)` 按实例移除；PTY 进程只在所有实例归零时停止
- Resize 限制：只有 activePane 触发 `resizeToPty`（避免 SIGWINCH 风暴）

#### 3.3.4 会话搜索 ✅

- IPC：无（纯前端）
- 快捷键：Ctrl+P 打开 `SearchPanel`
- 搜索范围：项目名、Session 标题、工作目录路径
- 搜索结果：点击定位并切换到对应 Tab（`locateSession`）

### 3.4 LLM 供应商系统

> v0.1.0 引入的新核心概念。每个 Session 可绑定一个 LLM Provider + 一个模型，覆盖 Claude / OpenAI / Google / 自定义四大类。Provider 内部可包含多个模型。

#### 3.4.1 Provider 类型 ✅

- `providerKind: "anthropic" | "openai" | "google" | "custom"`
- 4 类共 21 个预设（`llm_provider/preset.rs`）：
  - anthropic：官方 + MiniMax 中转
  - openai：官方 + DeepSeek（丐）/ 阿里云 / 火山引擎 / 硅基流动 / 青云 / 等等
  - google：Gemini

#### 3.4.2 数据结构 ✅

```typescript
interface LlmProvider {
  id: string;
  name: string;
  providerKind: "anthropic" | "openai" | "google" | "custom";
  authType: "api_key" | "oauth";
  baseUrl?: string;
  icon?: string;
  color?: string;
  isPreset: boolean;        // 预设 vs 用户自定义
  isActive: boolean;        // 是否启用
  isDefault: boolean;       // 是否全局默认
  models: LlmProviderModel[];
  apiKey?: string;
  oauthToken?: string;
}
```

#### 3.4.3 IPC 命令 ✅

- `llm_provider::{llm_provider_list, llm_provider_get, llm_provider_create, llm_provider_update, llm_provider_delete, llm_provider_hard_delete}`
- `llm_provider_set_default_model` — 设置默认模型
- `llm_provider_set_default_provider` — 设置全局默认 Provider
- `llm_provider_has_api_key` / `llm_provider_get_api_key` — 凭据检测/获取（用于"自动复制到剪贴板"等）
- `llm_provider_list_presets` — 列出内置预设

#### 3.4.4 凭据存储 ⚠️

- **Base64 编码存入 SQLite**（`llm_providers.api_key` / `oauth_token`，schema v11/v12）
- 设计权衡：原计划走系统 Keychain（`keyring` crate），但 Linux 上 Secret Service 跨桌面环境体验不稳定，故改为 SQLite + Base64
- Profile（详见 §3.5）仍然走系统 Keychain，两套并行

#### 3.4.5 预设初始化 ✅

- 应用首次启动时调用 `llm_provider::seed` 写入内置预设（`isPreset = true`）
- 用户可在 `LlmProvidersPage` 编辑/添加自定义 Provider

### 3.5 Profile 管理

> 与 LlmProvider 并行的另一层配置概念。Profile 用于"账号实例"（CLI 工具的运行时实例），包含 API Key / OAuth / appDataRoot。

#### 3.5.1 数据结构 ✅

```typescript
interface Profile {
  id: string;
  name: string;
  toolType: ToolType;
  authType: "api_key" | "oauth";
  baseUrl?: string;
  appDataRoot?: string;             // Claude Code 的 CLAUDE_CONFIG_DIR
  color?: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  // 凭据字段(响应后端)，但凭据本体存于 Keychain
  apiKeyStored?: string;
  oauthTokenStored?: string;
  oauthRefreshTokenStored?: string;
}
```

#### 3.5.2 IPC 命令 ✅

- `profile::{list_profiles, create_profile, update_profile, delete_profile, get_profile_credential, store_profile_credential}`

#### 3.5.3 凭据存储 ✅

- macOS：Keychain
- Windows：Credential Manager
- Linux：Secret Service（libsecret）
- Rust crate：`keyring = "3"`
- Service 标识：`com.teacoder.app`
- 存储键名：`{profile_id}:api_key` / `{profile_id}:oauth_token` / `{profile_id}:oauth_refresh_token`
- API：`crypto::keychain::{store_secret, get_secret, delete_secret, delete_all_secrets, has_secret}`

#### 3.5.4 多实例数据隔离（Claude Code）✅

- 通过环境变量 `CLAUDE_CONFIG_DIR` 指向 Profile 独立目录
- 默认 `~/.claude/`，Profile 独立目录：`~/.teacoder/profiles/<profile_id>/claude-data/`
- 其他 CLI 工具 v0.1.0 暂不强制隔离

#### 3.5.5 环境变量注入 ✅

- `llm_provider::env_inject` — 根据当前 LlmProvider 构造环境变量（API Key、Base URL 等）
- `llm_provider::env_merge` — 合并 Session.envVars + Profile 环境 + Provider 环境

### 3.6 工具设置（per-tool 简写）

> v0.1.0 把每个 CLI 工具的可配置项抽到 `tool_settings` 表，独立于 Profile。

- IPC：`tool_settings::{get_tool_settings, upsert_tool_settings, delete_tool_settings}`
- 表：`tool_settings`
- 字段：toolType / settings（JSON）
- UI：每个 CLI 工具对应独立设置页（`ClaudeSettingsPage`、`CodexSettingsPage`、`GeminiSettingsPage`、`OpenCodeSettingsPage`、`AntigravitySettingsPage`）

### 3.7 应用级设置

> v0.1.0 引入 `app_settings` 表（schema v7）存储应用级 KV。

- 表：`app_settings`
- 字段：key / value / updatedAt
- 用途：主题、字体大小、侧边栏折叠状态、快捷键等

### 3.8 Token 费用追踪

#### 3.8.1 方案 ✅

- 读取 CLI 工具本地数据文件，**非解析 PTY 输出**

#### 3.8.2 CostProvider Trait ✅

```rust
#[async_trait]
pub trait CostProvider: Send + Sync {
    fn tool_type(&self) -> ToolType;
    fn data_dir(&self, profile: &Profile) -> PathBuf;
    async fn list_sessions(&self, profile: &Profile) -> Result<Vec<SessionFile>>;
    async fn parse_session(&self, file_path: &Path) -> Result<SessionCost>;
    async fn get_live_usage(&self, profile: &Profile, session_id: &str) -> Result<SessionCost>;
}
```

#### 3.8.3 各 CLI 数据来源

| CLI 工具      | 数据来源                                        | v0.1.0 实现                               |
| ----------- | ------------------------------------------- | --------------------------------------- |
| Claude Code | `~/.claude/projects/*/conversation_*.jsonl` | ✅ 完整（`cost/claude.rs`，walkdir 逐行 JSONL） |
| Codex CLI   | 本地会话日志                                      | ⏸ 框架（`#[allow(dead_code)]`）             |
| Gemini CLI  | 本地会话日志                                      | ⏸ 框架                                    |
| OpenCode    | 本地会话日志                                      | ⏸ 框架                                    |
| Antigravity | 本地会话日志                                      | ⏸ 框架                                    |

#### 3.8.4 IPC 命令 ✅

- `cost::{get_session_cost, get_profile_cost, get_global_cost, list_pricing, update_pricing, scan_costs, poll_costs}`

#### 3.8.5 事件 ✅

- `cost:updated` — 轮询后向所有订阅者广播增量更新

#### 3.8.6 UI 组件 ✅

- `CostDashboard` — 全局费用仪表板（骨架）
- `PricingConfigPanel` — 模型单价配置

### 3.9 系统集成

#### 3.9.1 系统托盘 ✅

- 启动时创建托盘（`tray::create_tray`）
- 菜单项：显示窗口 / 关于 / 退出
- 点击行为：左键单击 → 切换窗口显隐；右键 → 弹出菜单

#### 3.9.2 关闭窗口行为 ✅

- IPC：`system::{set_close_behavior, get_close_behavior}`
- 默认行为：关闭窗口 → 隐藏至托盘（通过 `WindowEvent::CloseRequested` 拦截 + `api.prevent_close()`）
- 配置项：直接退出 / 最小化到托盘 / 询问

#### 3.9.3 开机自启 ✅

- IPC：`system::{is_autostart_enabled, set_autostart_enabled}`

#### 3.9.4 系统字体 ✅

- IPC：`system_fonts::list_system_fonts`
- 用途：`TerminalSettingsPage` 让用户选择终端字体

#### 3.9.5 文件管理器 / 外部终端 ✅

- IPC：`system::{open_path_in_file_manager, open_terminal}`
- 触发位置：标签右键菜单 / 会话卡片右键菜单

### 3.11 新手引导

#### 3.11.1 OnboardingFlow ✅

- 首次启动时触发
- 流程：用户协议 → 核心功能引导（云端同步 / 项目管理 / 会话）
- localStorage key：`teacoder_onboarding_completed` / `teacoder_agreement_accepted`

### 3.12 快捷命令（QuickCommands）

> v0.1.0 引入的轻量级快捷操作面板。

- 组件：`QuickCommands` + `QuickCommandsEditor`
- 用途：常用命令模板 / 自定义命令面板

### 3.13 主题与样式

- 主题：浅色 / 深色 / 跟随系统（`GeneralSettingsPage`）
- AntD 主题：通过 ConfigProvider 配置
- 字体大小：`appStore.ts:fontSize`（应用级 KV）
- 终端字体：`TerminalSettingsPage`

---

## 4. 数据模型

### 4.1 SQLite Schema 版本

v0.1.0 当前已发布 12 个 schema 版本（迁移脚本位于 `src-tauri/migrations/`）：

| 版本  | 内容                                                                                                |
| --- | ------------------------------------------------------------------------------------------------- |
| v1  | 初始表：`schema_version` / `profiles` / `cli_tools` / `session_costs` / `pricing_config` / `settings` |
| v2  | `tool_settings`（per-tool 配置）                                                                      |
| v3  | `projects` + `sessions`                                                                           |
| v4  | `sessions.cli_session_id`（CLI 工具内部 session ID，用于 `--resume`）                                      |
| v5  | `session_categories`（项目内二级分组）                                                                     |
| v6  | `session_messages`（用户手动记录的消息）                                                                     |
| v7  | `app_settings`（应用级 KV）                                                                            |
| v8  | `llm_providers`（多供应商系统）                                                                           |
| v9  | `llm_providers.is_default`（全局默认供应商标记）                                                             |
| v10 | `llm_providers.auth_type`                                                                         |
| v11 | `llm_providers.api_key`（Base64 编码）                                                                |
| v12 | `llm_providers.oauth_token`（Base64 编码）                                                            |

### 4.2 关键表字段

**profiles**

```sql
CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tool_type TEXT NOT NULL,           -- claude | codex | gemini | opencode | antigravity | terminal | ssh
    auth_type TEXT NOT NULL,           -- api_key | oauth
    base_url TEXT,
    app_data_root TEXT,                -- Claude Code 隔离目录
    color TEXT,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
    -- 凭据存于系统 Keychain,不在此表
);
```

**sessions**

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    category_id TEXT,                  -- 可选
    title TEXT,
    tool_type TEXT NOT NULL,
    profile_id TEXT,
    llm_provider_id TEXT,              -- v0.1.0 新增:绑定的 LLM Provider
    model_name TEXT,                   -- v0.1.0 新增:模型名
    claude_models TEXT,                 -- JSON:sonnet/opus/haiku 子模型
    thinking_intensity TEXT,           -- 思考强度
    template_id TEXT,                   -- 模板
    cli_args TEXT,                     -- CLI 参数
    env_vars TEXT,                      -- JSON 序列化
    color TEXT,
    is_running INTEGER NOT NULL DEFAULT 0,
    cli_session_id TEXT,               -- CLI 工具自身的 session UUID(用于 --resume)
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    closed_at INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

**llm_providers**（v0.1.0 新增）

```sql
CREATE TABLE llm_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider_kind TEXT NOT NULL,       -- anthropic | openai | google | custom
    auth_type TEXT,                    -- api_key | oauth
    base_url TEXT,
    icon TEXT,
    color TEXT,
    is_preset INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    is_default INTEGER NOT NULL DEFAULT 0,
    api_key TEXT,                      -- Base64 编码
    oauth_token TEXT,                  -- Base64 编码
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
-- models 子表未在此处列出,见 storage 模块
```

### 4.3 持久化（前端）

- `teacoder_panes_layout`（version=2）：JSON，存 `{panes, activePaneId}`（全量 panes，不去重）
- `teacoder_open_tabs`：兼容旧版扁平列表（v2 中已被清空）
- `teacoder_sidebar_collapsed`：侧边栏折叠状态

### 4.4 JSONL 用途

- CLI 工具自身的 JSONL 会话记录保持原样（TeaCoder 只读不写）
- TeaCoder 自身审计日志暂未启用（v0.1.0 未生成 `~/.teacoder/logs/audit.jsonl`）

---

## 5. Tauri IPC 命令（v0.1.0 完整清单）

### 5.1 CLI 工具管理

```typescript
detect_cli_tools(): Promise<CliTool[]>
```

### 5.2 PTY 管理

```typescript
start_session(params: StartSessionParams): Promise<void>
stop_session(tabId: string): Promise<void>
write_to_pty(tabId: string, data: string): Promise<void>
resize_pty(tabId: string, cols: number, rows: number): Promise<void>
test_ssh_connection(params: SshTestParams): Promise<string>
```

### 5.3 Profile 管理

```typescript
list_profiles(toolType?: ToolType): Promise<Profile[]>
create_profile(profile: Omit<Profile, "id" | "createdAt" | "updatedAt">): Promise<Profile>
update_profile(id: string, updates: Partial<Profile>): Promise<Profile>
delete_profile(id: string): Promise<void>
get_profile_credential(profileId: string, keyName: string): Promise<string | null>
```

### 5.5 Project / Session / Category / Message

```typescript
project_list(): Promise<Project[]>
project_create(input: ...): Promise<Project>
project_update(id: string, updates: ...): Promise<Project>
project_delete(id: string): Promise<void>

session_list(): Promise<Session[]>
session_create(input: ...): Promise<Session>
session_update(id: string, updates: Partial<Session>): Promise<Session>
session_delete(id: string): Promise<void>
claude_jsonl_exists(sessionId: string): Promise<boolean>

category_list(projectId: string): Promise<SessionCategory[]>
category_create(input: ...): Promise<SessionCategory>
category_update(id: string, updates: ...): Promise<SessionCategory>
category_delete(id: string): Promise<void>

session_message_list(sessionId: string): Promise<SessionMessage[]>
session_message_create(input: ...): Promise<SessionMessage>
session_message_delete(id: string): Promise<void>
```

### 5.6 LLM Provider

```typescript
llm_provider_list(): Promise<LlmProvider[]>
llm_provider_get(id: string): Promise<LlmProvider | null>
llm_provider_create(input: CreateLlmProviderInput): Promise<LlmProvider>
llm_provider_update(id: string, input: UpdateLlmProviderInput): Promise<LlmProvider>
llm_provider_delete(id: string): Promise<void>           // 软删除
llm_provider_hard_delete(id: string): Promise<void>     // 硬删除
llm_provider_set_default_model(providerId: string, model: string): Promise<void>
llm_provider_set_default_provider(providerId: string): Promise<void>
llm_provider_has_api_key(providerId: string): Promise<boolean>
llm_provider_get_api_key(providerId: string): Promise<string | null>
llm_provider_list_presets(): Promise<PresetProviderView[]>
```

### 5.7 Tool Settings

```typescript
get_tool_settings(toolType: ToolType): Promise<ToolSettings>
upsert_tool_settings(toolType: ToolType, settings: ToolSettings): Promise<void>
delete_tool_settings(toolType: ToolType): Promise<void>
```

### 5.8 费用追踪

```typescript
get_session_cost(sessionId: string): Promise<SessionCost>
get_profile_cost(profileId: string, range?: TimeRange): Promise<CostSummary>
get_global_cost(range?: TimeRange): Promise<CostSummary>
list_pricing(): Promise<PricingConfig[]>
update_pricing(model: string, config: Partial<PricingConfig>): Promise<void>
scan_costs(): Promise<void>             // 全量扫描
poll_costs(): Promise<void>            // 增量轮询
```

### 5.9 系统集成

```typescript
is_autostart_enabled(): Promise<boolean>
set_autostart_enabled(enabled: boolean): Promise<void>
set_close_behavior(behavior: "exit" | "tray" | "ask"): Promise<void>
get_close_behavior(): Promise<string>
set_tray_visible(visible: boolean): Promise<void>
open_path_in_file_manager(path: string): Promise<void>
open_terminal(path: string): Promise<void>
list_system_fonts(): Promise<FontInfo[]>
```

### 5.10 事件（后端 → 前端）

```typescript
on("pty:output", (payload: { tabId: string; data: string }) => void)
on("pty:exit", (payload: { tabId: string; exitCode: number }) => void)
on("cost:updated", (payload: { sessionId: string; cost: SessionCost }) => void)
```

---

## 6. 前端界面需求

### 6.1 主窗口布局

```
┌──────────────────────────────────────────────────────────────┐
│  顶部栏：Logo | 全局操作 | 设置                               │
├──────────┬───────────────────────────────────────────────────┤
│          │  Pane 1: TabBar | xterm 终端                       │
│          ├───────────────────────────────────────────────────┤
│  侧边栏  │                                                   │
│          │  Pane 2: TabBar | xterm 终端（分屏时存在）         │
│  - 项目  │                                                   │
│    - 分类├───────────────────────────────────────────────────┤
│      - 会│                                                   │
│  - 收藏  │                                                   │
│  + 新建  │                                                   │
│          ├───────────────────────────────────────────────────┤
│          │  状态栏：工具 | Profile | Provider | 模型 | Token  │
└──────────┴───────────────────────────────────────────────────┘
```

### 6.2 侧边栏

- 项目树（Project → SessionCategory → Session 三层）
- 收藏区（`favoriteTabs`，置顶）
- 新建项目 / 新建分类 / 新建会话按钮
- 折叠状态：`collapsedCategoryIds` / `collapsedProjectIds` / `sidebarCollapsed`

### 6.3 终端区域

- 组件：`TerminalView` + `PaneView` + `PaneSplitter`
- 功能：
  - xterm.js + xterm-addon-fit
  - ANSI 颜色
  - 复制粘贴（Cmd+Shift+C / Cmd+Shift+V；macOS / Win-Linux 平台差异自动识别）
  - 全局快捷键：Ctrl+Shift+C / Ctrl+Shift+V（在 AppContent 层注册）
- 分屏双开时只有 activePane 接收输入（`enableInput` 透传）

### 6.4 状态栏

- 工具类型图标 + 名称
- Profile 名称（点击切换）
- LLM Provider + 模型名称
- Token 统计（输入/输出/缓存/估算费用）—— 通过 `cost:updated` 事件更新

### 6.5 新建会话对话框

- `NewSessionModal`：工具选择 / Profile 选择 / LLM Provider + 模型选择 / 工作目录 / 模板应用 / 标题 / 颜色 / CLI 参数 / 环境变量
- 快捷创建：记忆上次配置，下次默认填充

### 6.6 编辑会话对话框

- `EditSessionModal`：标题 / 颜色 / 分类 / 模型切换 / Profile 切换（运行时切换需重启 CLI）

### 6.7 设置（18 个页面）

通过 `SettingsPage` 左侧菜单路由：

| Key                | 标签             | 组件                            |
| ------------------ | -------------- | ----------------------------- |
| general            | 通用设置           | `GeneralSettingsPage`         |
| terminal           | 终端设置           | `TerminalSettingsPage`        |
| llm-providers      | LLM 设置         | `LlmProvidersPage`            |
| claude             | Claude 设置      | `ClaudeSettingsPage`          |
| codex              | Codex 设置       | `CodexSettingsPage`           |
| gemini             | Gemini 设置      | `GeminiSettingsPage`          |
| antigravity        | Antigravity 设置 | `AntigravitySettingsPage`     |
| opencode           | OpenCode 设置    | `OpenCodeSettingsPage`        |
| network            | 网络设置           | `NetworkSettingsPage`         |
| notification       | 通知             | `NotificationPage`            |
| data-management    | 数据管理           | `DataManagementPage`          |
| about              | 关于             | `AboutPage`                   |
| profile-management | Profile 管理     | `ProfileManagementPage`       |
| keybindings        | 快捷键            | `KeybindingsPage`             |
| mcp-access         | MCP 访问         | `McpAccessPage`（v0.1.0 入口）    |
| sync               | 同步             | `SyncPage`（v0.1.0 入口）         |
| remote-access      | 远程访问           | `RemoteAccessPage`（v0.1.0 入口） |
| ai-assistant       | AI 助手          | `AIAssistantPage`             |

### 6.8 主题

- 浅色 / 深色 / 跟随系统
- Ant Design 通过 ConfigProvider 配置
- TailwindCSS 通过 CSS 变量适配

### 6.9 新手引导

- `OnboardingFlow`：协议 + 引导
- 重新触发入口：设置 → 关于 → "重新查看引导"

---

## 7. 非功能需求

### 7.1 性能指标（v0.1.0 验收）

| 指标          | 目标       |
| ----------- | -------- |
| 冷启动         | < 2 秒    |
| CLI 工具检测    | < 3 秒    |
| PTY 输出延迟    | < 50 ms  |
| SQLite 查询响应 | < 100 ms |
| 空闲内存        | < 200 MB |
| 单会话运行内存     | < 400 MB |

### 7.2 安全

- API Key / OAuth Token 凭据分层存储：
  - Profile → 系统 Keychain（`keyring` crate）
  - LlmProvider → SQLite（Base64 编码）—— 出错权衡见 §3.4.4
- 导出时脱敏：Profile 导出时 API Key 必须脱敏
- 日志中 API Key / Token 全部脱敏（显示 `sk-***...`）
- PTY 直通：不拦截、不代理 CLI API 请求

### 7.3 可靠性

- PTY 进程异常退出：前端通过 `pty:exit` 事件收到，状态自动更新（`isRunning=false`）
- SQLite 操作：使用 `transaction` 确保原子性
- 双开关闭：refcount 语义（实例归零才停 PTY）
- 应用重启：恢复标签页 / 分屏布局（不含终端内容）
- Schema 版本化：12 个版本已成功迁移，从 v1 开始建立

### 7.4 跨平台

- 支持 Windows 10+ / macOS 11+ / Ubuntu 20.04+ / 其他 Linux（AppImage）
- 路径处理使用 Rust `PathBuf`，不硬编码 `/` 或 `\`
- 文件操作使用 `std::fs`，不 shell out 到 `cp`/`rm`/`mv`

### 7.5 UI 一致性

- 风格：Ant Design 6 + TailwindCSS 4 互补（AntD 提供组件、Tailwind 处理布局）
- 关闭 Tab：直接关闭，无确认框（v0.1.0 调整）
- 删除会话记录：保留确认框（不可恢复操作）

---

## 8. 开发任务拆解（v0.1.0 状态）

### 阶段 1：项目脚手架 ✅

- [x] Tauri 2.x 项目初始化
- [x] 集成 React 19 + TypeScript + Vite
- [x] 集成 Ant Design 6 + TailwindCSS 4（`preflight: false`）
- [x] 集成 Zustand 状态管理
- [x] SQLite schema 迁移机制（已 12 个版本）
- [x] 基础布局（顶部栏 / 侧边栏 / 主区域 / 状态栏）

### 阶段 2：CLI 工具检测与管理 ✅

- [x] `cli/detector.rs`：4+ 个 CLI 工具检测
- [x] `commands/cli.rs`：`detect_cli_tools` IPC
- [x] 前端 CLI 工具列表 UI、重新检测按钮

### 阶段 3：PTY 终端核心 ✅

- [x] `pty/manager.rs`：PTY 会话管理（创建 / 销毁 / 输入输出 / 共享 PTY）
- [x] `portable-pty` 集成
- [x] `commands/pty.rs`：`start_session`（幂等）/ `stop_session` / `write_to_pty` / `resize_pty` / `test_ssh_connection`
- [x] 事件：`pty:output` / `pty:exit`
- [x] 前端 xterm.js 集成 + 分屏双开

### 阶段 4：多标签 + 多分屏 ✅

- [x] Zustand store（panes / openTabIds / activePaneId / splitRatio）
- [x] 标签页 UI（新建 / 关闭 / 切换 / 拖拽 / 跨 pane 拖拽）
- [x] 快捷键：Ctrl+T / Ctrl+W / Ctrl+Tab / Ctrl+P
- [x] 持久化 `teacoder_panes_layout`（version=2）
- [x] 分屏（PaneView / PaneSplitter / 共享 PTY）
- [x] 会话搜索（Ctrl+P → `SearchPanel`）

### 阶段 5：Profile 管理 ✅

- [x] `profile/mod.rs`：Profile CRUD
- [x] `crypto/keychain.rs`：系统 Keychain
- [x] 多实例数据隔离（Claude Code 的 `CLAUDE_CONFIG_DIR`）
- [x] 前端 Profile 管理界面 + Profile 选择器
- [x] **LLM 供应商系统**（v0.1.0 新增）：多 provider + 多 model + Base64 凭据

### 阶段 6：Token 费用追踪 ⚠️

- [x] `cost/provider.rs`：CostProvider trait
- [x] `cost/claude.rs`：完整实现
- [ ] `cost/codex.rs` / `gemini.rs` / `opencode.rs`：v0.1.0 框架（`#[allow(dead_code)]`），v0.2 补全
- [ ] Antigravity Provider：v0.2 新增
- [x] 轮询 / 扫描 IPC + `cost:updated` 事件
- [x] 前端：`CostDashboard` / `PricingConfigPanel`

### 阶段 7：系统集成 ✅

- [x] 系统托盘（`tray.rs`）
- [x] 关闭行为配置（`system::{get,set}_close_behavior`）
- [x] 开机自启（`system::{is,set}_autostart_enabled`）
- [x] 系统字体（`system_fonts::list_system_fonts`）
- [x] 打开文件管理器 / 外部终端

### 阶段 8：设置界面 ✅

- [x] 18 个设置页面（详见 §6.7）
- [x] 应用级设置 + per-tool 设置分层

### 阶段 9：打磨与打包 ⚠️

- [x] 主题切换（浅色 / 深色 / 跟随系统）
- [x] 错误处理与用户提示
- [x] 应用图标重生成（2026-10-20）
- [ ] 三平台打包测试：Windows / macOS / Linux 实际未完整跑过全平台打包流水线

---

## 9. 验收标准（v0.1.0 状态）

### 9.1 功能验收

- [x] 能检测到系统已安装的 Claude Code / Codex / Gemini / OpenCode，并显示版本
- [x] 能新建标签页启动任一 CLI 工具，终端正常交互
- [x] 能创建多个 Profile，Profile 凭据加密存储于系统 Keychain
- [x] 能创建多个 LLM Provider 并切换使用
- [x] Claude Code 会话结束后，能正确统计 Token 数量与费用（其他工具 v0.2）
- [x] 运行中的会话，状态栏 Token 数通过 `cost:updated` 事件更新
- [x] 应用重启后，标签页 / 分屏布局能恢复
- [x] 同会话可在两个 pane 双开，共享 PTY，输入不被双触发
- [x] SSH 会话可启动（密码型自动 askpass）
- [x] 关闭 Tab 直接关闭，无确认

### 9.2 非功能验收

- [x] 冷启动 < 2 秒（本地测试通过）
- [x] API Key 不在 SQLite 中以明文存储（Profile Keychain / LlmProvider Base64）
- [x] 日志中 API Key 全部脱敏
- [x] SQLite 操作使用事务
- [x] Schema 版本化迁移（v1 → v12 已成功）

---

## 10. 未纳入 v0.1.0 的功能（明确边界）

以下功能在 v0.1.0 中**不实现**或仅提供骨架入口：

### v0.2 待实现

- Codex / Gemini / OpenCode / Antigravity 的 CostProvider 完整解析
- MCP Server 可视化管理（仅提供 `McpAccessPage` 入口）
- 代码片段库（仅提供 Ctrl+K 入口）
- 思考强度热切换（字段已建，运行中瞬时生效未做）
- 国内厂商端点预设（DeepSeek/智谱/通义/Kimi/硅基流动 已在 LlmProvider 预设中部分覆盖）

### v0.3 远期

- SSH 配置化（v0.1.0 已支持 SSH 会话，v0.2 提供密钥管理面板）
- 云端语音输入
- AI 记忆管理
- 桌面宠物

### v1.0+ 远期

- 工作区编辑器
- 本地 LLM 后端
- Responses ↔ Chat 转换代理

---

## 11. 开发注意事项

1. **PTY 直通**：不拦截 CLI API 请求；Token 统计通过读取本地 JSONL/数据库，非解析 PTY 输出。

2. **CostProvider 可扩展性**：trait 设计要预留扩展性，新增 CLI 工具只需实现 trait；v0.2 补全 codex/gemini/opencode。

3. **凭据分层**：
   
   - Profile 走 Keychain（macOS / Windows 强一致）
   - LlmProvider 走 SQLite Base64（Linux 上避免 keychain 不稳定问题）
   - 两套并行，不互相依赖

4. **PTY 跨平台差异**：`portable-pty` 在 Windows 下行为与 Unix 不同，需充分测试 resize、双开同步。

5. **Ant Design + TailwindCSS 共存**：
   
   - AntD 负责组件、styles、配置
   - Tailwind 仅用于 layout（flex/grid）、spacing（p/m）、自定义样式
   - 禁止 Tailwind 覆盖 AntD 组件样式
   - `preflight: false` 避免基础样式冲突

6. **xterm.js 性能**：
   
   - 大量输出时启用 `scrollback` 限制（建议 10000 行）
   - 分屏双开时只有 activePane 触发 `resizeToPty`（避免 SIGWINCH 风暴）
   - xterm 焦点协议（`ESC [O` / `ESC [?1;2c`）只由 enableInput=true 的实例发送

7. **数据迁移**：schema 版本化从 v1 开始已建立 12 个版本，避免后期迁移痛苦。

8. **提交标签 / commit 信息**：使用中文，格式：`<类型>: <描述>`，如 `feat: 添加 Profile 管理界面`。

9. **关闭 Tab 直接关闭**：v0.1.0 调整——不再弹确认框，避免打断心流。删除会话记录等不可恢复操作仍保留确认框。