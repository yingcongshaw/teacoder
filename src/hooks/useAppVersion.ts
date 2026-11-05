import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

/**
 * 应用版本号，取自打包配置里的 version。
 *
 * 取不到时返回空串，由调用方决定怎么兜底。
 */
export function useAppVersion(): string {
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  return version;
}
