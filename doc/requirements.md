# 茶码 TeaCoder — 需求说明书 v0.1 (MVP)

> 本文档面向 Claude Code 开发实现，描述 v0.1 最小可用版本的完整需求。所有功能需在 v0.1 中实现并可用。

---

## 1. 项目概述

### 1.1 项目名称

茶码 TeaCoder

### 1.2 版本

v0.1 (MVP)

### 1.3 项目目标

构建一款 AI 编程 CLI 工具的桌面管理客户端，为 Claude Code / Codex CLI / Gemini CLI / OpenCode 提供图形化的会话管理、账号管理、费用追踪、配置管理等"周边设施"，核心原则是**零额外 Token 开销**。

### 1.4 核心价值

- PTY 直通，不拦截/代理 API 请求，零额外 Token 消耗
- 多工具统一管理，一键切换
- 多账号完全隔离
- Token 费用通过读取 CLI 本地数据文件统计（非解析 PTY 输出）

---

## 2. 技术栈

### 2.1 桌面端

- **框架**：Tauri 2.x
- **后端**：Rust（stable）
- **HTTP/WS 网关**：axum（仅监听 127.0.0.1:49999）
- **前端**：React 19 + TypeScript
- **UI 组件库**：Ant Design 6
- **样式**：TailwindCSS 4（仅用于布局/间距/自定义样式，避免与 AntD 类名冲突）
- **状态管理**：Zustand
- **终端渲染**：xterm.js
- **数据存储**：SQLite（rusqlite）+ JSONL

### 2.2 打包产物

- Windows：`.exe` (NSIS 安装程序)
- macOS：`.dmg`
- Ubuntu：`.deb`
- 其他 Linux：`.AppImage`

### 2.3 项目结构

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
│   └── requirements.md     # 本文档
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.ts
```

---

## 3. 功能需求

### 3.1 多工具终端管理

#### 3.1.1 CLI 工具检测

- **需求**：自动检测系统已安装的 AI CLI 工具
- **支持工具**：Claude Code、Codex CLI、Gemini CLI、OpenCode
- **检测方式**：检查 PATH 环境变量中的可执行文件
  - Claude Code：`claude`
  - Codex CLI：`codex`
  - Gemini CLI：`gemini`
  - OpenCode：`opencode`
- **检测内容**：
  - 是否安装
  - 版本号（执行 `<tool> --version` 解析）
  - 可执行文件路径
- **触发时机**：
  - 应用启动时自动检测
  - 用户手动点击"重新检测"按钮
- **输出**：工具列表（工具名、版本、路径、是否可用）

#### 3.1.2 CLI 工具启动

- **需求**：通过 PTY 伪终端启动选定的 CLI 工具
- **启动方式**：使用 `portable-pty` crate 创建 PTY，在 PTY 中执行 CLI 命令
- **启动参数**：
  - 工作目录：用户选择的项目目录
  - 环境变量：注入当前 Profile 对应的 API Key / OAuth 凭据
  - 环境变量前缀清理：清理可能冲突的已有环境变量
- **PTY 管理**：
  - 每个 CLI 实例对应一个 PTY 会话
  - PTY 输出实时转发到前端终端组件
  - 前端输入实时转发到 PTY
  - 监听 PTY 进程退出事件，通知前端

#### 3.1.3 CLI 工具版本管理

- **需求**：显示已安装版本，提示是否有更新
- **更新检测**：调用各 CLI 工具自带的更新检查命令（如 `claude update --check`，若支持）
- **更新提示**：在工具列表中显示"有新版本"标签，不自动更新

---

### 3.2 多标签会话管理

#### 3.2.1 标签页

- **需求**：浏览器式多标签页，每个标签页对应一个 CLI 会话
- **标签页属性**：
  - 标题（默认显示项目名 + 工具名，可自定义）
  - 工具类型图标
  - 颜色标记（8 色可选，用于视觉区分）
  - 工作目录
  - Profile 名称
- **标签页操作**：
  - 新建标签页（Ctrl+T）
  - 关闭标签页（Ctrl+W，关闭前确认是否结束 CLI 进程）
  - 切换标签页（Ctrl+Tab 顺向、Ctrl+Shift+Tab 逆向）
  - 拖拽排序标签页
  - 右键菜单：关闭、关闭其他、关闭右侧、重新启动、复制路径
- **标签页持久化**：应用重启后恢复上次的标签页状态（工作目录、Profile、工具类型，不恢复终端内容）

#### 3.2.2 项目分组

- **需求**：按项目分组组织标签页
- **项目定义**：工作目录路径即为项目，相同工作目录的标签页归入同一项目组
- **项目列表**：左侧栏显示项目列表，展开显示该项目下的标签页
- **项目操作**：
  - 收藏项目（置顶显示）
  - 折叠/展开
  - 右键菜单：新建会话、打开文件管理器、复制路径

#### 3.2.3 会话搜索

- **需求**：模糊搜索历史会话和当前会话
- **搜索范围**：
  - 项目名称
  - 标签页标题
  - 工作目录路径
- **搜索触发**：Ctrl+P 打开搜索面板
- **搜索结果**：显示匹配的会话列表，点击切换到对应标签页

---

### 3.3 账号/Profile 切换

#### 3.3.1 Profile 概念

- **Profile 定义**：一套完整的 CLI 配置，包含 API Key / OAuth 凭据 / Base URL / 模型偏好等
- **Profile 数量**：无限制，用户可创建任意数量
- **Profile 维度**：Profile 与 CLI 工具类型关联（如"Claude Code 工作账号"、"Codex 个人账号"）

#### 3.3.2 Profile 数据结构

```typescript
interface Profile {
  id: string;              // UUID
  name: string;            // 显示名称
  toolType: 'claude' | 'codex' | 'gemini' | 'opencode';
  authType: 'api_key' | 'oauth';
  // API Key 方式
  apiKey?: string;         // 加密存储
  baseUrl?: string;        // 自定义 API 端点
  // OAuth 方式
  oauthToken?: string;     // 加密存储
  oauthRefreshToken?: string;
  // 数据隔离
  appDataRoot?: string;    // 自定义 app_data_root 路径（用于多实例隔离）
  // 元数据
  createdAt: number;
  updatedAt: number;
  color?: string;          // 标识颜色
  description?: string;
}
```

#### 3.3.3 Profile 管理

- **创建 Profile**：
  - 表单填写：名称、工具类型、认证方式、API Key / OAuth、Base URL（可选）、appDataRoot（可选）
  - 创建时验证 API Key 有效性（调用各 CLI 的测试命令或直接调用 API 探活）
- **编辑 Profile**：修改任意字段，API Key 修改时需重新输入
- **删除 Profile**：删除前确认，删除关联的 app_data_root 目录（可选，询问用户）
- **复制 Profile**：基于现有 Profile 创建副本，方便快速创建相似配置
- **导入/导出 Profile**：JSON 格式，导出时 API Key 脱敏（用户需手动重新填写）

#### 3.3.4 Profile 切换

- **切换方式**：标签页新建时选择 Profile，或在运行中的标签页切换 Profile（需重启 CLI 进程）
- **切换流程**（事务化）：
  1. 备份当前 Profile 的环境变量与 app_data_root 软链接
  2. 注入新 Profile 的环境变量
  3. 切换 app_data_root 软链接指向
  4. 启动新的 CLI 进程
  5. 若启动失败，回滚到原 Profile
- **残留清理**：切换后自动清理临时环境变量、旧的进程残留

#### 3.3.5 凭据存储

- **加密方式**：
  - macOS：Keychain
  - Windows：Credential Manager
  - Linux：Secret Service（libsecret）
- **Rust crate**：`keyring`
- **存储格式**：`enc:v1:<base64-encrypted-data>`，前缀标识版本便于未来迁移
- **凭据内容**：API Key、OAuth Token、OAuth RefreshToken

#### 3.3.6 多实例数据隔离

- **隔离方式**：每个 Profile 独立的 `app_data_root` 目录
- **Claude Code 隔离**：
  - 默认 `~/.claude/`
  - Profile 独立目录：`~/.teacoder/profiles/<profile_id>/claude-data/`
  - 通过环境变量 `CLAUDE_CONFIG_DIR` 指向独立目录
- **其他 CLI**：v0.1 暂不强制隔离，使用默认目录（文档标注"逐步适配"）

---

### 3.4 Token 费用追踪

#### 3.4.1 追踪方案

- **方案**：读取 CLI 工具本地数据文件，**非解析 PTY 输出**
- **原因**：PTY 输出格式不稳定，CLI 更新易导致解析失败

#### 3.4.2 CostProvider Trait

```rust
#[async_trait]
pub trait CostProvider: Send + Sync {
    /// 工具类型标识
    fn tool_type(&self) -> ToolType;

    /// 获取该工具的数据文件目录
    fn data_dir(&self, profile: &Profile) -> PathBuf;

    /// 列出所有会话数据文件
    async fn list_sessions(&self, profile: &Profile) -> Result<Vec<SessionFile>>;

    /// 解析单个会话文件，提取 token 使用统计
    async fn parse_session(&self, file_path: &Path) -> Result<SessionCost>;

    /// 获取会话的实时增量统计（用于运行中的会话）
    async fn get_live_usage(&self, profile: &Profile, session_id: &str) -> Result<SessionCost>;
}

pub struct SessionCost {
    pub session_id: String,
    pub profile_id: String,
    pub tool_type: ToolType,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub model: String,
}

pub enum ToolType {
    Claude,
    Codex,
    Gemini,
    OpenCode,
}
```

#### 3.4.3 各 CLI 数据来源

| CLI 工具      | 数据来源                                                           | 解析方式                             |
| ----------- | -------------------------------------------------------------- | -------------------------------- |
| Claude Code | `~/.claude/projects/*/conversation_*.jsonl` 或 Profile 独立目录下同结构 | 逐行解析 JSONL，累计 `message.usage` 字段 |
| Codex CLI   | 本地会话日志（具体路径待适配）                                                | v0.1 先实现框架，解析逻辑标记为 TODO          |
| Gemini CLI  | 本地会话日志（具体路径待适配）                                                | v0.1 先实现框架，解析逻辑标记为 TODO          |
| OpenCode    | 本地会话日志（具体路径待适配）                                                | v0.1 先实现框架，解析逻辑标记为 TODO          |

#### 3.4.4 读取策略

- **会话结束读取**：CLI 进程退出后，读取完整会话数据文件，解析并存入 SQLite
- **定时轮询**：运行中的会话每 30 秒轮询一次，读取增量数据，更新 SQLite 中的统计
- **去重机制**：基于 session_id + 文件 mtime 去重，避免重复统计

#### 3.4.5 费用计算

- **单价配置**：用户可在设置中配置各模型的单价（每百万 token 的输入/输出/缓存价格）

- **内置单价表**：内置主流模型（Claude Opus/Sonnet/Haiku、GPT-4、Gemini Pro 等）的官方单价，用户可覆盖

- **计算公式**：
  
  ```
  费用 = (input_tokens * input_price + output_tokens * output_price 
       + cache_creation_tokens * cache_creation_price 
       + cache_read_tokens * cache_read_price) / 1_000_000
  ```

#### 3.4.6 费用展示

- **会话级**：每个标签页底部状态栏显示当前会话累计 Token 数与估算费用
- **Profile 级**：Profile 管理界面显示该 Profile 累计费用
- **全局级**：侧边栏显示今日累计费用、本月累计费用
- **数据维度**：输入/输出/缓存创建/缓存读取分别统计

---

## 4. 数据模型

### 4.1 SQLite Schema

```sql
-- Schema 版本管理
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);

-- Profile 表
CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tool_type TEXT NOT NULL,  -- claude | codex | gemini | opencode
    auth_type TEXT NOT NULL,  -- api_key | oauth
    base_url TEXT,
    app_data_root TEXT,
    color TEXT,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
    -- 注意：API Key / OAuth Token 存于系统 Keychain，不存 SQLite
);

-- CLI 工具检测结果缓存
CREATE TABLE cli_tools (
    tool_type TEXT PRIMARY KEY,
    version TEXT,
    path TEXT,
    last_detected_at INTEGER NOT NULL,
    is_available INTEGER NOT NULL DEFAULT 0
);

-- 会话费用记录
CREATE TABLE session_costs (
    session_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    tool_type TEXT NOT NULL,
    project_path TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    model TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    last_updated INTEGER NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- 单价配置
CREATE TABLE pricing_config (
    model TEXT PRIMARY KEY,
    input_price REAL NOT NULL,        -- 每百万 token 美元
    output_price REAL NOT NULL,
    cache_creation_price REAL NOT NULL,
    cache_read_price REAL NOT NULL,
    is_custom INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);

-- 应用设置
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
```

### 4.2 JSONL 用途

- CLI 工具自身的会话记录保持 JSONL 格式（如 Claude Code 的 conversation_*.jsonl），TeaCoder 只读取不写入
- TeaCoder 自身的审计日志（Profile 切换、CLI 启动/退出）写入 `~/.teacoder/logs/audit.jsonl`

---

## 5. Tauri IPC 命令

### 5.1 CLI 工具管理

```typescript
// 检测所有已安装的 CLI 工具
detect_cli_tools(): Promise<CliTool[]>

// 启动 CLI 会话
start_session(params: {
  toolType: ToolType;
  profileId: string;
  workDir: string;
  tabId: string;
}): Promise<void>

// 停止 CLI 会话
stop_session(tabId: string): Promise<void>

// 向 PTY 写入输入
write_to_pty(tabId: string, data: string): Promise<void>

// 调整 PTY 大小
resize_pty(tabId: string, cols: number, rows: number): Promise<void>
```

### 5.2 Profile 管理

```typescript
list_profiles(toolType?: ToolType): Promise<Profile[]>
create_profile(profile: Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>): Promise<Profile>
update_profile(id: string, updates: Partial<Profile>): Promise<Profile>
delete_profile(id: string, options: { removeData: boolean }): Promise<void>
duplicate_profile(id: string): Promise<Profile>
export_profiles(ids: string[]): Promise<string>  // 返回 JSON 字符串
import_profiles(json: string): Promise<Profile[]>
validate_profile(profile: Profile): Promise<{ valid: boolean; error?: string }>
```

### 5.3 费用追踪

```typescript
// 获取会话费用统计
get_session_cost(sessionId: string): Promise<SessionCost>

// 获取 Profile 累计费用
get_profile_cost(profileId: string, range?: { from: number; to: number }): Promise<CostSummary>

// 获取全局费用统计
get_global_cost(range?: { from: number; to: number }): Promise<CostSummary>

// 获取单价配置
list_pricing(): Promise<PricingConfig[]>
update_pricing(model: string, config: Partial<PricingConfig>): Promise<void>
reset_pricing(model: string): Promise<void>  // 重置为内置默认值
```

### 5.4 事件（后端 → 前端）

```typescript
// PTY 输出事件
on('pty_output', (payload: { tabId: string; data: string }) => void)

// PTY 退出事件
on('pty_exit', (payload: { tabId: string; exitCode: number }) => void)

// 费用更新事件（定时轮询后触发）
on('cost_updated', (payload: { sessionId: string; cost: SessionCost }) => void)
```

---

## 6. 前端界面需求

### 6.1 主窗口布局

```
┌──────────────────────────────────────────────────────────────┐
│  顶部栏：Logo | 项目搜索(Ctrl+P) | 全局费用 | 设置            │
├──────────┬───────────────────────────────────────────────────┤
│          │  标签页栏：[Tab1] [Tab2] [+]                        │
│  侧边栏  ├───────────────────────────────────────────────────┤
│          │                                                   │
│  - 项目1  │                                                   │
│    - Tab1│              终端区域（xterm.js）                   │
│    - Tab2│                                                   │
│  - 项目2  │                                                   │
│    - Tab3│                                                   │
│          │                                                   │
│  收藏区   ├───────────────────────────────────────────────────┤
│          │  状态栏：工具类型 | Profile | Token统计 | 费用      │
│  + 新建   │                                                   │
└──────────┴───────────────────────────────────────────────────┘
```

### 6.2 侧边栏

- **项目列表**：按工作目录分组显示标签页
- **收藏区**：用户收藏的项目置顶
- **新建按钮**：点击弹出新建会话对话框
- **右键菜单**：
  - 项目级：新建会话、打开文件管理器、复制路径、收藏/取消收藏
  - 标签页级：切换 Profile、重新启动、关闭、关闭其他

### 6.3 终端区域

- **终端组件**：xterm.js + xterm-addon-fit + xterm-addon-web-links
- **功能**：
  - 标准 ANSI 颜色支持
  - 鼠标可点击链接
  - 复制粘贴（Ctrl+Shift+C / Ctrl+Shift+V）
  - 字体大小调节（Ctrl+= / Ctrl+-）
  - 全屏切换（F11）
- **主题**：跟随应用主题（深色/浅色）

### 6.4 状态栏

- 左侧：工具类型图标 + 名称、当前 Profile 名称（点击切换）
- 右侧：当前会话 Token 统计（输入/输出/缓存）、估算费用、会话时长

### 6.5 新建会话对话框

- **字段**：
  - CLI 工具选择（下拉，仅显示已检测到的工具）
  - Profile 选择（下拉，按工具类型过滤）
  - 工作目录（文件选择器）
  - 标签页标题（可选，默认自动生成）
  - 颜色标记（8 色选择器）
- **快捷创建**：记忆上次配置，下次默认填充

### 6.6 Profile 管理界面

- **入口**：设置 → Profile 管理
- **布局**：左侧 Profile 列表（按工具类型分组），右侧编辑表单
- **操作按钮**：新建、复制、删除、导入、导出
- **验证提示**：API Key 验证状态（有效/无效/未验证）

### 6.7 设置界面

- **通用**：主题、字体、默认工作目录、开机自启
- **费用**：单价配置（模型列表 + 编辑表单）、货币单位、预算告警阈值
- **CLI 工具**：手动重新检测、显示各工具版本与路径
- **数据**：数据目录位置、清理缓存、导出数据

### 6.8 主题

- 支持深色 / 浅色 / 跟随系统
- Ant Design 主题通过 ConfigProvider 配置
- TailwindCSS 通过 `dark:` 类名适配

---

## 7. 非功能需求

### 7.1 性能

- 应用冷启动时间 < 2 秒
- CLI 工具检测完成时间 < 3 秒（并行检测）
- PTY 输出延迟 < 50ms（从 PTY 读取到前端渲染）
- SQLite 查询响应时间 < 100ms
- 内存占用：空闲状态 < 200MB，单会话运行 < 400MB

### 7.2 安全

- API Key / OAuth Token 仅存于系统 Keychain，不落明文
- axum 网关仅监听 127.0.0.1，不绑定外部网卡
- 日志中不记录 API Key / Token 明文（脱敏处理）
- Profile 导出时 API Key 必须脱敏

### 7.3 可靠性

- PTY 进程异常退出时，前端需收到通知并提示用户
- SQLite 操作失败时回滚事务，不破坏数据一致性
- Profile 切换失败时必须能回滚到原状态
- 应用崩溃后重启，能恢复上次的标签页配置（不含终端内容）

### 7.4 跨平台

- Windows 10+ / macOS 11+ / Ubuntu 20.04+ / 其他 Linux（AppImage）
- 路径处理使用 Rust 的 PathBuf，不硬编码分隔符
- 换行符：PTY 内部使用 `\n`，Windows 下由 PTY 库处理转换

---

## 8. 开发任务拆解

> 建议按以下顺序开发，每个阶段完成后可独立验证

### 阶段 1：项目脚手架（1-2 天）

- [ ] Tauri 2.x 项目初始化
- [ ] 集成 React 19 + TypeScript + Vite
- [ ] 集成 Ant Design 6 + TailwindCSS 4（配置样式隔离）
- [ ] 集成 Zustand 状态管理
- [ ] SQLite 数据库初始化与 schema 迁移机制
- [ ] 基础布局（顶部栏、侧边栏、主区域、状态栏）

### 阶段 2：CLI 工具检测与管理（2-3 天）

- [ ] `cli/detector.rs`：实现 4 个 CLI 工具的检测逻辑
- [ ] `commands/cli.rs`：暴露 `detect_cli_tools` IPC 命令
- [ ] 前端：CLI 工具列表 UI、重新检测按钮
- [ ] 设置界面：显示已检测工具的版本与路径

### 阶段 3：PTY 终端核心（3-5 天）

- [ ] `pty/manager.rs`：PTY 会话管理（创建、销毁、输入输出）
- [ ] 集成 `portable-pty` crate
- [ ] `commands/pty.rs`：暴露 start_session / stop_session / write_to_pty / resize_pty
- [ ] 事件系统：pty_output / pty_exit 事件
- [ ] 前端：xterm.js 集成、终端组件、输入输出绑定

### 阶段 4：多标签页管理（3-4 天）

- [ ] 标签页状态管理（Zustand store）
- [ ] 标签页 UI（新建、关闭、切换、拖拽排序）
- [ ] 快捷键绑定（Ctrl+T / Ctrl+W / Ctrl+Tab）
- [ ] 标签页持久化（重启恢复）
- [ ] 项目分组逻辑与 UI
- [ ] 会话搜索（Ctrl+P）

### 阶段 5：Profile 管理（4-5 天）

- [ ] `profile/manager.rs`：Profile CRUD
- [ ] `crypto/keychain.rs`：系统集成 keyring crate
- [ ] Profile 切换事务化逻辑（备份/注入/回滚）
- [ ] 多实例数据隔离（Claude Code 的 CLAUDE_CONFIG_DIR）
- [ ] 前端：Profile 管理界面、新建会话对话框的 Profile 选择
- [ ] Profile 验证（API Key 探活）

### 阶段 6：Token 费用追踪（4-5 天）

- [ ] `cost/provider.rs`：CostProvider trait 定义
- [ ] `cost/claude.rs`：Claude Code JSONL 解析（完整实现）
- [ ] `cost/codex.rs` / `gemini.rs` / `opencode.rs`：框架实现，解析逻辑 TODO
- [ ] 定时轮询机制（每 30s 读取运行中会话）
- [ ] 费用计算与单价配置
- [ ] 前端：状态栏 Token 显示、Profile 费用统计、设置中的单价配置

### 阶段 7：打磨与打包（2-3 天）

- [ ] 主题切换（深色/浅色/跟随系统）
- [ ] 错误处理与用户提示统一
- [ ] Windows / macOS / Linux 三平台打包测试
- [ ] 应用图标与启动画面
- [ ] 基础文档（README、快速上手）

**预计总工期：19-27 天（约 3-4 周全职开发）**

---

## 9. 验收标准

### 9.1 功能验收

- [ ] 能检测到系统已安装的 Claude Code，并显示版本
- [ ] 能新建标签页启动 Claude Code，终端正常交互
- [ ] 能创建多个 Profile，API Key 加密存储
- [ ] 能在不同标签页使用不同 Profile，数据隔离生效
- [ ] Claude Code 会话结束后，能正确统计 Token 数量与费用
- [ ] 运行中的会话，状态栏 Token 数每 30s 更新
- [ ] 应用重启后，标签页配置（工作目录、Profile、工具类型）能恢复
- [ ] 三平台（Windows/macOS/Linux）安装包可正常安装运行

### 9.2 非功能验收

- [ ] 冷启动 < 2 秒
- [ ] API Key 在 SQLite 中不存在明文
- [ ] axum 仅监听 127.0.0.1（`netstat` 验证）
- [ ] Profile 切换失败时能回滚，不丢失原配置

---

## 10. 未纳入 v0.1 的功能（明确边界）

以下功能在 v0.1 中**不实现**，避免范围蔓延：

- MCP Server 可视化管理（v0.2）
- 代码片段库（v0.2）
- 全局命令面板 Ctrl+K（v0.2，v0.1 仅有 Ctrl+P 会话搜索）
- WebDAV 云同步（v0.2）
- 思考强度热切换（v0.2）
- 国内厂商端点预设（v0.2）
- SSH 远程工作区（v0.3）
- 语音输入（v0.3）
- AI 记忆管理（v0.3）
- Token 费用仪表板（v0.3，v0.1 仅有基础数字展示）
- 桌面宠物（v0.3）
- 移动端伴侣（v1.0+）
- 工作区编辑器（v1.0+）
- 本地 LLM 后端（v1.0+）
- Responses ↔ Chat 转换代理（v1.0+）
- Codex / Gemini / OpenCode 的费用解析（v0.1 仅实现框架，Claude Code 完整实现）

---

## 11. 开发注意事项

1. **Claude Code JSONL 解析优先**：v0.1 中只有 Claude Code 的 CostProvider 完整实现，其他三个工具实现 trait 框架但解析逻辑留 TODO，避免阻塞 MVP 发布

2. **CostProvider 可扩展**：trait 设计要预留扩展性，未来新增 CLI 工具只需实现 trait，不改动核心逻辑

3. **Profile 切换事务化**：这是高风险点，必须有完整的回滚机制，建议用 Rust 的 RAII 模式管理临时状态

4. **PTY 跨平台差异**：Windows 下 PTY 行为与 Unix 不同，需充分测试 `portable-pty` 在 Windows 的表现

5. **Ant Design + TailwindCSS 冲突**：配置 TailwindCSS 的 `preflight` 关闭，或使用 `important` 选项，避免覆盖 AntD 样式

6. **xterm.js 性能**：大量输出时需启用 `scrollback` 限制（建议 10000 行），避免内存膨胀

7. **数据迁移**：schema 版本化机制要从 v0.1 开始就建立，避免后期迁移痛苦
