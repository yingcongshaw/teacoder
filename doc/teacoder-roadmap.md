# TeaCoder — 功能与技术路线文档

> 本文档记录 TeaCoder 的产品定位、版本规划与技术方案。已实现的版本（v0.1.0）按代码现状描述，未实现的版本（v0.2 / v0.3 / v1.0+）保留方向性规划。
>
> 项目代号：统一为 **TeaCoder**；Tauri `productName`: `teacoder`；包标识符：`com.codingtea.teacoder`。

---

## 一、产品定位

TeaCoder是一款 **AI 编程 CLI 工具的桌面管理客户端**，为 Claude Code / Codex CLI / Gemini CLI / OpenCode / Antigravity / 裸终端 / SSH 提供图形化的 LLM 供应商管理、会话管理、配置管理等"周边设施"。

**核心原则：零额外 Token 开销** — PTY 直通运行 CLI 工具，不拦截/代理 API 请求，不解析 PTY 输出估算 Token（改为读取各 CLI 工具本地 JSONL / 数据库）。

TeaCoder **不提供 AI 模型服务**，仅做"统一管家"，把不同供应商、不同模型、不同账号的管理复杂度收敛到一个桌面 GUI 中。

---

## 二、版本规划

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

### v0.2 — 规划中（增强体验）

| 功能领域 | 优先级 |
| --- | --- |
| **CostProvider 完整覆盖**（Codex / Gemini / OpenCode / Antigravity 解析） | 高 |
| **MCP Server 可视化管理**（图形化添加/启用/禁用 MCP Server，stdio / HTTP / SSE） | 中 |
| **代码片段库**（常用 Prompt 存为片段，模板变量，Ctrl+K 一键插入） | 中 |
| **全局搜索与命令面板**（Ctrl+K 整合内置指令/项目命令/代码片段） | 中 |
| **思考强度热切换**（状态栏 Tag 切换 effort，运行中瞬时生效） | 中 |
| **国内厂商端点支持**（智谱 AI / 通义千问 / Kimi Code / 硅基流动 / DeepSeek 等预设） | 中 |
| **远端 SSH 工作区配置化**（v0.1.0 已支持 SSH 会话，v0.2 提供配置面板与密钥管理） | 中 |

### v0.3 — 远期规划

| 功能领域 |
| --- |
| **云端语音输入**（F2/Alt+X 按住说话，ASR 即时识别，术语词典 + 灵动岛 UI） |
| **AI 记忆管理**（分类持久化项目长期记忆） |
| **桌面宠物**（趣味功能） |

### v1.0+ — 远期规划

| 功能领域 |
| --- |
| **工作区编辑器**（内置文件树、语法高亮编辑器、代码大纲、Git 面板） |
| **本地 LLM 后端**（Ollama / vLLM / LM Studio 预设，探活拉取本地模型列表） |
| **Responses ↔ Chat 转换代理**（为 Codex 内置协议转换代理） |

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
- 已在 `src-tauri/Cargo.toml` 声明 `axum = "0.8"` 依赖（v1.0+ 网关服务预留，v0.1.0 暂未启用监听）

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

### 5. 语音识别：阿里云 DashScope ASR（v0.3）

- 使用 `qwen3-asr-flash` 模型
- 支持提示词术语词典、PTT 去重、灵动岛 Overlay UI

---

## 四、Token 费用追踪方案

### 方案：读取 CLI 本地数据文件（非解析 PTY 输出）

**为什么不用 PTY 输出解析？**

- CLI 输出格式随时可能变动，一更新就导致解析失败
- 不同 CLI 工具输出格式各异，维护成本高
- ANSI 转义码、进度条、流式输出增加解析复杂度

**v0.1.0 实现状态：**

| CLI 工具 | 数据来源 | 解析实现 |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/*/conversation_*.jsonl` 或 Profile 独立目录下同结构 | ✅ 完整（`cost/claude.rs`，walkdir 遍历，逐行解析 JSONL 累计 `message.usage`） |
| Codex CLI | 本地会话日志（具体路径待适配） | ⏸ 框架（`cost/codex.rs`，`#[allow(dead_code)]`，解析逻辑留待 v0.2） |
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