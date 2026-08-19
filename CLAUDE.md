# CLAUDE.md — 茶码 TeaCoder 项目指导

> 本文件是 Claude Code 的项目级指导文件，所有开发任务必须严格遵守本文件中的约束和规范。

## ⚠️ 重要：语言要求

**必须使用中文**与用户进行交流

- 所有响应、解释、错误信息、技术讨论都必须使用简体中文
- 代码注释、文档、提交信息都应使用中文
- 仅在代码本身（变量名、函数名、类名）中使用英文

## 项目概述

茶码 TeaCoder 是一款 AI 编程 CLI 工具的桌面管理客户端（Tauri 2.x），为 Claude Code / Codex CLI / Gemini CLI / OpenCode 提供图形化的会话管理、账号管理、费用追踪等"周边设施"。

**核心原则：零额外 Token 开销** — PTY 直通，不拦截/代理 API 请求。

## 技术栈（强制）

| 层          | 技术                        | 版本约束                |
| ---------- | ------------------------- | ------------------- |
| 桌面框架       | Tauri                     | 2.x（不允许 1.x）        |
| 后端         | Rust                      | stable 工具链          |
| HTTP/WS 网关 | axum                      | 仅监听 127.0.0.1:49999 |
| 前端         | React + TypeScript        | React 19, TS 5.x    |
| UI 组件库     | Ant Design                | 6.x（不允许 5.x）        |
| 样式         | TailwindCSS               | 4.x，仅用于布局/间距/自定义样式  |
| 状态管理       | Zustand                   | —                   |
| 终端渲染       | xterm.js                  | —                   |
| 数据存储       | SQLite (rusqlite) + JSONL | —                   |

## 项目结构（强制）

```
/
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── main.rs
│   │   ├── pty/            # PTY 终端管理
│   │   ├── cli/            # CLI 工具检测与启动
│   │   ├── profile/        # Profile 管理
│   │   ├── cost/           # Token 费用追踪
│   │   │   ├── mod.rs
│   │   │   ├── provider.rs # CostProvider trait
│   │   │   ├── claude.rs   # Claude Code 适配
│   │   │   ├── codex.rs    # Codex CLI 适配
│   │   │   ├── gemini.rs   # Gemini CLI 适配
│   │   │   └── opencode.rs # OpenCode 适配
│   │   ├── storage/        # SQLite + JSONL 存储
│   │   ├── crypto/         # 凭据加密
│   │   └── commands/       # Tauri IPC 命令
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                    # React 前端
│   ├── components/
│   │   ├── terminal/       # 终端组件
│   │   ├── tabs/           # 标签页管理
│   │   ├── profile/        # Profile 切换 UI
│   │   ├── cost/           # 费用统计 UI
│   │   └── common/
│   ├── pages/
│   ├── stores/             # Zustand stores
│   ├── types/
│   ├── utils/
│   ├── App.tsx
│   └── main.tsx
├── doc/
│   ├── aicoder.md          # 产品路线文档
│   └── requirements.md     # 需求说明书
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.ts
```

## 架构约束

### 1. PTY 直通

- **禁止**拦截、代理或修改 CLI 工具的 API 请求
- **禁止**在 PTY 输出流中注入额外内容
- Token 统计通过读取 CLI 本地数据文件，**非解析 PTY 输出**

### 2. 本地优先

- 所有数据存储在本地（SQLite + JSONL）
- **禁止**引入任何云端服务端依赖
- 网络请求仅限于：CLI 工具自身的 API 调用、费用探活、版本检查

### 3. 安全

- API Key / OAuth Token **必须**通过系统 Keychain 存储（keyring crate）
- **禁止**将 API Key 明文写入 SQLite、JSONL、日志或任何文件
- axum 网关**仅监听 127.0.0.1**，禁止绑定 0.0.0.0
- 日志中所有 API Key 必须脱敏（显示 `sk-***...` 格式）
- Profile 导出时 API Key 必须脱敏

### 4. 跨平台

- 路径处理使用 Rust `PathBuf`，**禁止**硬编码 `/` 或 `\` 分隔符
- 文件操作使用 `std::fs`，**禁止**直接 `shell out` 到 `cp`/`rm`/`mv`
- Windows / macOS / Linux 三平台必须同等支持

### 5. Ant Design + TailwindCSS 共存

- Ant Design 负责 UI 组件（按钮、表单、弹窗、表格等）
- TailwindCSS **仅用于**布局（flex/grid）、间距（p/m）、自定义样式
- **禁止**用 TailwindCSS 覆盖 AntD 组件的样式
- 配置 TailwindCSS `preflight: false` 或 `corePlugins: { preflight: false }` 避免冲突

## 启动命令

- pnpm tauri dev
- 必须使用pnpm包来管理

## 编码规范

### Rust

- 使用 `Result<T, E>` 处理所有错误，**禁止** `unwrap()` 在非测试代码中使用
- 使用 `thiserror` 定义错误类型，**禁止** `Box<dyn Error>` 作为返回类型
- 异步运行时使用 `tokio`，**禁止**混用 `async-std`
- 数据库操作使用事务（`transaction`），确保原子性
- 公共 API 必须有文档注释（`///`），内部函数不需要
- `cargo clippy` 必须无 warning

### TypeScript / React

- 严格模式：`"strict": true` in tsconfig.json
- 函数组件 + Hooks，**禁止** class 组件
- Props 必须定义 interface/type，**禁止** `any`
- 状态管理统一使用 Zustand，**禁止** Context + useReducer 替代全局状态
- 组件文件使用 PascalCase，工具文件使用 camelCase
- **禁止** `console.log` 在生产代码中，开发调试用 `console.debug` 并在提交前清理

### 通用

- **禁止**注释描述"做了什么"（代码本身应自解释）
- 仅在 WHY 不明显时添加注释（隐藏约束、不变量、特殊 workaround）
- **禁止** TODO/FIXME/HACK 注释，要么现在解决要么创建 issue
- Git commit message 使用中文，格式：`<类型>: <描述>`，如 `feat: 添加 Profile 管理界面`

## 数据库规范

- SQLite schema 版本化，从 v1 开始，每次变更递增
- 迁移脚本放在 `src-tauri/migrations/` 目录，命名 `v{N}_description.sql`
- **禁止** `ALTER TABLE` 删除列，使用新增列 + 代码层忽略的方式
- 所有表必须有 `created_at` / `updated_at` 字段（INTEGER，Unix 时间戳毫秒）

## IPC 接口规范

- Tauri IPC 命令定义在 `src-tauri/src/commands/` 下
- 命令命名：`<领域>_<动作>`，如 `profile_create`、`cost_get_session`
- 前端调用通过 `@tauri-apps/api` 的 `invoke` 函数
- 事件命名：`<领域>:<事件>`，如 `pty:output`、`pty:exit`、`cost:updated`
- **禁止**在 IPC 通道中传递 API Key 明文

## 版本范围（v0.1 MVP）

### 必须实现

1. 多工具终端管理（检测 + 启动 + PTY 交互）
2. 多标签会话管理（标签页 + 项目分组 + 搜索）
3. 账号/Profile 管理（CRUD + 切换 + 数据隔离）
4. Token 费用追踪（CostProvider + Claude Code 完整实现 + 其他工具框架）

### 禁止实现（v0.1 边界）

- MCP Server 可视化管理
- 代码片段库
- WebDAV 云同步
- SSH 远程工作区
- 语音输入
- 移动端伴侣
- 工作区编辑器
- 内置浏览器
- 桌面宠物
- Responses ↔ Chat 转换代理
- 本地 LLM 后端

## 性能指标（v0.1 验收标准）

- 冷启动 < 2 秒
- CLI 工具检测 < 3 秒
- PTY 输出延迟 < 50ms
- SQLite 查询 < 100ms
- 空闲内存 < 200MB，单会话 < 400MB

## 关键依赖

| Crate              | 用途          |
| ------------------ | ----------- |
| tauri 2.x          | 桌面框架        |
| axum               | HTTP/WS 网关  |
| portable-pty       | PTY 伪终端     |
| rusqlite           | SQLite 操作   |
| keyring            | 系统 Keychain |
| serde + serde_json | 序列化         |
| tokio              | 异步运行时       |
| thiserror          | 错误类型        |
| uuid               | ID 生成       |
| chrono             | 时间处理        |

## 开发流程

1. 每个 Tauri IPC 命令先在 Rust 侧实现，再在 TS 侧封装调用
2. 每个功能模块完成后立即手动验证，不累积到最终
3. 使用 `cargo clippy` + `cargo test` + `npm run typecheck` 作为提交前检查
4. 遇到跨平台问题时，优先在 Linux 上验证，再考虑 Windows/macOS 差异
