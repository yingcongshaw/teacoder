# TeaCoder — 功能与技术路线文档

> 本文档记录 TeaCoder 的产品定位、版本规划与技术方案。已实现的版本（v0.1.1）按代码现状描述，未实现的版本（v1.0.0）保留方向性规划。
>
> 项目代号：统一为 **TeaCoder**；Tauri `productName`: `teacoder`；包标识符：`com.codingtea.teacoder`。

---

## 一、产品定位

TeaCoder是一款 **AI 编程 CLI 工具的桌面管理客户端**，为 Claude Code / Codex CLI / Gemini CLI / OpenCode / Antigravity / 裸终端 / SSH 提供图形化的 LLM 供应商管理、会话管理、配置管理等"周边设施"。

**核心原则：零额外 Token 开销** — PTY 直通运行 CLI 工具，不拦截/代理 API 请求，不解析 PTY 输出估算 Token（改为读取各 CLI 工具本地 JSONL / 数据库）。

TeaCoder **不提供 AI 模型服务**，仅做"统一管家"，把不同供应商、不同模型、不同账号的管理复杂度收敛到一个桌面 GUI 中。

---

## 二、版本规划

### v0.1.1 — 已发布（补丁版本，2026-10）

> 在 v0.1.0 基础上修复缺陷并补齐打包发布流程，功能范围不变。

| 变更 | 说明 |
| --- | --- |
| **新建 Claude Code 会话直接退出** | 首次启动的安全确认框默认选中「No, exit」，自动注入的 `/rename` 落在框上会让 CLI 退出进程。改为按渲染后的屏幕判定就绪后再注入 |
| **LLM 供应商「显示已停用」开关失效** | store 只拉取启用项，开关打开也没有条目可显示。改为拉取全量，由各消费点按 `isActive` 过滤 |
| **供应商图标名 / 颜色录入** | 图标名改为可从内置模板中选择的下拉（仍可自由输入），颜色改用 hex 取色器 |
| **Windows 交叉编译打包** | 新增 `pnpm build:windows` / `pnpm build:all`，NSIS 工具链离线预置，带 SHA1 校验 |
| **GitHub Actions 发布流程** | 推送 `v*` tag 时并行打包三平台安装包并发布 Release |

### v0.1.0 — 已发布（首版 MVP，2025-2026）

> 核心目标：先做"更好的 AI CLI 终端"，验证产品价值。

v0.1.0 已实现完整覆盖以下领域，每个领域在 `requirements.md` 中有详细功能描述：

| 功能领域 | 状态 |
| --- | --- |
| **多工具终端管理**（claude / codex / gemini / opencode / antigravity / terminal / ssh） | ✅ 已实现 |
| **PTY 直通**（不拦截 API） | ✅ 已实现 |
| **多标签 + 多分屏**（Pane 最多 2 个，共享 PTY 双开） | ✅ 已实现 |
| **会话管理**（Project + Session + SessionCategory + SessionMessage） | ✅ 已实现 |
| **LLM 供应商系统**（多 provider、多 model、API Key / OAuth、Base64 存储） | ✅ 已实现 |
| **Profile**（keychain 凭据、CLAUDE_CONFIG_DIR 隔离） | ✅ 已实现 |
| **Token 费用追踪**（Claude Code 完整，其他工具框架） | ✅ 已实现（Claude 完整） |
| **会话搜索**（Ctrl+P） | ✅ 已实现 |
| **托盘 + 关闭行为配置** | ✅ 已实现 |
| **开机自启 / 系统字体** | ✅ 已实现 |
| **新手引导**（OnboardingFlow） | ✅ 已实现 |
| **主题/字体/快捷键/通知/远程/MCP 入口**等设置项骨架 | ✅ 已实现骨架 |

具体实现明细参见 `requirements.md`。

### v1.0.0（规划）

- **Token 中转代理**
- **SaaS 认证和授权**
- **代理开发数字人**
- **代理测试**
- **托管智能运维**

---

## 三、技术路线与方案

### 核心原则

- **本地优先架构**：SQLite + JSONL 全本机存储，零服务端依赖
- **PTY 直通设计**：不拦截/代理 API 请求，零额外 Token 消耗
- **数据读取而非解析**：Token 统计通过读取 CLI 工具本地 JSONL/数据库
- **凭据分层存储**：Profile 的 API Key/OAuth 走系统 Keychain；LlmProvider 的 Key / Token 走 SQLite（Base64 编码）——出于 Linux 跨平台稳定性考虑（Linux 上 keychain 体验不稳）

### 1. 桌面端框架：Tauri 2.x

- Rust 后端 + WebView 前端
- 包体较小（~200MB 含 WebView 运行时）
- 跨平台：Windows `.exe` (NSIS)、macOS `.dmg`、Ubuntu `.deb`、其他 Linux `.AppImage`
- 已在 `src-tauri/Cargo.toml` 声明 `axum = "0.8"` 依赖（v1.0.0 网关服务预留，v0.1.0 暂未启用监听）

### 2. 前端：React 19 + TypeScript + Ant Design 6 + TailwindCSS 4

- Tauri IPC 通信（`@tauri-apps/api` 的 `invoke` / `listen`）
- Ant Design 6 提供企业级组件；TailwindCSS 4 仅处理布局/间距/自定义样式
- 样式冲突处理：TailwindCSS `preflight: false`（避免覆盖 AntD 基础样式）

### 3. 后端/Rust 侧

- 异步运行时 `tokio`（feature = `full`）
- PTY：`portable-pty = "0.8"`
- 数据库：`rusqlite = "0.35"`（bundled，不依赖系统 SQLite）
- 序列化：`serde + serde_json`
- 错误类型：`thiserror = "2"`
- ID 生成：`uuid = "1"`（v4）
- 时间处理：`chrono = "0.4"`
- 凭据：`keyring = "3"`（Profile 的 Keychain）+ `base64` 编码（LlmProvider 备用）

### 4. 文档站：VitePress（远期）

- 标准路径结构：`/guide/`、`/features/`、`/mobile/`
- Ctrl+K 搜索、暗色主题、sidebar 导航

---

## 四、Token 费用追踪方案

### 方案：读取 CLI 本地数据文件（非解析 PTY 输出）

**为什么不用 PTY 输出解析？**

- CLI 输出格式随时可能变动，一更新就导致解析失败
- 不同 CLI 工具输出格式各异，维护成本高
- ANSI 转义码、进度条、流式输出增加解析复杂度

**v0.1.1 实现状态：**

| CLI 工具 | 数据来源 | 解析实现 |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/*/conversation_*.jsonl` 或 Profile 独立目录下同结构 | ✅ 完整（`cost/claude.rs`，walkdir 遍历，逐行解析 JSONL 累计 `message.usage`） |
| Codex CLI | 本地会话日志（具体路径待适配） | ⏸ 框架（`cost/codex.rs`，`#[allow(dead_code)]`，解析逻辑待实现） |
| Gemini CLI | 本地会话日志 | ⏸ 框架 |
| OpenCode | 本地会话日志 | ⏸ 框架 |
| Antigravity | 本地会话日志 | ⏸ 框架 |

**读取策略：**

- 后端 IPC：`commands::cost::{scan_costs, poll_costs}` 提供扫描与轮询
- 会话结束后（PTY 进程退出）读取完整数据文件
- 定时轮询（如每 30s）读取增量数据
- 事件：`cost:updated` 广播给前端，刷新状态栏/费用仪表板

### CostProvider trait（v0.1.0）

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

每个 CLI 工具独立实现该 trait，新增工具只需实现 trait，不改动核心逻辑。

---

## 五、技术架构总览

```
┌──────────────────────────────────────────────────────┐
│                   TeaCoder 桌面端                  │
│                                                       │
│  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │   React 19 + TS      │  │   Rust (Tauri 2.x)   │  │
│  │   Ant Design 6       │  │                       │  │
│  │   TailwindCSS 4      │◄─┤  PTY 终端管理        │  │
│  │   WebView (前端)     │  │  SQLite + JSONL 存储  │  │
│  │                       │  │  CostProvider 费用读取 │  │
│  │   Pane 分屏          │  │  Keychain 凭据       │  │
│  │   (共享 PTY 双开)     │  │  LlmProvider 管理    │  │
│  └──────────────────────┘  │  Profile 管理         │  │
│         ▲ Tauri IPC        │  Project/Session       │ │
│         │  (pty:output,   │  SessionCategory       │ │
│         │   pty:exit,     │  SessionMessage        │ │
│         │   cost:updated) │  ToolSettings          │ │
│         ▼                  │  托盘 + 系统设置       │ │
│  ┌──────────────────────┐  └──────────────────────┘  │
│  │   CLI 工具 (PTY)     │                              │
│  │   Claude Code        │                              │
│  │   Codex CLI          │                              │
│  │   Gemini CLI         │                              │
│  │   OpenCode           │                              │
│  │   Antigravity        │                              │
│  │   裸终端 (terminal)  │                              │
│  │   SSH (ssh, askpass) │                              │
│  └──────────────────────┘                              │
└──────────────────────────────────────────────────────┘
```

---

## 六、已知风险与应对

| 风险 | 应对策略 |
| --- | --- |
| CLI 工具输出格式/数据结构频繁变动 | CostProvider trait 抽象层，每个 CLI 独立解析，变动只改对应 Provider |
| 多账号隔离需逐个 CLI 适配 | v0.1.0 先支持 Claude Code 的 `CLAUDE_CONFIG_DIR` 隔离，其他工具逐步适配 |
| API Key 存储安全（Linux Keychain 不稳定） | Profile 仍走系统 Keychain（macOS/Windows 强一致）；同时引入 LlmProvider 走 Base64 编码 SQLite 备用 |
| Tauri Mobile iOS 不成熟 | 暂不纳入规划，专注 Android + 桌面端 |
| 分屏双开 PTY 同步抖动 | v0.1.0 实现共享 PTY 语义（一个 PtyEntry / 多个 xterm），后续版本继续打磨同步延迟 |

---

## 七、可持续性

- **开源核心**：v0.1.0 核心功能完全开源，建立社区
- **赞助模式**：GitHub Sponsors / 爱发电，服务深度用户