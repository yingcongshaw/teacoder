# Settings Page Redesign — Design Spec

> Date: 2026-08-05
> Status: Approved
> Scope: Full redesign of all settings pages based on Cursor-style reference screenshots

## 1. Overview

Redesign the CodingTea settings page to match the Cursor/VS Code-style settings UI from reference screenshots. This includes:

- Restructured sidebar with grouped categories
- Flat row-based content layout (replacing Card-wrapped groups)
- 16 settings pages covering all features visible in references
- Reusable SettingRow and SectionHeader components
- Visual iteration using Playwright screenshots

## 2. Layout Architecture

### 2.1 Shell: Sidebar + Content

```
┌──────────┬──────────────────────────────────────────┐
│ Settings │  Page Title                    [Search]   │
│          ├──────────────────────────────────────────┤
│ 通用     │                                          │
│  通用设置│  ── SECTION ───────────────────────────── │
│          │  Label              [Control]            │
│ AI 工具  │  Description                             │
│  Claude  │  ─────────────────────────────────────── │
│  Codex   │  Label              [Control]            │
│  Gemini  │  Description                             │
│  Antigrav│  ─────────────────────────────────────── │
│  OpenCode│                                          │
│          │  ── ANOTHER SECTION ──────────────────── │
│ 终端     │  ...                                     │
│  终端设置│                                          │
│          │                                          │
│ AI 辅助  │                                          │
│  AI辅助  │                                          │
│          │                                          │
│ 网络     │                                          │
│  网络    │                                          │
│          │                                          │
│ 远程     │                                          │
│  远程访问│                                          │
│          │                                          │
│ 快捷键   │                                          │
│  快捷键  │                                          │
│          │                                          │
│ 通知     │                                          │
│  通知    │                                          │
│          │                                          │
│ 数据     │                                          │
│  数据管理│                                          │
│  同步    │                                          │
│          │                                          │
│ MCP      │                                          │
│  MCP接入 │                                          │
│          │                                          │
│ 关于     │                                          │
│  关于    │                                          │
└──────────┴──────────────────────────────────────────┘
```

### 2.2 Sidebar Specs

- Width: 200px
- Background: `var(--ant-color-bg-container)` (adapts to theme)
- Group headers: `Menu.ItemGroup` with muted label, 11px uppercase
- Menu items: 14px text, left-aligned, 32px height
- Active item: left 2px accent border + subtle bg highlight
- Scrollable vertically
- No icons on menu items (matching reference — text-only sidebar)

### 2.3 Content Area Specs

- Background: `var(--ant-color-bg-layout)` (slightly different from sidebar)
- Top bar: page title (18px semibold) + search input (right-aligned, 240px wide)
- Content: scrollable, max-width 800px, centered
- Padding: 0 24px 24px

## 3. Core Components

### 3.1 SettingRow

```tsx
interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;  // The control widget
  indent?: boolean;           // For nested settings
}
```

Visual specs:
- Min height: 48px
- Padding: 12px 0 (vertical), no horizontal (parent provides)
- Border-bottom: 1px solid `var(--ant-color-border-secondary)`
- Layout: flex, justify-between, items-start
- Label: 14px, `var(--ant-color-text)`
- Description: 12px, `var(--ant-color-text-secondary)`, margin-top 2px
- Control: flex-shrink-0, margin-left 24px, align-self center

### 3.2 SectionHeader

```tsx
interface SectionHeaderProps {
  title: string;
}
```

Visual specs:
- Text: 11px, uppercase, font-weight 600, `var(--ant-color-text-tertiary)`
- Padding: 20px 0 8px
- Border-bottom: 1px solid `var(--ant-color-border-secondary)`
- Letter-spacing: 0.5px

### 3.3 SettingsSearchBar

- Input with search icon prefix
- Placeholder: "搜索设置..."
- Width: 240px
- Border-radius: 6px
- Filters visible setting rows by label/description text

## 4. Page Specifications

### 4.1 通用设置 (General)

Source: screenshots 10.设置-通用1/2/3

**Section: 外观**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 语言 | Select | 简体中文, English (default: 简体中文) |
| 主题 | Select | All BUILT_IN_THEMES with color preview |
| 字体大小 | Slider | 10-20, step 1 (default: 14) |
| 界面缩放 | Slider | 80%-200%, step 10 (default: 100%) |

**Section: 启动与关闭**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 启动时恢复上次会话 | Switch | default: true |
| 关闭窗口行为 | Select | 最小化到托盘, 退出应用 (default: 最小化) |
| 显示托盘图标 | Switch | default: true |
| 开机自启动 | Switch | default: false |

**Section: 更新**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 自动检查更新 | Switch | default: true |
| 自动下载更新 | Switch | default: false |

**Section: 布局**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 紧凑模式 | Switch | default: false |
| 显示状态栏 | Switch | default: true |

### 4.2 Claude Code

Source: screenshots 4.设置-Clude页1/2/3/4

**Section: 模型**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 默认模型 | Select | claude-opus-4, claude-sonnet-4, claude-haiku-4 (with descriptions) |
| 思考强度 | Select | 低/中/高 (with color tags) |

**Section: 认证**
| Label | Type | Options/Default |
|-------|------|-----------------|
| API Key | Password + Verify button | masked input |
| Base URL | Input | placeholder: 可选，自定义 API 地址 |

**Section: 行为**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 自动提交 | Switch | default: false |
| 权限模式 | Select | 默认/宽松/严格 |
| 最大输出长度 | InputNumber | default: 8192 |

**Section: 自定义指令**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 全局自定义指令 | Textarea | 6 rows, placeholder with examples |

### 4.3 Codex CLI

Source: screenshot 5.设置-Codex

**Section: 模型**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 默认模型 | Select | codex-1, o3-mini, o4-mini |

**Section: 认证**
| Label | Type | Options/Default |
|-------|------|-----------------|
| API Key | Password + Verify | masked |
| Organization ID | Input | optional |

**Section: 行为**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 自动批准 | Switch | default: false |
| 沙箱模式 | Select | 禁用/严格/宽松 |

### 4.4 Gemini CLI

Source: screenshot 6.设置-Gemini

**Section: 模型**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 默认模型 | Select | gemini-2.5-pro, gemini-2.5-flash |

**Section: 认证**
| Label | Type | Options/Default |
|-------|------|-----------------|
| API Key | Password + Verify | masked |
| Google Cloud Project | Input | optional |

**Section: 行为**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 自动执行 | Switch | default: false |
| 安全级别 | Select | 标准/严格 |

### 4.5 Antigravity

Source: screenshot 7.设置-Antigravity

**Section: 认证**
| Label | Type | Options/Default |
|-------|------|-----------------|
| API Key | Password + Verify | masked |
| Endpoint | Input | optional |

**Section: 行为**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 默认模型 | Select | available models |
| 自动提交 | Switch | default: false |

### 4.6 OpenCode

Source: screenshot 8.设置-OpenCode

**Section: 模型**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 默认模型 | Select | available models |
| Provider | Select | openai/anthropic/local |

**Section: 认证**
| Label | Type | Options/Default |
|-------|------|-----------------|
| API Key | Password + Verify | masked |
| Base URL | Input | optional |

**Section: 行为**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 自动执行 | Switch | default: false |

### 4.7 终端设置

Source: screenshots 9.设置-终端1/2

**Section: Shell**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 默认 Shell | Select | 默认/Bash/Zsh/Fish/PowerShell/CMD |
| Shell 参数 | Input | optional |

**Section: 外观**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 字体 | Select | JetBrains Mono, Fira Code, etc. |
| 字号 | Slider | 10-20 (default: 14) |
| 行高 | Slider | 1.0-2.0 (default: 1.2) |
| 光标样式 | Select | Block/Line/Bar |
| 光标闪烁 | Switch | default: true |

**Section: 缓冲区**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 滚动缓冲区 | Slider | 1K-50K (default: 10K) |
| 回滚时暂停 | Switch | default: true |

**Section: 行为**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 终端响铃 | Switch | default: false |
| 复制选中内容 | Switch | default: true |
| 右键粘贴 | Switch | default: true |

**Section: 环境变量**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 自定义环境变量 | Textarea | KEY=VALUE per line |

### 4.8 AI 辅助

Source: screenshots 11-12.设置-AI辅助1-6

**Section: 代码补全**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 启用 AI 补全 | Switch | default: true |
| 补全延迟 | Slider | 0-1000ms (default: 300ms) |
| 补全提供者 | Select | 内置/Copilot/Tabnine |

**Section: 内联编辑**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 启用内联编辑 | Switch | default: true |
| 编辑模式 | Select | 逐行/整段 |

**Section: AI 聊天**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 聊天模型 | Select | same as default model |
| 上下文窗口 | Select | 4K/8K/16K/32K |
| 包含文件上下文 | Switch | default: true |

**Section: 代码解释**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 启用代码解释 | Switch | default: true |
| 解释详细度 | Select | 简要/标准/详细 |

### 4.9 网络

Source: screenshot 13.设置-网络

**Section: 代理**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 启用代理 | Switch | default: false |
| 代理类型 | Select | HTTP/SOCKS5/系统代理 |
| 代理地址 | Input | host:port |
| 代理认证 | Switch | default: false |
| 用户名 | Input | shown when auth enabled |
| 密码 | Password | shown when auth enabled |

**Section: 连接**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 连接超时 | InputNumber | seconds (default: 30) |
| 重试次数 | InputNumber | default: 3 |
| SSL 验证 | Switch | default: true |

### 4.10 远程访问

Source: screenshots 14-15.设置-远程访问1/2 + SSH

**Section: SSH**
| Label | Type | Options/Default |
|-------|------|-----------------|
| SSH 主机列表 | List + Add/Remove | host, port, user, key path |
| 添加 SSH 主机 | Button → Modal | host, port, user, auth type, key/pass |

**Section: 隧道**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 运行自签隧道 | Switch | default: false |
| 隧道端口 | InputNumber | default: 49999 |

### 4.11 快捷键

Source: screenshot 16.设置-快捷键

**Section: 全局快捷键**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 显示/隐藏窗口 | KeyBinding | default: Ctrl+Shift+T |
| 新建会话 | KeyBinding | default: Ctrl+N |
| 关闭会话 | KeyBinding | default: Ctrl+W |

**Section: 终端快捷键**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 复制 | KeyBinding | default: Ctrl+Shift+C |
| 粘贴 | KeyBinding | default: Ctrl+Shift+V |
| 清屏 | KeyBinding | default: Ctrl+L |
| 搜索 | KeyBinding | default: Ctrl+Shift+F |

**Section: 编辑快捷键**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 撤销 | KeyBinding | default: Ctrl+Z |
| 重做 | KeyBinding | default: Ctrl+Shift+Z |

Note: KeyBinding is a custom component — displays current binding, click to rebind.

### 4.12 通知

Source: screenshot 17.设置-通知

**Section: 通知方式**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 启用桌面通知 | Switch | default: true |
| 启用声音 | Switch | default: false |

**Section: 通知事件**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 会话完成 | Switch | default: true |
| 错误发生 | Switch | default: true |
| 费用预警 | Switch | default: true |
| 费用预警阈值 | InputNumber | USD (default: 10) |
| 版本更新 | Switch | default: true |

### 4.13 数据管理

Source: screenshot 18.设置-数据管理

**Section: 数据存储**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 数据目录 | Input + Browse | show current path |
| 数据库大小 | Text (read-only) | calculated |
| 会话数据 | Text (read-only) | count |

**Section: 数据操作**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 导出数据 | Button | → file dialog |
| 导入数据 | Button | → file dialog |
| 清除缓存 | Button | with confirm |
| 清除所有数据 | Button (danger) | with confirm |

### 4.14 同步

Source: screenshots 19.设置-同步1/2

**Section: 设置同步**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 启用设置同步 | Switch | default: false |
| 同步方式 | Select | WebDAV/Git/本地文件 |
| 同步地址 | Input | URL/path |
| 自动同步 | Switch | default: false |
| 同步间隔 | Select | 5min/15min/30min/60min |

**Section: 同步内容**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 同步通用设置 | Switch | default: true |
| 同步终端设置 | Switch | default: true |
| 同步快捷键 | Switch | default: true |
| 同步 Profile | Switch | default: false (contains keys) |

### 4.15 MCP 接入

Source: screenshots 20.设置-MCP接入1/2

**Section: MCP 服务器**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 服务器列表 | List | name, command, status indicator |
| 添加服务器 | Button → Modal | name, command, args, env |

Each server entry shows:
- Name + status dot (green/red)
- Command + args
- Edit/Delete actions

### 4.16 关于

Source: screenshot 21.设置-关于

**Section: 应用信息**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 应用名称 | Text | 茶码 CodingTea |
| 版本 | Text | v0.1.0 |
| 检查更新 | Button | → check |
| 更新通道 | Select | 稳定/Beta/Alpha |

**Section: 系统**
| Label | Type | Options/Default |
|-------|------|-----------------|
| 操作系统 | Text (read-only) | detected |
| 架构 | Text (read-only) | detected |
| Tauri 版本 | Text (read-only) | 2.x |

**Section: 链接**
- GitHub repo link
- 问题反馈 link
- 开源协议: MIT

## 5. File Structure

```
src/components/settings/
├── SettingsPage.tsx          # Shell: sidebar + content router
├── components/
│   ├── SettingRow.tsx        # Reusable row: label + control
│   ├── SectionHeader.tsx     # Section divider with title
│   ├── SettingsSearchBar.tsx # Search input for filtering
│   └── KeyBindingInput.tsx   # Keyboard shortcut capture
├── GeneralSettingsPage.tsx   # 通用设置
├── TerminalSettingsPage.tsx  # 终端设置
├── ClaudeSettingsPage.tsx    # Claude Code
├── CodexSettingsPage.tsx     # Codex CLI
├── GeminiSettingsPage.tsx    # Gemini CLI
├── AntigravitySettingsPage.tsx # Antigravity
├── OpenCodeSettingsPage.tsx  # OpenCode
├── AIAssistantPage.tsx       # AI 辅助
├── NetworkSettingsPage.tsx   # 网络
├── RemoteAccessPage.tsx      # 远程访问
├── KeybindingsPage.tsx       # 快捷键
├── NotificationPage.tsx      # 通知
├── DataManagementPage.tsx    # 数据管理
├── SyncPage.tsx              # 同步
├── McpAccessPage.tsx         # MCP 接入
└── AboutPage.tsx             # 关于
```

## 6. Style Tokens

All colors use Ant Design CSS variables for theme compatibility:

| Element | Light | Dark |
|---------|-------|------|
| Sidebar bg | `--ant-color-bg-container` | same (auto-adapts) |
| Content bg | `--ant-color-bg-layout` | same |
| Row border | `--ant-color-border-secondary` | same |
| Label text | `--ant-color-text` | same |
| Description | `--ant-color-text-secondary` | same |
| Section header | `--ant-color-text-tertiary` | same |
| Active item bg | `--ant-color-primary-bg` | same |
| Active item border | `--ant-color-primary` | same |

## 7. Persistence Strategy

- App-level settings (通用, 终端, 快捷键, 通知, AI辅助): `localStorage` with key `codingtea_<page>_settings`
- Tool settings (Claude, Codex, Gemini, etc.): Tauri IPC → SQLite `tool_settings` table (profile-scoped)
- MCP servers: Tauri IPC → SQLite (new `mcp_servers` table if needed, or JSONL)
- Remote SSH hosts: Tauri IPC → SQLite (new `ssh_hosts` table)
- Sync config: Tauri IPC → SQLite

## 8. Implementation Order

1. Core components: SettingRow, SectionHeader, SettingsSearchBar
2. SettingsPage shell (sidebar + content router)
3. GeneralSettingsPage (rewrite from Card to flat rows)
4. TerminalSettingsPage (rewrite)
5. ClaudeSettingsPage (rewrite)
6. CodexSettingsPage (new)
7. GeminiSettingsPage (new)
8. AntigravitySettingsPage (new)
9. OpenCodeSettingsPage (new)
10. AIAssistantPage (new)
11. NetworkSettingsPage (new)
12. RemoteAccessPage (new)
13. KeybindingsPage (new)
14. NotificationPage (new)
15. DataManagementPage (new)
16. SyncPage (new)
17. McpAccessPage (new)
18. AboutPage (rewrite)
19. Visual iteration with Playwright

## 9. Out of Scope

- Backend IPC commands for new pages (use localStorage for now, migrate later)
- Actual SSH connection functionality (UI only)
- Actual sync functionality (UI only)
- Actual MCP server management (UI only)
- KeyBinding capture (use display-only for now, capture in follow-up)
