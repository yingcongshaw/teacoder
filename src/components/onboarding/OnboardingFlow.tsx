import { useState, useEffect } from "react";
import { Modal, Button, Typography, Checkbox } from "antd";
import {
  CheckCircleOutlined,
  CloudOutlined,
  FolderAddOutlined,
  MessageOutlined,
  ArrowRightOutlined,
  ArrowLeftOutlined,
} from "@ant-design/icons";

const ONBOARDING_KEY = "teacoder_onboarding_completed";
const AGREEMENT_KEY = "teacoder_agreement_accepted";

export function useOnboarding() {
  const [showAgreement, setShowAgreement] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const agreed = localStorage.getItem(AGREEMENT_KEY);
    const completed = localStorage.getItem(ONBOARDING_KEY);
    if (!agreed) {
      setShowAgreement(true);
    } else if (!completed) {
      setShowGuide(true);
    }
    setReady(true);
  }, []);

  const completeAgreement = () => {
    localStorage.setItem(AGREEMENT_KEY, "true");
    setShowAgreement(false);
    setShowGuide(true);
  };

  const completeGuide = () => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    setShowGuide(false);
  };

  const skipGuide = () => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    setShowGuide(false);
  };

  return {
    ready,
    showAgreement,
    showGuide,
    completeAgreement,
    completeGuide,
    skipGuide,
  };
}

export function AgreementModal({
  open,
  onAccept,
}: {
  open: boolean;
  onAccept: () => void;
}) {
  const [checked, setChecked] = useState(false);

  return (
    <Modal
      title="用户协议"
      open={open}
      closable={false}
      mask={{ closable: false }}
      footer={
        <div className="flex justify-end gap-2">
          <Button disabled={!checked} type="primary" onClick={onAccept}>
            同意并继续
          </Button>
        </div>
      }
      width={600}
    >
      <div className="max-h-80 overflow-y-auto pr-2 text-sm space-y-3">
        <Typography.Title level={5}>TeaCoder 用户协议</Typography.Title>
        <p>
          欢迎使用TeaCoder（以下简称"本软件"）。在使用本软件之前，请您仔细阅读以下协议内容。
        </p>
        <Typography.Title level={5}>1. 软件许可</Typography.Title>
        <p>
          本软件采用 MIT 许可证开源。您可以自由使用、修改和分发本软件，但需遵守许可证中的相关条款。
        </p>
        <Typography.Title level={5}>2. 数据安全</Typography.Title>
        <p>
          本软件所有数据均存储在本地，不会上传至任何远程服务器。您的 API Key 等敏感信息通过系统 Keychain 加密存储。
        </p>
        <Typography.Title level={5}>3. 免责声明</Typography.Title>
        <p>
          本软件仅作为 CLI 工具的图形化管理界面，不拦截或代理任何 API 请求。使用本软件产生的费用和后果由用户自行承担。
        </p>
        <Typography.Title level={5}>4. 隐私政策</Typography.Title>
        <p>
          本软件不收集任何用户数据。所有操作均在本地完成。
        </p>
      </div>
      <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
        <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)}>
          我已阅读并同意上述用户协议
        </Checkbox>
      </div>
    </Modal>
  );
}

export function OnboardingGuide({
  open,
  onComplete,
  onSkip,
}: {
  open: boolean;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const [current, setCurrent] = useState(0);

  // 三步：橙(LLM) → 蓝(项目) → 紫(会话)，呼应顶部渐变 accent bar
  const steps = [
    {
      title: "添加 LLM 供应商",
      subtitle: "为你的 AI 工具接入可用模型",
      icon: <CloudOutlined />,
      accent: "#fa8c16",
      accentSoft: "rgba(250, 140, 22, 0.10)",
      description:
        "在「设置 → 模型服务」中添加 LLM 供应商，填写 API Key、Base URL 等连接信息。不存明文，统一由系统钥匙串加密保存。",
      tips: [
        { label: "入口", value: "右上角 ⚙ 设置 → 模型服务" },
        { label: "支持", value: "Anthropic / OpenAI / Gemini / 兼容 OpenAI 协议的服务" },
      ],
    },
    {
      title: "新建项目",
      subtitle: "把代码目录变成你的工作区",
      icon: <FolderAddOutlined />,
      accent: "#3b82f6",
      accentSoft: "rgba(59, 130, 246, 0.10)",
      description:
        "点击左侧栏顶部的「新建项目」，选择本地代码目录并命名。项目会把同一目录下的会话聚合在一起，按代码库隔离上下文。",
      tips: [
        { label: "入口", value: "左侧栏顶部 ＋按钮" },
        { label: "建议", value: "按仓库根目录划分项目，便于切换与归档" },
      ],
    },
    {
      title: "新建会话",
      subtitle: "开始一次 AI 编程对话",
      icon: <MessageOutlined />,
      accent: "#722ed1",
      accentSoft: "rgba(114, 46, 209, 0.10)",
      description:
        "在项目下「新建会话」，起一个会话名，选择 CLI 工具（Claude Code / Codex / Gemini CLI / OpenCode），再选择 LLM 供应商和模型即可启动。",
      tips: [
        { label: "入口", value: "项目卡片右下角 ＋按钮" },
        { label: "必填", value: "会话名 · CLI 工具 · LLM 供应商 · 模型" },
      ],
    },
  ];

  const step = steps[current];
  const isFirst = current === 0;
  const isLast = current === steps.length - 1;

  return (
    <Modal
      title={
        <div className="flex items-center gap-2">
          <CheckCircleOutlined style={{ color: step.accent }} />
          <span>欢迎使用TeaCoder</span>
        </div>
      }
      open={open}
      closable={false}
      mask={{ closable: false }}
      footer={
        <div className="flex justify-between items-center">
          <Button type="text" onClick={onSkip}>
            跳过引导
          </Button>
          <div className="flex gap-2">
            {!isFirst && (
              <Button icon={<ArrowLeftOutlined />} onClick={() => setCurrent(current - 1)}>
                上一步
              </Button>
            )}
            {isLast ? (
              <Button type="primary" onClick={onComplete}>
                开始使用
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<ArrowRightOutlined />}
                iconPosition="end"
                onClick={() => setCurrent(current + 1)}
              >
                下一步
              </Button>
            )}
          </div>
        </div>
      }
      width={560}
    >
      {/* 顶部进度条：已完成 + 当前用渐变色填充 */}
      <div className="flex gap-1.5 mb-6">
        {steps.map((_, index) => (
          <div
            key={index}
            className="flex-1 h-1 rounded-full overflow-hidden"
            style={{ backgroundColor: "var(--ant-color-fill-tertiary, #f0f0f0)" }}
          >
            <div
              style={{
                width: index <= current ? "100%" : "0%",
                height: "100%",
                background: `linear-gradient(90deg, ${steps
                  .slice(0, index + 1)
                  .map((st) => st.accent)
                  .join(", ")})`,
                transition: "width 0.3s ease",
              }}
            />
          </div>
        ))}
      </div>

      {/* 步骤内容 */}
      <div className="flex flex-col items-center text-center px-2">
        {/* 大图标 */}
        <div
          className="flex items-center justify-center mb-4 transition-colors"
          style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            background: step.accentSoft,
            color: step.accent,
            fontSize: 32,
            boxShadow: `0 6px 16px -4px ${step.accentSoft}`,
          }}
        >
          {step.icon}
        </div>

        {/* 标题 + 副标题 */}
        <div className="text-lg font-semibold text-[var(--ant-color-text)] mb-1">
          {step.title}
        </div>
        <div className="text-sm text-[var(--ant-color-text-tertiary)] mb-5">
          {step.subtitle}
        </div>

        {/* 描述 */}
        <p className="text-sm leading-relaxed text-[var(--ant-color-text-secondary)] mb-5 max-w-md">
          {step.description}
        </p>
      </div>

      {/* 提示卡：列出关键信息 */}
      <div className="grid grid-cols-2 gap-2.5">
        {step.tips.map((tip) => (
          <div
            key={tip.label}
            className="rounded-md border px-3 py-2"
            style={{
              borderColor: "var(--ant-color-border-secondary, #42424233)",
              backgroundColor: "var(--ant-color-bg-container, transparent)",
            }}
          >
            <div
              className="text-[11px] font-medium mb-0.5"
              style={{ color: step.accent }}
            >
              {tip.label}
            </div>
            <div className="text-xs text-[var(--ant-color-text-secondary)] leading-snug">
              {tip.value}
            </div>
          </div>
        ))}
      </div>

      {/* 底部点指示器 */}
      <div className="flex justify-center items-center gap-1.5 mt-6">
        {steps.map((s, index) => (
          <div
            key={index}
            className="rounded-full transition-all"
            style={{
              width: index === current ? 20 : 6,
              height: 6,
              backgroundColor:
                index === current ? s.accent : "var(--ant-color-fill-tertiary, #d9d9d9)",
            }}
          />
        ))}
      </div>
    </Modal>
  );
}
