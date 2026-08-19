# 茶码 TeaCoder — 功能与技术路线文档

## 一、产品定位

茶码 TeaCoder 是一款 **AI 编程 CLI 工具的桌面管理客户端**，定位为 Claude Code / Codex CLI / Gemini CLI / OpenCode 的"统一管家"。它不提供 AI 模型服务，而是为这些 CLI 工具提供图形化的会话管理、账号管理、费用追踪、配置管理等"周边设施"，核心原则是**零额外 Token 开销**。

---

## 二、版本规划

### v0.1 — 最小可用版本（MVP）

> 核心目标：先做"更好的 AI CLI 终端"，验证产品价值

| 功能领域              | 具体功能                                                            |
| ----------------- | --------------------------------------------------------------- |
| **多工具终端管理**       | 自动检测已安装的 CLI 工具及版本，一键启动 Claude Code / Codex / Gemini / OpenCode |
| **多标签会话管理**       | 浏览器式标签页，按项目分组、收藏、模糊搜索                                           |
| **账号/Profile 切换** | 多套 API Key / OAuth 配置一键切换，数据隔离（`app_data_root` 独立）              |
| **Token 费用追踪**    | 读取 CLI 工具本地数据文件（JSONL/数据库）统计用量，非解析 PTY 输出                       |
| **内置浏览器**         | 分屏预览网页应用，全局单窗多标签 + 代理模式                                         |

### v0.2 — 增强体验

| 功能领域                 | 具体功能                                          |
| -------------------- | --------------------------------------------- |
| **MCP Server 可视化管理** | 图形化添加/启用/禁用 MCP Server，支持 Stdio/HTTP/SSE      |
| **代码片段库**            | 常用 Prompt 存为片段，支持模板变量，Ctrl+K 一键插入             |
| **全局搜索与命令面板**        | 所有历史会话搜索，Ctrl+K 整合内置指令/项目命令/代码片段              |
| **WebDAV 云同步**       | 选择性同步设置/Profile/片段，走用户自己的网盘                   |
| **思考强度热切换**          | 状态栏 Tag 一键切换 effort 等级，运行中瞬时生效                |
| **国内厂商端点支持**         | DeepSeek / 智谱 AI / 通义千问 / Kimi Code / 硅基流动等预设 |

### v0.3 — 高级功能

| 功能领域            | 具体功能                                            |
| --------------- | ----------------------------------------------- |
| **SSH 远程工作区**   | 通过 SSH 连接远端服务器运行 AI 工具，配置按工作区隔离                 |
| **云端语音输入**      | 按住 F2/Alt+X 说话，DashScope ASR 即时识别，术语词典 + 灵动岛 UI |
| **AI 记忆管理**     | 分类持久化项目长期记忆                                     |
| **Token 费用仪表板** | 每日趋势图、月度仪表板、180 天热力图、预算告警                       |
| **桌面宠物**        | 趣味功能                                            |

### v1.0+ — 远期规划

| 功能领域                      | 具体功能                                    |
| ------------------------- | --------------------------------------- |
| **移动端伴侣 (Android)**       | 手机远程查看 AI 实时输出、补发指令、设备配对                |
| **工作区编辑器**                | 内置文件树、语法高亮编辑器、代码大纲、Git 面板               |
| **本地 LLM 后端**             | Ollama / vLLM / LM Studio 预设，探活拉取本地模型列表 |
| **Responses ↔ Chat 转换代理** | 为 Codex 内置协议转换代理，让 Chat-only 上游无缝接入     |

---

## 三、技术路线与方案

### 核心原则

- **本地优先架构**：SQLite + JSONL 全本机存储，零服务端依赖，隐私友好
- **PTY 直通设计**：不拦截/代理 API 请求，零额外 Token 消耗
- **数据读取而非解析**：Token 统计通过读取 CLI 工具本地数据文件，而非解析 PTY 输出流

### 1. 桌面端框架：Tauri 2.x

- Rust 后端性能好、包体小（~200MB 含 WebView 运行时）
- 跨平台：Windows `.exe` (NSIS)、macOS `.dmg`、Ubuntu `.deb`、其他 Linux `.AppImage`

### 2. 前端：React 19 + TypeScript + Ant Design 6 + TailwindCSS 4

- WebView 前端与 Rust 后端通过 Tauri IPC 通信
- Ant Design 6 提供企业级组件，TailwindCSS 4 处理布局与自定义样式
- 样式冲突处理：Ant Design 负责 UI 组件，TailwindCSS 仅用于布局/间距/自定义样式，避免类名冲突

### 3. 后端/Rust 侧：axum HTTP/WS 网关 + PTY 管理 + SQLite

- 桌面端内置 `axum` 网关，监听 `127.0.0.1:49999`（仅本地回环，不暴露外部）
- 手机端通过 HTTPS/WSS 连接该网关（v1.0+）
- 内置真实 PTY 伪终端运行 CLI 工具（非拦截/代理模式）
- 数据存储：SQLite + JSONL
- OAuth 凭据加密存储（`enc:v1:` 前缀）
- 多实例通过 `app_data_root + dev_suffix` 实现数据隔离
- 数据库 schema 版本化

### 4. 移动端：Tauri Mobile（v1.0+ 远期）

- React SPA in Tauri Mobile WebView
- Android APK + AAB 格式
- 通过 REST API + WebSocket 接收 PTY 实时输出
- 注意：Tauri Mobile iOS 仍不成熟，暂不纳入规划

### 5. 文档站：VitePress

- 标准路径结构：`/guide/`、`/features/`、`/mobile/`
- Ctrl+K 搜索、暗色主题、sidebar 导航

### 6. 语音识别：阿里云 DashScope ASR（v0.3）

- 使用 `qwen3-asr-flash` 模型
- 支持提示词术语词典、PTT 去重、灵动岛 Overlay UI

### 7. 同步方案：WebDAV（v0.2）

- 支持用户自有的 Nextcloud / 坚果云 / NAS
- 选择性同步，默认不同步凭据

---

## 四、Token 费用追踪方案

> 这是核心功能，需要特别说明技术方案

### 方案：读取 CLI 本地数据文件（非解析 PTY 输出）

**为什么不用 PTY 输出解析？**

- CLI 输出格式随时可能变动，一更新就导致解析失败
- 不同 CLI 工具输出格式各异，维护成本高
- ANSI 转义码、进度条、流式输出增加解析复杂度

**具体实现：**

| CLI 工具      | 数据来源                                        | 说明                                 |
| ----------- | ------------------------------------------- | ---------------------------------- |
| Claude Code | `~/.claude/projects/*/conversation_*.jsonl` | 会话记录包含 input/output/cache token 统计 |
| Codex CLI   | 本地会话日志                                      | 需适配其存储格式                           |
| Gemini CLI  | 本地会话日志                                      | 需适配其存储格式                           |
| OpenCode    | 本地会话日志                                      | 需适配其存储格式                           |

**读取策略：**

- 会话结束后（CLI 进程退出）读取完整数据文件
- 定时轮询（如每 30s）读取增量数据，用于近似实时统计
- 每个 CLI 工具实现一个 `CostProvider` trait，隔离数据解析逻辑

---

## 五、技术架构总览

```
┌─────────────────────────────────────────────────────┐
│                   茶码 TeaCoder 桌面端               │
│                                                       │
│  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │   React 19 + TS      │  │   Rust (Tauri 2.x)   │  │
│  │   Ant Design 6       │  │                       │  │
│  │   TailwindCSS 4      │◄─┤─ axum HTTP/WS 网关    │  │
│  │   WebView (前端)     │  │─ PTY 终端管理         │  │
│  │                       │  │─ SQLite + JSONL 存储  │  │
│  └──────────────────────┘  │─ CostProvider 费用读取 │  │
│         ▲ Tauri IPC        │─ 多实例数据隔离       │  │
│         ▼                  │─ 加密凭据管理         │  │
│  ┌──────────────────────┐  │─ WebDAV 同步 (v0.2)  │  │
│  │   CLI 工具 (PTY)     │  └──────────────────────┘  │
│  │   Claude Code        │         ▲                  │
│  │   Codex CLI          │         │ WSS/HTTPS        │
│  │   Gemini CLI         │         │ (v1.0+)          │
│  │   OpenCode           │         │                  │
│  └──────────────────────┘         │                  │
│                                    │                  │
└────────────────────────────────────┼──────────────────┘
                                     │
                            ┌────────▼────────┐
                            │  移动端伴侣      │
                            │  React SPA       │
                            │  (Tauri Mobile   │
                            │   WebView)       │
                            │  Android APK/AAB │
                            │  (v1.0+ 远期)    │
                            └─────────────────┘
```

---

## 六、已知风险与应对

| 风险                   | 应对策略                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| CLI 工具输出格式/数据结构频繁变动  | CostProvider trait 抽象层，每个 CLI 独立适配，变动时只改对应 Provider                           |
| 多账号隔离需逐个 CLI 适配      | v0.1 先只支持 Claude Code 的 `app_data_root` 隔离，其他工具逐步适配                           |
| axum 本地服务安全风险        | 仅监听 127.0.0.1，移动端连接需设备配对 + 鉴权熔断                                               |
| API Key 存储安全         | 使用系统 Keychain（macOS）/ Credential Manager（Windows）/ Secret Service（Linux），加密存储 |
| Tauri Mobile iOS 不成熟 | 暂不纳入规划，专注 Android + 桌面端                                                       |

---

## 七、可持续性

- **开源核心**：v0.1 核心功能完全开源，建立社区
- **高级功能付费**：Token 分析仪表板、云同步、移动端伴侣等高级功能考虑付费
- **赞助模式**：GitHub Sponsors / 爱发电，服务深度用户
