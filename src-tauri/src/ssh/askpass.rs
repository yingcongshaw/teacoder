//! 密码认证的 `SSH_ASKPASS` 临时文件管理。

use std::path::{Path, PathBuf};

/// 持有 SSH_ASKPASS 脚本与 0600 密码文件，`Drop` 时删除。
///
/// 用 RAII 而非"存路径、找地方手动删"，是因为传输是短生命周期子进程：每条返回、
/// 每条错误、每次取消都得清理干净，靠手动删必漏。PTY 会话的生命周期长、清理点明确，
/// 但同样受益于 RAII —— 原先 `stop_session` 是唯一的清理点，进程被 kill 时
/// 明文密码文件就永久留在 `/tmp` 了。
///
/// 密码明文落盘是 OpenSSH 官方唯一无 `sshpass` 依赖的非交互式方案：协议本身没有
/// 非交互的密码通道。风险面限于"文件存在期间同 UID 进程可读"，0600 已挡住其他
/// 用户；uuid 命名 + 用完即删进一步收窄。
pub struct AskpassGuard {
    script: PathBuf,
    pwd_file: PathBuf,
}

impl AskpassGuard {
    /// 写密码文件（0600）与 askpass 脚本（0755）。任一步失败都会清掉已写的文件。
    #[cfg(unix)]
    pub fn create(password: &str) -> Result<Self, String> {
        // uuid 命名而非 pid：同一进程内并发两个带密码的会话，pid 相同会让第二个
        // 覆盖第一个的密码文件，且任一方被清理时会把另一个还在用的文件删掉。
        let id = uuid::Uuid::new_v4();
        let tmp_dir = std::env::temp_dir();
        let pwd_file = tmp_dir.join(format!("teacoder-ssh-pwd-{id}.txt"));
        let script = tmp_dir.join(format!("teacoder-ssh-askpass-{id}.sh"));

        if let Err(e) = write_with_mode(&pwd_file, password, 0o600) {
            return Err(format!("写入 SSH 密码临时文件失败: {e}"));
        }
        if let Err(e) = write_with_mode(
            &script,
            &format!("#!/bin/sh\ncat '{}'\n", pwd_file.display()),
            0o755,
        ) {
            let _ = std::fs::remove_file(&pwd_file);
            return Err(format!("写入 SSH askpass 脚本失败: {e}"));
        }

        Ok(Self { script, pwd_file })
    }

    /// 非 Unix 平台没有 `/bin/sh`，askpass 无从谈起。
    #[cfg(not(unix))]
    pub fn create(_password: &str) -> Result<Self, String> {
        Err("Windows 下暂不支持密码认证，请改用私钥或 SSH Agent".to_string())
    }

    /// 交给 `SSH_ASKPASS` 环境变量的脚本路径。
    pub fn script_path(&self) -> &Path {
        &self.script
    }
}

#[cfg(unix)]
fn write_with_mode(path: &Path, content: &str, mode: u32) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::write(path, content)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
}

impl Drop for AskpassGuard {
    fn drop(&mut self) {
        // 尽力删除：临时目录里的残留明文不值得让 Drop panic。
        let _ = std::fs::remove_file(&self.script);
        let _ = std::fs::remove_file(&self.pwd_file);
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn creates_files_with_restrictive_modes() {
        use std::os::unix::fs::PermissionsExt;
        let guard = AskpassGuard::create("hunter2").expect("应能创建");
        assert!(guard.script.exists());
        assert!(guard.pwd_file.exists());
        assert_eq!(
            std::fs::metadata(&guard.pwd_file).unwrap().permissions().mode() & 0o777,
            0o600,
            "密码文件必须是 0600",
        );
        assert_eq!(
            std::fs::metadata(&guard.script).unwrap().permissions().mode() & 0o777,
            0o755,
            "脚本需可执行",
        );
        assert_eq!(std::fs::read_to_string(&guard.pwd_file).unwrap(), "hunter2");
    }

    #[test]
    fn drop_removes_both_files() {
        let (script, pwd) = {
            let guard = AskpassGuard::create("hunter2").expect("应能创建");
            (guard.script.clone(), guard.pwd_file.clone())
        };
        assert!(!script.exists(), "脚本应已删除");
        assert!(!pwd.exists(), "密码文件应已删除");
    }

    /// 回归：并发两个会话曾因 pid 命名互相覆盖密码文件，且任一方 Drop 会删掉
    /// 另一个还在用的文件。
    #[test]
    fn two_guards_do_not_collide() {
        let a = AskpassGuard::create("aaa").expect("应能创建");
        let b = AskpassGuard::create("bbb").expect("应能创建");
        assert_ne!(a.script, b.script);
        assert_ne!(a.pwd_file, b.pwd_file);
        assert_eq!(
            std::fs::read_to_string(&a.pwd_file).unwrap(),
            "aaa",
            "第一个密码文件不该被第二个覆盖",
        );
        assert_eq!(std::fs::read_to_string(&b.pwd_file).unwrap(), "bbb");
    }
}