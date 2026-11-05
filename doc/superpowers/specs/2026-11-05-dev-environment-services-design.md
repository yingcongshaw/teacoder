# 开发环境 + 服务(Services)面板 设计文档

日期：2026-11-05
状态：待实现

## 1. 背景与目标

TeaCoder 目前能管理 CLI 工具、Profile、项目、会话，但缺少两件事：

1. **开发环境**：用户机器上装了多套 JDK / Maven / Node，不同项目要用的版本不同，TeaCoder 不知道、也不能在项目上记住"这个项目要用 JDK 21 + Maven 3.9.11 + Node 22.13.1"。
2. **服务管理**：像 IDEA 的 Services 面板那样，把一个项目里"能跑起来的东西"（Spring Boot 服务、Node 脚本）集中列出来，能启动、能停止、能看输出。

本设计要交付四个功能点：

| 编号 | 需求 |
| --- | --- |
| F1 | 设置页新增「开发环境」分组，含 Java 环境、Node 环境两个子项，可配置版本与路径，可自动识别后入库 |
| F2 | 新建/编辑项目时可选「运行环境」（Java 环境一条 + Node 环境一条）；编辑项目时项目路径锁定不可改 |
| F3 | 左侧栏项目列表右键菜单在「重命名」与「打开文件浏览器」之间插入「编辑项目」，弹出编辑项目窗口 |
| F4 | 主页面右侧栏底部「快捷命令」左侧新增「服务」图标按钮，点开一个贴靠自己的浮窗，内含服务列表、启停、删除、实时日志、「服务识别」按钮与「所有项目 / 本项目」开关 |

### 目标

- 开发环境配置可被项目引用，并在**服务启动时真实生效**（注入 `JAVA_HOME` / `PATH`）。
- 服务识别能做到 IDEA 级别的"够用"：Maven 多模块按子模块出服务，Node 按 `package.json` scripts 出服务。
- 服务进程为**后台独立进程**，不占用终端标签页；面板内可看实时输出。
- 全部数据落在本地 SQLite，零云端依赖。

### 非目标

- 不做通用的"运行配置(Run Configuration)"体系，只做「服务」这一种形态。
- 不做 Spring Boot 应用的打包产物管理（不识别 `target/*.jar`）。
- 不做 Gradle 的完整多模块解析（只识别含 Spring Boot 插件的模块）。
- 不做 Docker / 容器编排。

### 反目标（做成这样算失败）

- 「服务识别」必须**全自动**并持久化，不允许要求用户手工逐条录入才算完成。
- 服务启动后不能因为会话/标签页关闭而被动终止（后台进程独立于 PTY 生命周期）。
- 不允许把 API Key 写进新增的任何表或日志。

---

## 2. 已确认的设计决策

以下是用户在本轮明确拍板的四项，其余为我的判断（已标注"我的判断"）。

| 决策 | 结论 |
| --- | --- |
| 开发环境条目结构 | **Java / Node 两条独立记录**。Java 环境条目 = {JDK版本, JDK路径, Maven版本, Maven路径}；Node 环境条目 = {Node版本, Node路径}。项目上分别选一条 Java 环境 + 一条 Node 环境 |
| 服务识别规则 | **Spring Boot + Node 脚本**（IDEA 式启发式）。Java：扫 pom.xml/build.gradle，命中 spring-boot 的模块找 main 类；Node：读 package.json 的 scripts |
| 手动添加服务 | **要**。额外提供「+ 添加服务」按钮，支持自定义名称 + 启动命令 + 工作目录 |
| 服务运行形态 | **后台独立进程 + 面板内看实时日志**。不用 PTY |
| 运行环境的作用范围 | **同时注入该项目的终端/CLI 会话（PTY）**。不只是启动服务时生效 —— 在项目终端里敲 `mvn -v` 也该是项目绑定的那套 |
| 服务识别范围 | **跟随「所有项目 / 本项目」开关**。本项目模式只识别当前项目；所有项目模式扫描全部项目 |
| 删除后再识别 | **会重现**（与 IDEA 一致）。识别只增不减 |

我的判断（可被否决，但实现按此走）：

- 开发环境条目落到**同一张表**，用 `kind` 字段区分 `java` / `node`，而不是两张表。理由：CRUD 命令可共用一套，前端两个页面也能共用组件。
- 服务面板的「所有项目 / 本项目」开关**默认「本项目」**，打开即看当前会话所属项目。
- 服务的运行环境**不单独存**，启动时实时取项目当前绑定的环境。这样切换项目环境后所有服务立即跟着变。
- **服务命令存裸程序名**（`mvn` / `npm`），运行时靠注入的 PATH 解析。这样 fingerprint 与环境无关，切环境不会让同一个模块变成两条服务。
- 不引入任何新的 Rust crate（`sysinfo` / `which` 等一律不加）。进程判活用 std 的 `Child::try_wait()`，跨平台；Unix 杀进程组用已有的 `libc`，Windows 用 `taskkill /T /F`。
- 删除项目时先停掉该项目正在跑的服务进程；应用退出时停掉全部服务进程（不留孤儿）。

---

## 3. 数据模型

### 3.1 迁移 v17：开发环境

`src-tauri/migrations/v17_dev_environments.sql`

```sql
-- Schema v17: 开发环境配置（JDK/Maven 一组，Node 一组）
CREATE TABLE IF NOT EXISTS dev_environments (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('java', 'node')),
    name TEXT NOT NULL,
    jdk_version TEXT,
    jdk_path TEXT,
    maven_version TEXT,
    maven_path TEXT,
    node_version TEXT,
    node_path TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dev_environments_kind ON dev_environments(kind);

-- 项目绑定两条环境：一条 Java 环境、一条 Node 环境
ALTER TABLE projects ADD COLUMN java_env_id TEXT REFERENCES dev_environments(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN node_env_id TEXT REFERENCES dev_environments(id) ON DELETE SET NULL;

INSERT INTO schema_version (version, applied_at) VALUES (17, strftime('%s','now') * 1000);
```

字段语义：

- `kind='java'` 的行，`jdk_*` / `maven_*` 有效，`node_*` 恒为 NULL。
- `kind='node'` 的行，反之。
- 一行允许只填 JDK 只填 Maven（自动识别会产出这种行）。

### 3.2 迁移 v18：服务

`src-tauri/migrations/v18_services.sql`

```sql
-- Schema v18: 服务定义
CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    command TEXT NOT NULL,
    working_dir TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('detected', 'manual')),
    fingerprint TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_services_fingerprint
    ON services(project_id, fingerprint);

INSERT INTO schema_version (version, applied_at) VALUES (18, strftime('%s','now') * 1000);
```

- `kind`：`java` | `node` | `command`（手动添加的一般是 `command`）。
- `fingerprint` = `kind + "|" + working_dir + "|" + command`，用于「已有的不再添加」。唯一索引保证幂等。
- 运行状态（pid / 启动时间）**不入库**，进程活不活是运行时事实，放内存。

### 3.3 迁移登记

- `src-tauri/src/storage/mod.rs` 的 `EMBEDDED_MIGRATIONS` 追加 v17、v18 两项（漏登记会被 `embedded_migrations_match_migrations_dir` 测试拦下）。
- `src-tauri/src/storage/mod.rs` 的 `fresh_database_gets_all_tables` 期望表清单追加 `dev_environments`、`services`。

---

## 4. 后端设计

### 4.1 模块划分

```
src-tauri/src/
├── dev_env/
│   ├── mod.rs        # DevEnvironment 结构 + CRUD
│   └── detector.rs   # JDK / Maven / Node 自动识别
├── services/
│   ├── mod.rs        # Service 结构 + CRUD + 识别编排
│   ├── detector.rs   # Spring Boot / Node 服务识别
│   └── runtime.rs    # 后台进程管理 + 日志环形缓冲 + 事件
├── commands/
│   ├── dev_env.rs    # IPC 薄封装
│   └── service.rs    # IPC 薄封装
```

### 4.2 开发环境 CRUD

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevEnvironment {
    pub id: String,
    pub kind: String,          // "java" | "node"
    pub name: String,
    pub jdk_version: Option<String>,
    pub jdk_path: Option<String>,
    pub maven_version: Option<String>,
    pub maven_path: Option<String>,
    pub node_version: Option<String>,
    pub node_path: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}
```

函数（`dev_env/mod.rs`）：

| 函数 | 说明 |
| --- | --- |
| `list_dev_environments(db, kind: Option<String>)` | `kind` 为 None 时返回全部 |
| `create_dev_environment(db, input)` | 生成 uuid v4 |
| `update_dev_environment(db, id, input)` | 全量字段更新 |
| `delete_dev_environment(db, id)` | 删条目；项目侧靠 `ON DELETE SET NULL` 自动解绑 |

IPC 命令名：`dev_environment_list` / `dev_environment_create` / `dev_environment_update` / `dev_environment_delete` / `dev_environment_detect`。

### 4.3 自动识别（JDK / Maven / Node）

`dev_env/detector.rs`。

**找可执行文件**（跨平台，不 shell out `which`）：

```rust
fn find_in_path(name: &str) -> Option<PathBuf>
```

按 `std::env::split_paths(&env::var_os("PATH")?)` 逐目录找；Unix 找 `<dir>/<name>` 且可执行；Windows 依次试 `PATHEXT` 里的 `.exe/.cmd/.bat`。

**探测版本**：

| 工具 | 命令 | 解析 | 备注 |
| --- | --- | --- | --- |
| JDK | `java -version` | `openjdk version "21.0.2" 2024-01-16` → `21.0.2` | 版本输出在 **stderr** |
| Maven | `mvn -version` | `Apache Maven 3.9.6 (...)` → `3.9.6` | stdout |
| Node | `node --version` | `v22.13.1` → `22.13.1` | stdout，去掉前缀 `v` |

**扫描目录**（每个候选根目录下列出子目录，逐个探测）：

| 工具 | 候选根目录 |
| --- | --- |
| JDK | `/usr/lib/jvm`、`/opt/java`、`/opt/jdk*`、`~/.sdkman/candidates/java`、`~/.jdks`（IntelliJ）、`~/.gradle/jdks`、`/Library/Java/JavaVirtualMachines`、`C:\Program Files\Java`、`C:\Program Files\Eclipse Adoptium`、`C:\Program Files\Microsoft` |
| Maven | `/opt/maven*`、`/usr/share/maven`、`~/.sdkman/candidates/maven`、`~/.m2/wrapper/dists`（跳过，太深）、`C:\Program Files\Apache\maven`、`C:\apache-maven*` |
| Node | `~/.nvm/versions/node`、`~/.volta/tools/image/node`、`/usr/local/n/versions/node`、`/opt/node*`、`C:\Program Files\nodejs`、`%APPDATA%\nvm` |

候选目录下找 `bin/java`（Unix）/ `bin\java.exe`（Windows），其父目录即 JDK 根目录。Maven 找 `bin/mvn`。Node 找目录下的 `bin/node`（或 `node.exe`）。

**生成条目**（`java` kind）：

设 JDK 列表 `J`（按版本倒序）、Maven 列表 `M`（按版本倒序）：

- `J` 中每个 JDK 生成一条记录，`maven_*` 填 `M[0]`（若存在）。名称：`"JDK 21.0.2"`（无 Maven）或 `"JDK 21.0.2 + Maven 3.9.6"`。
- `M` 中除 `M[0]` 外的每个 Maven，各生成一条**仅 Maven** 的记录（`jdk_*` 为空），名称 `"Maven 3.9.6"`。
- `J` 为空时，`M` 中每个 Maven 各生成一条仅 Maven 记录。

`node` kind：每个 Node 生成一条记录，名称 `"Node 22.13.1"`。

**去重**：同一张表内，若已存在 `kind` 与 `(jdk_path, maven_path, node_path)` 组合完全相同的行，跳过不新增。

**返回值**：`detect_dev_environments` 返回 `{ created: Vec<DevEnvironment>, skipped: usize }`，前端 toast 提示"新增 N 条，跳过 M 条（已存在）"。

### 4.4 项目绑定环境

`project/mod.rs`：

```rust
pub struct Project {
    // ...既有字段
    pub java_env_id: Option<String>,
    pub node_env_id: Option<String>,
}

pub struct CreateProjectInput {
    pub name: String,
    pub path: String,
    pub color: Option<String>,
    pub java_env_id: Option<String>,
    pub node_env_id: Option<String>,
}

pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub color: Option<String>,
    /// 双层 Option：外层 None = 不修改；Some(None) = 清空绑定。
    /// serde 默认把 JSON 的 null 也解成外层 None，必须配 double_option 反序列化器
    /// 才能区分「字段缺失」与「字段为 null」。
    #[serde(default, deserialize_with = "double_option")]
    pub java_env_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub node_env_id: Option<Option<String>>,
}

/// serde 对 `Option<Option<T>>` 的 null 会走 `visit_none`，与「字段缺失」不可区分。
/// 包一层把 null 映射成 Some(None)，default 兜住缺失的字段。
fn double_option<'de, T, D>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    serde::Deserialize::deserialize(de).map(Some)
}
```

`update_project` 的动态 SQL 保持现有风格，只在字段为 `Some` 时拼进 SET 子句。**path 依旧不可改**（`UpdateProjectInput` 没有 path 字段），编辑弹窗把路径输入框 `disabled` 即可满足"锁定项目路径"。

`PROJECT_COLUMNS` 常量追加两列；`list_projects` / `create_project` / `update_project` 的 SELECT 同步。

### 4.5 服务识别

`services/detector.rs`，入口 `detect_services(project_path, java_env, node_env) -> Vec<DetectedService>`。

**遍历**：用已有的 `walkdir` crate 扫项目目录，**跳过** `target`、`node_modules`、`.git`、`build`、`dist`、`out` 目录，深度上限 6 层。

**Java 侧（Maven）**：

对每个 `pom.xml`：

1. 读 XML 文本，判定是否含 `spring-boot-starter`（`<artifactId>`）或 `spring-boot-maven-plugin`。
2. 命中 → 该 pom 所在目录是一个候选模块。
3. 找 main class：在 `<module>/src/main/java` 下找 `.java` 文件，内容含 `public static void main`。取**第一个**（按文件名排序稳定取）转成全限定类名（包路径 + 类名）。
4. 生成命令与工作目录：
   - **在模块目录内执行** `mvn spring-boot:run [-Dspring-boot.run.mainClass=<fqcn>]`，`working_dir = <模块目录>`。
   - 不用 `-pl` 从根目录跑：`-pl` 不带 `-am` 时父 POM 没 install 到本地仓库会直接构建失败；在模块目录里跑 Maven 会顺 `relativePath` 找到父 POM，更稳。
   - 找不到 main class 时不带 `-Dspring-boot.run.mainClass=`（交给插件自动推断）。
5. 命令里存**裸程序名 `mvn`**，不写绝对路径。运行时靠注入的 PATH 解析 —— 这样 fingerprint 与环境无关，换环境后重新识别不会把同一个模块变成两条服务。
6. 服务名：模块名（Maven `<artifactId>`，缺失则用目录名），如 `tea-api`。

**Java 侧（Gradle）**：

对每个 `build.gradle` / `build.gradle.kts`：含 `org.springframework.boot` 插件 → 候选模块。
- 命令：`gradle :<模块>:bootRun`，`working_dir = <项目根>`（gradle wrapper 在根，`settings.gradle` 也只在根生效）。
- 项目根存在可执行的 `gradlew` 时用 `./gradlew :<模块>:bootRun`。

**Node 侧**：

对每个 `package.json`（跳过 `node_modules` 内的）：

1. 解析 `scripts` 对象。
2. 取 `start` / `dev` / `serve` 三个键（存在才取）。
3. 命令 `npm run <script>`，工作目录 = `package.json` 所在目录。
4. 服务名：`<package.json 的 name 或目录名>:<script>`，如 `web:dev`。

**Node 侧（pnpm/yarn）**：仅用 `npm run`，不猜包管理器（避免猜错）。

**去重**：对生成的每条服务算 `fingerprint = kind|working_dir|command`，与库中已有行比对；已有则跳过。

**持久化**：`source='detected'` 写入 `services` 表。**只增不减** —— 用户手工删掉的服务，下次识别会重新出现（与 IDEA 删掉 run configuration 后重新 import 会再出现一致）。

**识别范围**：跟随面板开关。本项目模式只识别当前项目；所有项目模式逐个识别全部项目。IPC 参数 `project_id: Option<String>`，None = 全部项目。

### 4.6 服务运行时

`services/runtime.rs`。

```rust
struct ServiceRuntime {
    child: std::process::Child,
    pid: u32,
    started_at: i64,
}
```

进程注册表：`static SERVICE_RUNTIMES: Lazy<Mutex<HashMap<String, ServiceRuntime>>>`（用 `once_cell` 惰性初始化，项目已有该依赖）。

**启动** `start_service(service_id)`：

1. 从 `services` 表取记录 → `command`、`working_dir`、所属项目。
2. 构造环境变量（见 §4.8 的共用函数 `build_project_env`）：
   - 若项目绑定了 Java 环境：`JAVA_HOME=<jdk 根>`、`M2_HOME`/`MAVEN_HOME=<maven 根>`；`PATH` 前置 `<jdk 根>/bin`、`<maven 根>/bin`。
   - 若项目绑定了 Node 环境：`PATH` 前置 node 可执行文件所在目录。
   - 保留父进程 `PATH` 其余部分。
3. 命令解析：按空白切成 program + args（**不做 shell 解释**，不执行 `&&`、管道等）。
4. **可执行文件解析**：
   - 用 `dev_env::detector::find_in_path(program)` 定位实际可执行文件（Windows 上会按 `PATHEXT` 找到 `npm.cmd`）。
   - Unix：直接 exec 该路径。
   - Windows：若解析到的是 `.cmd` / `.bat`，改用 `cmd.exe /C <exe> <args...>` 包装 —— `.cmd` 不能被直接 exec。
5. `Command::new(program).args(args).current_dir(working_dir).envs(...).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())`。
   - Unix：`use std::os::unix::process::CommandExt; cmd.process_group(0);` 让子进程成为独立进程组，便于整组终止。
6. `spawn()` 后取 pid，登记到注册表。
7. 两个后台线程分别读 stdout / stderr，**按行**累积到该服务的环形缓冲（上限 200 行 / 64KB），并 `app.emit("service:output", ServiceOutput { service_id, data })`。
8. 再起一个看门线程 `child.wait()`：进程退出时从注册表摘除并 `app.emit("service:exit", ...)` —— 否则没有轮询点，进程死了面板还显示「运行中」。

**停止** `stop_service(service_id)`：

- Unix：`libc::kill(-pid, SIGTERM)`（负 pid = 整个进程组）。等 2 秒仍在 → `libc::kill(-pid, SIGKILL)`。
- Windows：`taskkill /T /F /PID <pid>`。
- 之后从注册表移除并 `reap` 子进程（看门线程里的 `wait()` 负责），避免僵尸。

**判活**：注册表里有记录即视为运行中；进程退出由看门线程摘除。

**日志** `service_logs(service_id, limit)`：返回该服务环形缓冲最近 `limit` 行。

**事件**：

| 事件 | payload |
| --- | --- |
| `service:output` | `{ serviceId: String, data: String }` |
| `service:exit` | `{ serviceId: String, exitCode: Option<i32> }` |

**运行状态查询** `service_running_states()`：返回 `Vec<{ serviceId, running, pid, startedAt }>`，前端面板打开时拉一次，之后靠事件增量更新。

**清理**：
- 删除项目时，先停掉该项目所有正在跑的服务，再删项目行 —— 否则服务行被级联删掉后进程还在跑，用户再也停不掉它。
- 应用退出时停掉全部服务进程，不留孤儿。

### 4.7 服务 CRUD

`services/mod.rs`：

| 函数 | 说明 |
| --- | --- |
| `list_services(db, project_id: Option<String>)` | project_id 为 None 时返回全部（"所有项目"模式） |
| `create_service(db, input)` | 手动添加，`source='manual'` |
| `delete_service(db, id)` | 先停进程再删行 |
| `detect_and_persist_services(db, project_id: Option<String>)` | 识别 + 入库 + 返回新增/跳过统计；None = 全部项目 |

IPC 命令名：`service_list` / `service_create` / `service_delete` / `service_detect` / `service_start` / `service_stop` / `service_logs` / `service_states`。

### 4.8 运行环境注入（服务与 PTY 会话共用）

`dev_env::build_project_env(project, envs) -> Vec<(String, String)>` —— 服务启动与 PTY 会话启动都调它，保证两边一致。

输入：项目绑定的 Java 环境条目与 Node 环境条目（都没有则返回空，不改任何环境）。

产出（按此顺序叠加）：

| 变量 | 值 |
| --- | --- |
| `JAVA_HOME` | JDK 根目录 |
| `M2_HOME` / `MAVEN_HOME` | Maven 根目录 |
| `PATH` | 前置 `<jdk 根>/bin`、`<maven 根>/bin`、`<node 可执行文件所在目录>`，其后接原 PATH |

**路径口径**（三处统一，检测器与运行时一致）：

| 字段 | 含义 |
| --- | --- |
| `jdk_path` | JDK 安装根目录，其下有 `bin/java` |
| `maven_path` | Maven 安装根目录，其下有 `bin/mvn` |
| `node_path` | node **可执行文件**的完整路径 |

用户手填时按 `resolve_tool_home` 归一：给根目录或给可执行文件都认，Node 允许直接填目录（解析成 `<目录>/bin/node`）。

**PTY 会话注入**（`pty/manager.rs::start_session`）：会话的 `project_id` → 查项目绑定的环境 → 把 `build_project_env` 的结果合并进 PTY 的 env_vars（用户自己设的同名环境变量优先，不被覆盖）。这样在该项目终端里敲 `mvn -v` / `node -v` 就是绑定的版本。


---

## 5. 前端设计

### 5.1 类型（`src/types/index.ts`）

```ts
export interface DevEnvironment {
  id: string;
  kind: "java" | "node";
  name: string;
  jdkVersion?: string;
  jdkPath?: string;
  mavenVersion?: string;
  mavenPath?: string;
  nodeVersion?: string;
  nodePath?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Service {
  id: string;
  projectId: string;
  name: string;
  kind: "java" | "node" | "command";
  command: string;
  workingDir: string;
  source: "detected" | "manual";
  fingerprint: string;
  createdAt: number;
  updatedAt: number;
}

export interface ServiceRuntimeState {
  serviceId: string;
  running: boolean;
  pid?: number;
  startedAt?: number;
}
```

`Project` 追加 `javaEnvId?: string; nodeEnvId?: string;`。

### 5.2 F1 设置页「开发环境」

**菜单**（`SettingsPage.tsx`）—— 插在「CLI 工具」组与「AI 辅助」之间：

```ts
{
  key: "dev-env-group",
  label: "开发环境",
  icon: <CodeSandboxOutlined />,
  children: [
    { key: "dev-env-java", label: "Java 环境", icon: <JavaOutlined /> },
    { key: "dev-env-node", label: "Node 环境", icon: <NodejsOutlined /> },
  ],
}
```

注意 `SettingsPage.tsx:182-184` 的 `onClick` 目前只跳过 `"cli-tools-group"`，新增的父组 key `"dev-env-group"` 也要跳过（否则点父标题会切到一个不存在的页面）。改成白名单式判断。

`PAGE_TITLES` 追加 `"dev-env-java": "Java 环境"`、`"dev-env-node": "Node 环境"`。
`renderContent()` 追加两个 case，分别渲染 `<DevEnvironmentPage kind="java" />` / `<DevEnvironmentPage kind="node" />`。

**页面组件** `src/components/settings/DevEnvironmentPage.tsx`：

- 顶部说明 + 「自动识别」按钮（调用 `devEnvironmentDetect(kind)`，成功后 reload + toast）。
- 条目列表：AntD `Table` 或简单列表。每条显示名称、JDK/Maven/Node 版本与路径；操作：编辑、删除。
- 「添加条目」按钮 → 编辑弹窗。
- Java 环境页面的编辑项：名称、JDK 版本、JDK 路径、Maven 版本、Maven 路径。
- Node 环境页面的编辑项：名称、Node 版本、Node 路径。
- 路径字段用 `Input` + `addonAfter` 浏览按钮（`@tauri-apps/plugin-dialog` 的 `open({ directory: true })`），沿用 `NewProjectModal.tsx:27-36` 的写法。
- 风格沿用 `settings/components/SectionHeader.tsx` 与 `SettingRow.tsx`。

### 5.3 F2/F3 项目编辑

**共用组件** `src/components/project/ProjectEnvSelects.tsx`：两个 AntD `Select`，`Java 环境` / `Node 环境`，选项来自 `devEnvironmentList(kind)`，`allowClear`，空值 = 不绑定。

**新建项目** `NewProjectModal.tsx`：在颜色选择下方插入 `<ProjectEnvSelects />`，提交时把 `javaEnvId` / `nodeEnvId` 一起传给 `projectCreate`。

**编辑项目** 新增 `src/components/project/EditProjectModal.tsx`：

- 与 `NewProjectModal` 同构（AntD `Modal` + 受控 `Input` + 手写校验 + `message.warning`）。
- 标题「编辑项目」，`okText="保存"`。
- 项目路径 `Input` **disabled**，且不渲染「浏览」按钮 —— 满足"锁定项目路径不可修改"。
- 项目名称可改、颜色可改、运行环境可改。
- 提交调 `projectUpdate(id, { name, color, javaEnvId, nodeEnvId })`。

**右键菜单**（`ProjectNode.tsx:385-425` 的 `contextMenuItems`）：在 `rename`（重命名）之后、`openInFileManager`（打开文件浏览器）之前插入：

```ts
{
  key: "editProject",
  label: "编辑项目",
  icon: <FormOutlined />,
  onClick: () => setEditingProjectId(project.id),
},
```

（`EditOutlined` 已被「重命名」占用。）

**store**：新增 `editingProjectId: string | null` + `setEditingProjectId(id)`。`AppLayout.tsx` 挂载 `<EditProjectModal open={!!editingProjectId} project={...} onClose={...} />`。

### 5.4 F4 服务面板

**入口**（`AppContent.tsx:390-421`）：底部 bar 内，快捷命令**左侧**加一个同款式的按钮：

```tsx
<div className="relative inline-flex">
  <span ref={servicesBtnRef} onClick={...} className="flex items-center gap-1 text-xs cursor-pointer px-2 py-1 rounded ...">
    <CloudServerOutlined style={{ fontSize: 12 }} />
    <span>服务</span>
  </span>
  <ServicesPanel visible={servicesVisible} onClose={...} anchorRef={servicesBtnRef} />
</div>
```

面板用 `absolute bottom-full mb-1 right-0`，底部对齐到「服务」按钮的右上角 —— 与快捷命令面板同一套定位手法（`QuickCommands.tsx:77-81`）。因为面板比按钮宽，面板右边缘对齐按钮右边缘即可（`right-0`）。

**面板内容** `src/components/services/ServicesPanel.tsx`：

```
┌──────────────────────────────────────────┐
│ 服务                       [本项目|所有项目] │  ← Switch
│                              [服务识别] [+] │  ← 服务识别按钮 + 添加服务按钮
├──────────────────────────────────────────┤
│ ▸ tea-api      ● 运行中      [停止] [删除] │
│ ▸ web:dev      ○ 已停止      [启动] [删除] │
├──────────────────────────────────────────┤
│ 日志输出（展开某个服务时显示）            │
│ [12:03:21] INFO  Started TeaApi...        │
└──────────────────────────────────────────┘
```

- **右上角顺序**：Switch（所有项目 / 本项目）在最右，「服务识别」按钮在 Switch **前左**，再往左是「+ 添加服务」。用户原话："窗口的右上角加入一个 服务识别 按钮"、"在 服务识别 按钮前左，加入一个 Switch"。
  实际排布（左 → 右）：`+ 添加服务` · `服务识别` · `Switch`。Switch 放最右。

  用户说 Switch 在「服务识别」按钮**前左** —— 中文语境"前左"= 左边。嗯，用户明确定位了 Switch 在服务识别按钮的左前方。那顺序是：Switch → 服务识别 → (+添加)。但 Switch 放最右更符合"右上角加入服务识别按钮"的描述……

  用户原话："窗口的右上角加入一个 服务识别 按钮，点击后…"；"窗口的右上角 服务识别 按钮前左，加入一个Switch开关"。所以：服务识别在最右上角，Switch 在它的左边（略靠下无所谓，同一行）。最终顺序（左 → 右）：`+ 添加服务` · `Switch(所有项目/本项目)` · `服务识别`。

  我按这个来。

- **Switch**：两个状态 `本项目` / `所有项目`。默认「本项目」。文案用 `Switch` 的 checkedChildren / unCheckedChildren：`所有项目` / `本项目`。
- **当前项目**：从 `activeTabId` → `sessions.find(...)` → `projectId` → `projects.find(...)`（沿用 `TerminalView.tsx:354-357` 的两跳写法）。
- **本项目模式**：只列当前项目服务；当前无项目时列表区显示"当前会话未关联项目"，且「服务识别」按钮置灰（tooltip 提示先打开一个会话）。
- **所有项目模式**：列出全部服务，按项目分组（组头显示项目名）。「服务识别」按钮扫描所有项目。
- **每行**：服务名、运行状态点、启动/停止按钮、删除按钮。点击行展开日志区。
- **状态更新**：面板打开时 `serviceStates()` 拉一次；订阅 `service:output`（追加到展开服务的日志区）与 `service:exit`（改状态）。

**手动添加** `src/components/services/ServiceAddModal.tsx`：AntD Modal，字段：服务名、启动命令、工作目录（默认当前项目路径）、类型（java/node/command，默认 command）。提交 `serviceCreate`。

**启动/停止**：`serviceStart(id)` / `serviceStop(id)`，调用后刷新状态。

**删除**：`serviceDelete(id)`，前端 `Popconfirm` 二次确认。

### 5.5 IPC 封装（`src/utils/ipc.ts`）

```ts
// Dev Environment IPC
export async function devEnvironmentList(kind?: "java" | "node"): Promise<DevEnvironment[]>
export async function devEnvironmentCreate(input: {...}): Promise<DevEnvironment>
export async function devEnvironmentUpdate(id: string, input: {...}): Promise<DevEnvironment>
export async function devEnvironmentDelete(id: string): Promise<void>
export async function devEnvironmentDetect(kind: "java" | "node"): Promise<{ created: DevEnvironment[]; skipped: number }>

// Service IPC
export async function serviceList(projectId?: string): Promise<Service[]>
export async function serviceCreate(input: {...}): Promise<Service>
export async function serviceDelete(id: string): Promise<void>
/** projectId 省略 = 识别所有项目（对应面板的「所有项目」模式） */
export async function serviceDetect(projectId?: string): Promise<{ created: Service[]; skipped: number }>
export async function serviceStart(id: string): Promise<void>
export async function serviceStop(id: string): Promise<void>
export async function serviceLogs(id: string, limit?: number): Promise<string[]>
export async function serviceStates(): Promise<ServiceRuntimeState[]>
```

---

## 6. 命令注册

`src-tauri/src/lib.rs` 的 `generate_handler!` 追加：

```rust
commands::dev_env::dev_environment_list,
commands::dev_env::dev_environment_create,
commands::dev_env::dev_environment_update,
commands::dev_env::dev_environment_delete,
commands::dev_env::dev_environment_detect,
commands::service::service_list,
commands::service::service_create,
commands::service::service_delete,
commands::service::service_detect,
commands::service::service_start,
commands::service::service_stop,
commands::service::service_logs,
commands::service::service_states,
```

`commands/mod.rs` 追加 `pub mod dev_env;` 与 `pub mod service;`。

`service_start` / `service_stop` 需要 `AppHandle` 以 emit 事件。

---

## 7. 已知风险与取舍

| 风险 | 处置 |
| --- | --- |
| `mvn spring-boot:run` 首次运行需下载依赖，耗时长 | 服务在后台跑，前端只显示"启动中"，不阻塞 UI |
| 停止服务时子进程派生孙进程 | Unix 靠进程组（`process_group(0)` + `kill(-pid)`）；Windows 靠 `taskkill /T` |
| Windows 没有 `which` | 自己实现 `find_in_path`，按 `PATHEXT` 试后缀 |
| `java -version` 输出在 stderr | 探测时合并 stdout + stderr 再解析 |
| pom.xml 用字符串匹配 XML | 可接受：只判定 artifactId / plugin 是否含 `spring-boot`，不追求严格 XML 解析（避免引入新依赖） |
| 识别结果可能误报 | 服务识别只作为**建议**，用户可在面板里删除误报项 |
| 删除项目时其服务连带删除 | `ON DELETE CASCADE`，符合预期 |

## 8. 验收标准

1. 设置页「CLI 工具」与「AI 辅助」之间出现「开发环境」，展开有「Java 环境」「Node 环境」两项。
2. Java 环境页可增删改条目，含 JDK 版本/路径、Maven 版本/路径；「自动识别」能扫出本机 JDK/Maven 并入库，重复识别不产生重复条目。
3. Node 环境页同理，含 Node 版本/路径。
4. 新建项目弹窗出现「运行环境」两个下拉，选中的环境在项目上被记住。
5. 侧边栏项目右键菜单在「重命名」与「打开文件浏览器」之间出现「编辑项目」，点开弹窗；弹窗里项目路径框为禁用态且无法修改；改运行环境后保存生效。
6. 主页面右下「快捷命令」左侧出现「服务」图标按钮，点击浮出贴靠自己的窗口。
7. 面板右上角有「服务识别」按钮与其左侧的「所有项目 / 本项目」开关。
8. 对一个含 Spring Boot 的 Maven 项目点「服务识别」，能列出各子模块服务并持久化；重复点不重复添加。
9. 对一个含 `package.json` 的项目点「服务识别」，能列出 `start`/`dev`/`serve` 服务。
10. 服务能启动、能停止、能在面板里看到实时输出；停止后进程确实消失（含孙进程）。
11. 「所有项目」开关切到开后，能看到其他项目的服务；切回只显示当前项目服务。
12. 「+ 添加服务」可手工添加一条自定义服务，并同样支持启停与删除。
13. `cargo clippy` 无 warning，`cargo test` 通过，`pnpm exec tsc --noEmit` 通过。

## 9. 待施工者确认的小项

以下是我的判断，实现时按此执行，如有异议请提出：

1. Java 环境自动识别时，多 JDK 会生成多条记录，Maven 取最新那个填入；多余的 Maven 各自生成一条「仅 Maven」记录。
2. Node 服务只用 `npm run`，不猜 pnpm/yarn。
3. 服务识别只认 Spring Boot（含 `spring-boot-maven-plugin` 或 `spring-boot-starter` 的模块），不识别普通 Java main 方法。
4. Gradle 只识别含 `org.springframework.boot` 插件的模块，命令为 `gradle :<module>:bootRun`，在项目根执行。
5. 服务名：Java 用模块 artifactId，Node 用 `<package名>:<script>`。
6. 日志环形缓冲上限 200 行 / 64KB。
7. 「所有项目 / 本项目」开关默认「本项目」。
8. 服务面板默认宽度 520px、高度 460px（贴靠浮层，固定尺寸即可，不做拖拽）。
9. 开发环境自动识别改成**异步命令**（`tokio::task::spawn_blocking`）—— 同步 tauri command 在主线程跑，逐个 `java -version` / `mvn -version` 会卡住 UI。
10. `SettingsPage` 的菜单 `onClick` 改成白名单式判断（目前只跳过 `cli-tools-group`，新增的父组 key 也要跳过）。
11. `EditProjectModal` 挂到 `AppLayout.tsx`，与 `NewProjectModal` 同级。
12. 服务进程注册表用 `std::process::Child`（不是 tokio），判活靠看门线程的 `wait()` 与注册表有无记录。
