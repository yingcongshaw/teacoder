import type { DevEnvKind } from "../types";

/** 环境里的一件工具在表单里的描述。 */
export interface DevToolField {
  /** 工具标识：jdk | maven | node | dotnet | msbuild | python | cargo | go | cmake | cc */
  tool: string;
  label: string;
  versionPlaceholder: string;
  pathPlaceholder: string;
  /** 路径是安装目录还是可执行文件 —— 决定「浏览」按钮选目录还是选文件 */
  pathType: "dir" | "file";
}

export interface DevKindConfig {
  kind: DevEnvKind;
  /** 页面标题，如「Java 环境」 */
  title: string;
  /** 徽标上的短名，如「C++」 */
  short: string;
  description: string;
  tools: DevToolField[];
}

/** 各语言的环境配置。服务面板与设置页共用同一份定义。 */
export const DEV_KIND_CONFIGS: DevKindConfig[] = [
  {
    kind: "java",
    title: "Java 环境",
    short: "Java",
    description:
      "配置 JDK 与 Maven 的版本和安装路径。项目绑定后，服务启动与会话都会用这里的 JAVA_HOME 与 PATH。",
    tools: [
      {
        tool: "jdk",
        label: "JDK",
        versionPlaceholder: "例如：21.0.2",
        pathPlaceholder: "JDK 安装根目录，例如 /usr/lib/jvm/java-21",
        pathType: "dir",
      },
      {
        tool: "maven",
        label: "Maven",
        versionPlaceholder: "例如：3.9.11",
        pathPlaceholder: "Maven 安装根目录，例如 /opt/maven",
        pathType: "dir",
      },
    ],
  },
  {
    kind: "node",
    title: "Node 环境",
    short: "Node",
    description: "配置 Node.js 的版本和路径，项目可以绑定这里的环境作为运行环境。",
    tools: [
      {
        tool: "node",
        label: "Node",
        versionPlaceholder: "例如：22.13.1",
        pathPlaceholder: "node 可执行文件路径，例如 /usr/local/bin/node",
        pathType: "file",
      },
    ],
  },
  {
    kind: "dotnet",
    title: ".NET 环境",
    short: ".NET",
    description:
      "配置 .NET Core / 5+ 的 SDK，以及 .NET Framework 老项目用的 MSBuild。项目绑定后 dotnet 命令会指向这里。",
    tools: [
      {
        tool: "dotnet",
        label: ".NET SDK",
        versionPlaceholder: "例如：8.0.404",
        pathPlaceholder: "dotnet 可执行文件路径，例如 /usr/share/dotnet/dotnet",
        pathType: "file",
      },
      {
        tool: "msbuild",
        label: "MSBuild",
        versionPlaceholder: "例如：4.0",
        pathPlaceholder: "MSBuild.exe 路径，.NET Framework 老项目用",
        pathType: "file",
      },
    ],
  },
  {
    kind: "python",
    title: "Python 环境",
    short: "Python",
    description: "配置 Python 解释器的版本和路径。识别到的服务会以绑定环境的解释器启动。",
    tools: [
      {
        tool: "python",
        label: "Python",
        versionPlaceholder: "例如：3.12.3",
        pathPlaceholder: "python 可执行文件路径，例如 /usr/bin/python3",
        pathType: "file",
      },
    ],
  },
  {
    kind: "rust",
    title: "Rust 环境",
    short: "Rust",
    description: "配置 Rust 工具链（cargo）。Rust 服务的启动命令是 cargo run。",
    tools: [
      {
        tool: "cargo",
        label: "Cargo",
        versionPlaceholder: "例如：1.75.0",
        pathPlaceholder: "cargo 可执行文件路径，例如 ~/.cargo/bin/cargo",
        pathType: "file",
      },
    ],
  },
  {
    kind: "go",
    title: "Go 环境",
    short: "Go",
    description: "配置 Go 的 GOROOT。Go 服务的启动命令是 go run，绑定后会带上对应的 GOROOT。",
    tools: [
      {
        tool: "go",
        label: "Go",
        versionPlaceholder: "例如：1.22.0",
        pathPlaceholder: "GOROOT 目录，例如 /usr/local/go",
        pathType: "dir",
      },
    ],
  },
  {
    kind: "cpp",
    title: "C/C++ 环境",
    short: "C++",
    description:
      "配置 CMake 与 C 编译器。识别到的 C/C++ 服务会先执行构建命令，产出可执行文件后再启动。",
    tools: [
      {
        tool: "cmake",
        label: "CMake",
        versionPlaceholder: "例如：3.28.3",
        pathPlaceholder: "cmake 可执行文件路径，例如 /usr/bin/cmake",
        pathType: "file",
      },
      {
        tool: "cc",
        label: "编译器",
        versionPlaceholder: "例如：12.2.0",
        pathPlaceholder: "gcc / clang 可执行文件路径，例如 /usr/bin/gcc",
        pathType: "file",
      },
    ],
  },
];

/** 按语言类型取配置。 */
export function devKindConfig(kind: string): DevKindConfig | undefined {
  return DEV_KIND_CONFIGS.find((c) => c.kind === kind);
}

/** 语言类型的短名，未知类型回落到「命令」。 */
export function devKindShort(kind: string): string {
  return devKindConfig(kind)?.short ?? "命令";
}

/** 语言类型在徽标上的配色。 */
export const DEV_KIND_COLORS: Record<string, string> = {
  java: "#e76f00",
  node: "#3fae52",
  dotnet: "#512bd4",
  python: "#3776ab",
  rust: "#dea584",
  go: "#00add8",
  cpp: "#00599c",
  command: "#8c8c8c",
};
