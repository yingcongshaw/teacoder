# LLM 供应商系统设计

> 日期：2026-10-08
> 状态：已确认（待用户审 spec）

## 背景

TeaCoder 当前通过 Profile 同时承担三件事：CLI 工具选择、认证凭据、数据隔离目录。每个 Profile 强绑一个 CLI 工具和一个上游 LLM 供应商（如 Claude Profile → Anthropic），导致：

1. 无法在一个 CLI 工具下灵活切换 LLM 供应商（例如让 Claude Code 既能用 Anthropic 也能用 GLM/Kimi）
2. 同一供应商无法被多个 Profile 复用
3. Claude Code 的"默认模型"是硬编码三选一（opus/sonnet/haiku），不支持第三方模型

参考 CC Switch 的做法，本次重构引入独立的 **LLM Provider** 实体，把供应商配置（base_url、api_key、模型列表）从 Profile 中解耦。

## 决策记录

- LLM Provider 是新独立实体，与 Profile 解耦
- 覆盖四个 CLI 工具（Claude/Codex/Gemini/OpenCode）
- 14 个预设供应商模板（国内外主流）+ 用户可手动新增
- 用户可编辑/增删模型，可标记默认模型
- 软删除 LLM Provider，已删除的供应商关联的会话标记失效
- API Key 走系统 keychain，不存 SQLite 明文
- PTY 直通原则不变——LLM 切换通过环境变量实现，不拦截 CLI 工具的 API 请求

## 数据模型

### SQLite 迁移脚本（v8_llm_providers.sql）

```sql
CREATE TABLE llm_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider_kind TEXT NOT NULL,        -- anthropic | openai | google | custom
    base_url TEXT,
    icon TEXT,                          -- UI 图标名（lucide-react 名称）
    color TEXT,                         -- UI 颜色（hex）
    is_preset INTEGER DEFAULT 0,        -- 预设模板标识
    is_active INTEGER DEFAULT 1,        -- 软删除标志（0 = 已停用）
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

CREATE INDEX idx_llm_provider_models_provider ON llm_provider_models(provider_id, sort_order);

ALTER TABLE sessions ADD COLUMN llm_provider_id TEXT;
ALTER TABLE sessions ADD COLUMN model_name TEXT;

INSERT INTO schema_version (version, applied_at) VALUES (8, strftime('%s','now') * 1000);
```

### 数据约束

- 每个 provider 最多一个 `is_default=1` 的模型（保存时校验）
- 删除 provider 时级联删除其 models（CASCADE）
- sessions.llm_provider_id 是逻辑外键（不强制约束，保留历史会话可指向已删除 provider）
- is_active=0 的 provider 在常规查询中过滤；UI 提供"显示已停用"开关

## 预设供应商模板

首次启动时程序自动 seed 14 个预设供应商（is_preset=1）：

| 名称 | kind | 默认 base_url | 默认模型 |
|------|------|--------------|---------|
| Anthropic | anthropic | https://api.anthropic.com | claude-opus-4-20250514, claude-sonnet-4-20250514, claude-haiku-4-20250514 |
| OpenAI | openai | https://api.openai.com/v1 | gpt-4o, gpt-4-turbo, o1, o1-mini |
| Google AI Studio | google | https://generativelanguage.googleapis.com/v1beta | gemini-2.0-pro-exp, gemini-2.0-flash-exp |
| DeepSeek | openai | https://api.deepseek.com/v1 | deepseek-chat, deepseek-reasoner |
| GLM 智谱 | openai | https://open.bigmodel.cn/api/paas/v4 | glm-4-plus, glm-4-air, glm-4-flash |
| Kimi 月之暗面 | openai | https://api.moonshot.cn/v1 | moonshot-v1-128k, moonshot-v1-32k |
| Qwen 通义千问 | openai | https://dashscope.aliyuncs.com/compatible-mode/v1 | qwen-max, qwen-plus, qwen-turbo |
| SiliconFlow 硅基流动 | openai | https://api.siliconflow.cn/v1 | Qwen/Qwen2.5-72B-Instruct, deepseek-ai/DeepSeek-V3 |
| 豆包 Doubao | openai | https://ark.cn-beijing.volces.com/api/v3 | doubao-pro-32k, doubao-lite-32k |
| Hunyuan 混元 | openai | https://api.hunyuan.cloud.tencent.com/v1 | hunyuan-pro, hunyuan-standard |
| 零一万物 Yi | openai | https://api.lingyiwanwu.com/v1 | yi-large, yi-medium |
| 百川 Baichuan | openai | https://api.baichuan-ai.com/v1 | Baichuan4, Baichuan3-Turbo |
| MiniMax | anthropic | https://api.MiniMax.chat/anthropic | MiniMax-Text-01, MiniMax-Text-01-250415 |
| OpenRouter | openai | https://openrouter.ai/api/v1 | anthropic/claude-sonnet-4, openai/gpt-4o |

**Note**：以上 base_url 和模型 ID 来自各供应商公开文档，v0.1 实际可用性需用户在 UI 上验证。程序不做联网校验。

## CLI 工具 ↔ Provider Kind 兼容性

| CLI 工具 | 可用 Provider Kind | 环境变量 |
|---------|------------------|---------|
| Claude  | anthropic        | `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL` |
| Codex   | openai           | `OPENAI_API_KEY`、`OPENAI_BASE_URL` |
| Gemini  | google           | `GOOGLE_API_KEY`，base_url 通过 `GOOGLE_BASE_URL` 环境变量或 `--base_url` CLI 参数注入（Gemini CLI v0.1 实装时确认文档支持的具体形式） |
| OpenCode| 任意（任意 kind）| 走 OpenCode 自身的多 provider 配置（OpenCode v0.1 实装时确认其 provider 配置文件与环境变量的优先级） |

**新建会话 UI 强制过滤**：下拉只展示与所选 CLI 工具 kind 兼容的 Provider，避免不兼容组合。

## 模块划分

### Rust 后端

```
src-tauri/src/
├── llm_provider/                  # 新模块
│   ├── mod.rs                     # CRUD + 业务逻辑
│   ├── preset.rs                  # 14 个预设模板常量
│   └── seed.rs                    # 首次启动 seed 逻辑
├── commands/
│   └── llm_provider.rs            # 新 IPC 命令集
├── commands/pty.rs                # 修改：注入 LLM 环境变量
├── storage/mod.rs                 # 注册 v8 迁移
└── lib.rs                         # 注册新 IPC
```

### 前端

```
src/
├── components/
│   ├── settings/
│   │   ├── LlmProvidersPage.tsx              # 新增：LLM 设置主页面
│   │   ├── components/LlmProviderCard.tsx    # 新增：供应商卡片
│   │   ├── components/LlmProviderEditModal.tsx  # 新增：编辑模态框
│   │   ├── ClaudeSettingsPage.tsx            # 修改：默认模型 → LLM 列表
│   │   └── CodexSettingsPage.tsx             # 同上
│   └── session/
│       └── NewSessionModal.tsx               # 修改：增加 LLM Provider / Model 下拉
├── stores/
│   └── appStore.ts                            # 修改：增 llmProviders 状态
├── types/
│   └── index.ts                              # 修改：增 LlmProvider / LlmProviderModel 类型
└── utils/
    └── ipc.ts                                # 修改：增 LLM Provider IPC 封装
```

## IPC 接口

新增命令（命名遵循 `<领域>_<动作>` 约定）：

| 命令 | 参数 | 返回 |
|------|------|------|
| `llm_provider_list` | `include_inactive: Option<bool>` | `Vec<LlmProvider>` 含 models |
| `llm_provider_get` | `id: String` | `LlmProvider` 含 models |
| `llm_provider_create` | `CreateLlmProviderInput` | `LlmProvider` |
| `llm_provider_update` | `id: String, UpdateLlmProviderInput` | `LlmProvider` |
| `llm_provider_delete` | `id: String`（软删除） | `()` |
| `llm_provider_hard_delete` | `id: String`（仅当无会话引用） | `()` |
| `llm_provider_set_default_model` | `provider_id: String, model_id: String` | `()` |
| `llm_provider_list_presets` | — | `Vec<PresetProvider>`（模板常量） |

修改 `start_session` 命令：

```rust
pub fn start_session(
    // ... 现有参数
    llm_provider_id: Option<String>,
    model_name: Option<String>,
) -> Result<(), String>
```

## PTY 启动流程改造

```
start_session(tab_id, tool_type, work_dir, profile_id, llm_provider_id, model_name, ...)
        │
        ▼
1. 读 Profile（若 profile_id 非空）
   └─ 注入 CLAUDE_CONFIG_DIR / CODEX_HOME / GEMINI_HOME / OPENCODE_HOME
   └─ 兼容旧逻辑：若 Profile 有 base_url/api_key 也注入（v0.1 兼容期）
        │
        ▼
2. 读 LLM Provider（若 llm_provider_id 非空且 is_active=1）
   └─ 按 tool_type 注入 API Key 环境变量：
      - Claude  → ANTHROPIC_API_KEY
      - Codex   → OPENAI_API_KEY
      - Gemini  → GOOGLE_API_KEY
      - OpenCode→ OPENCODE_API_KEY（实际机制可能不同，待 spike）
   └─ 注入 base_url 环境变量：
      - Claude  → ANTHROPIC_BASE_URL
      - Codex   → OPENAI_BASE_URL
      - Gemini  → GOOGLE_BASE_URL（如 Gemini CLI 支持）或 --base_url 参数
      - OpenCode→ 走 OpenCode 自身配置机制
        │
        ▼
3. 注入 model 参数
   └─ Claude  → args.push("--model"); args.push(model_name)
   └─ Codex   → args.push("--model"); args.push(model_name)
   └─ Gemini  → 视 Gemini CLI 实际支持的参数（--model / 子命令）
   └─ OpenCode→ 走 OpenCode 自身配置
        │
        ▼
4. 合并 user_env_vars（用户自定义可覆盖）
        │
        ▼
5. PtyManager.start_session()
```

**多会话互不干扰**：每个 PTY 是独立进程 + 独立 env，互不污染，原生支持。

## UI 改动详情

### A. 设置 → 对话窗口 → LLM 设置（新增标签页）

布局：
- 顶部操作栏：「+ 从模板添加」按钮、「+ 自定义」按钮、「显示已停用」Switch
- 主体：供应商卡片网格（每个卡片展示：图标、名称、kind tag、模型数量、默认模型、active 状态）
- 点击卡片 → 编辑模态框：
  - 基本信息：name、provider_kind、icon、color
  - API 配置：base_url、api_key（Password 输入，保存时写入 keychain）
  - 模型列表：增删改，拖拽排序，标记默认
  - 高级：is_preset 不可改；is_active 切换
- 删除：弹确认框，若有会话引用则提示「将停用该供应商并标记关联会话失效」

### B. CLI 工具设置页（Claude/Codex/Gemini/OpenCode 全部改造）

移除：硬编码的"默认模型"三选一
新增：
- 「LLM 列表」：多选该 Profile 默认使用的 LLM Provider（用于新建会话下拉默认值）
- 「默认 LLM 供应商模型」：单选，作为新建会话的默认 LLM
- 保存时校验：所选 Provider 的 kind 必须与 Profile.toolType 兼容

### C. 新建会话对话框

按 Profile.toolType 过滤 LLM Provider 下拉：
1. 选择 Profile（不变）
2. 选择 CLI 工具（由 Profile 决定，可改）
3. 选择 LLM Provider（按 toolType 过滤）
4. 选择 Model（从 Provider 的 models 列表）
5. 默认值：来自 Profile 设置中的"默认 LLM 供应商模型"

### D. 会话 Tab 显示

会话 Tab 标题旁增加 LLM 图标/颜色标记，便于多会话区分（复用 Provider 的 icon/color）

## 兼容性 / 迁移策略

### 旧 Profile 兼容（v0.1 过渡期，长期保留）

- **Profile 的 base_url/api_key 字段保留在数据库层**，但**不再是 UI 入口**（CLI 设置页移除该字段的编辑入口）
- **新建会话时优先级**：LLM Provider（来自 Profile 配置的"默认 LLM 供应商模型"） > Profile 自身的 base_url/api_key
- **启动 PTY 时合并逻辑**：两者都注入 env_vars，但 LLM Provider 的值后注入（自然覆盖 Profile 的同名值）
- 长期保留此兼容逻辑，避免破坏未升级 v0.1 配置的旧用户

### 旧会话兼容

- v8 迁移前存在的 sessions 行：llm_provider_id 和 model_name 为 NULL
- 重启这些会话时：按"旧 Profile 兼容"逻辑回退到 Profile 的 base_url/api_key
- 旧会话的 tool_settings.model 字段保留（用于在 CLI 设置页回显，不参与启动逻辑）

### Cost 追踪兼容

- 不改动 cost/claude.rs 解析逻辑
- 继续从本地 JSONL 读 model 字段
- 前端展示时按 LLM Provider 分组聚合（如果有 llm_provider_id）
- 旧会话无 llm_provider_id → 归入"未分类"组

### 跨平台注意

- 路径处理：base_url 是 URL 不是路径，但 Gemini CLI 的某些配置可能涉及本地路径——保持 Rust `PathBuf` 习惯
- API Key 通过 keyring crate 跨平台存储（macOS Keychain / Windows Credential Manager / Linux Secret Service）

## 错误处理

| 场景 | 行为 |
|------|------|
| LLM Provider 已软删除但被会话引用 | 启动失败，提示「该会话关联的供应商已停用，请在会话设置中重新选择」 |
| LLM Provider 已硬删除 | 数据库层 CASCADE 不会发生（仅软删除），无此场景 |
| Provider kind 与 CLI 工具不兼容 | UI 层在下拉过滤时即拦截，不会启动到 PTY |
| API Key 未配置 | 启动前 `get_secret` 返回 None → 报错「该供应商未配置 API Key」 |
| base_url 格式非法 | 保存时正则校验 `https?://.*`，非法则保存失败 |
| 多个 model 都标记为 is_default=1 | 保存时事务内取消其他 default，保证唯一 |
| keychain 写入失败 | 提示「系统 Keychain 不可用，请检查系统设置」 |

## 测试策略

### 单元测试（Rust）

- `llm_provider` 模块 CRUD + 软删除 + 级联
- 预设模板 seed 幂等性（重复启动不会重复插入）
- env 注入映射矩阵：tool_type × provider_kind → 正确环境变量名
- 多 default model 的事务回滚

### 集成测试（Rust）

- start_session 在 4 种 CLI 工具 × 多种 Provider 组合下，验证 env_vars 正确组装
- 旧 Profile（无 llm_provider_id）仍能启动并使用 Profile 自身 base_url

### 前端测试

- LlmProvidersPage：增删改卡片的 UI 交互
- 新建会话对话框：toolType 变化时 Provider 下拉联动
- 软删除 Provider 后，会话 Tab 标记失效

### 手动验证清单

- [ ] Linux/macOS/Windows 三平台首次启动自动 seed 14 个预设
- [ ] Claude Code + Anthropic 官方 Provider 启动正常
- [ ] Claude Code + GLM Provider 启动正常，切换 base_url 后请求走第三方
- [ ] Codex CLI + DeepSeek Provider 启动正常
- [ ] Gemini CLI + Google AI Provider 启动正常（OpenAI 兼容端点单独验证）
- [ ] OpenCode CLI + 任意 Provider 启动正常
- [ ] 多会话同时打开，每个 LLM Provider 互不干扰（用环境变量验证）
- [ ] 重启应用后旧会话（v8 前创建）仍能恢复

## 风险

1. **Gemini CLI 的 base_url 切换机制**：Gemini CLI 的实际参数支持情况需要实机验证，可能需要在 v0.1 范围内降级为"Google 官方模型三选一 + OpenAI 兼容通过 OpenCode"
2. **OpenCode 多 Provider 配置**：OpenCode 原生通过配置文件管理多 provider，可能与本系统的 Provider 实体有重叠或冲突，需要梳理优先级
3. **Codex CLI 的 base_url 支持**：Codex CLI 实际是否支持任意 OpenAI 兼容 base_url 需要验证（理论支持，但实际可能有版本差异）
4. **第三方 LLM 的 Cost 准确性**：从本地 JSONL 读到的 model 字段是上游真实模型名，但价格表里没有对应条目——Cost 模块需要为未知 model 提供"按用量估算"或"未知价格"的兜底展示
5. **API Key 在 keychain 中的归属**：按 provider_id 存储，但用户删除 provider 后 keychain 条目是否清理——v0.1 暂不清理（避免误删），提供 `llm_provider_hard_delete` 时一并清理

## 实施计划

完成本 spec 审阅后，进入 `superpowers:writing-plans` 阶段，将本设计拆解为可执行任务清单。

## 范围之外（v0.1 不做）

- LLM Provider 之间的模型自动同步
- 按 Provider 分组的批量测试（Ping 多个 base_url）
- 模型别名映射（如 `claude-sonnet-4` 自动映射到 `claude-sonnet-4-20250514`）
- LLM Provider 的导入/导出
- LLM Provider 使用统计（按时间窗口聚合）
