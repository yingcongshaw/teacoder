import { useState, useEffect } from "react";
import { Modal, Button, Typography, Checkbox } from "antd";
import {
  CheckCircleOutlined,
  MessageOutlined,
  SettingOutlined,
  PlusCircleOutlined,
} from "@ant-design/icons";

const ONBOARDING_KEY = "codingtea_onboarding_completed";
const AGREEMENT_KEY = "codingtea_agreement_accepted";

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
      maskClosable={false}
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
        <Typography.Title level={5}>茶码 CodingTea 用户协议</Typography.Title>
        <p>
          欢迎使用茶码 CodingTea（以下简称"本软件"）。在使用本软件之前，请您仔细阅读以下协议内容。
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

  const steps = [
    {
      title: "新建会话",
      description: "点击左侧「新建会话」按钮，选择 CLI 工具、Profile 和工作目录，即可开始一个 AI 编程会话。",
      icon: <PlusCircleOutlined />,
    },
    {
      title: "侧边栏功能",
      description: "左侧边栏可以搜索、排序、过滤会话，收藏常用会话，按项目分组管理。点击项目名可折叠/展开。",
      icon: <MessageOutlined />,
    },
    {
      title: "设置入口",
      description: "点击顶部工具栏的设置图标，可以配置通用设置、终端参数、各工具的模型和 API Key 等。",
      icon: <SettingOutlined />,
    },
  ];

  return (
    <Modal
      title={
        <div className="flex items-center gap-2">
          <CheckCircleOutlined className="text-green-500" />
          <span>欢迎使用茶码 CodingTea</span>
        </div>
      }
      open={open}
      closable={false}
      maskClosable={false}
      footer={
        <div className="flex justify-between items-center">
          <Button type="text" onClick={onSkip}>
            跳过引导
          </Button>
          <div className="flex gap-2">
            {current > 0 && (
              <Button onClick={() => setCurrent(current - 1)}>上一步</Button>
            )}
            {current < steps.length - 1 ? (
              <Button type="primary" onClick={() => setCurrent(current + 1)}>
                下一步
              </Button>
            ) : (
              <Button type="primary" onClick={onComplete}>
                开始使用
              </Button>
            )}
          </div>
        </div>
      }
      width={520}
    >
      <div className="flex gap-2 mb-4">
        {steps.map((_, index) => (
          <div
            key={index}
            className={`flex-1 h-1 rounded-full ${
              index <= current ? "bg-blue-500" : "bg-gray-200 dark:bg-gray-700"
            }`}
          />
        ))}
      </div>
      <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xl text-blue-500">{steps[current].icon}</span>
          <span className="font-medium">{steps[current].title}</span>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {steps[current].description}
        </p>
      </div>
      <div className="flex justify-center gap-1 mt-4">
        {steps.map((_, index) => (
          <div
            key={index}
            className={`w-2 h-2 rounded-full ${
              index === current
                ? "bg-blue-500"
                : "bg-gray-300 dark:bg-gray-600"
            }`}
          />
        ))}
      </div>
    </Modal>
  );
}
