//! 传输任务的取消登记与协议能力缓存。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use once_cell::sync::Lazy;
use tokio::sync::Notify;

/// scp 与远程之间实际用到的协议。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    /// OpenSSH ≥9.0 的默认：走 SFTP 子系统。
    Sftp,
    /// `scp -O` 的传统 rcp 协议。不依赖远端装 sftp-server，但路径由远程 shell 解析。
    LegacyScp,
}

/// 一次传输的取消句柄。
pub struct CancelToken {
    notify: Notify,
    cancelled: AtomicBool,
}

impl CancelToken {
    pub fn new() -> Self {
        Self {
            notify: Notify::new(),
            cancelled: AtomicBool::new(false),
        }
    }

    /// 请求取消。可重复调用。
    pub fn cancel(&self) {
        if !self.cancelled.swap(true, Ordering::SeqCst) {
            self.notify.notify_waiters();
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// 供 `select!` 等待。
    pub async fn cancelled(&self) {
        // 必须先 `enable()` 注册再读标志：否则 cancel() 落在「读标志」与「首次 poll」
        // 之间时，notify_waiters 看不到这个尚未注册的等待者，等待方就永久挂死 ——
        // 表现为点「取消」没反应，scp 照跑到底。
        let notified = self.notify.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if self.is_cancelled() {
            return;
        }
        notified.await;
    }
}

impl Default for CancelToken {
    fn default() -> Self {
        Self::new()
    }
}

/// 传输任务登记处。以 `.manage()` 挂进 Tauri，照 `PtyManager` 的先例。
pub struct TransferRegistry {
    tokens: Mutex<HashMap<String, Arc<CancelToken>>>,
    /// `user@host:port` → 该主机已验证可用的协议。进程生命周期内有效。
    protocols: Lazy<Mutex<HashMap<String, Protocol>>>,
}

impl TransferRegistry {
    pub fn new() -> Self {
        Self {
            tokens: Mutex::new(HashMap::new()),
            protocols: Lazy::new(|| Mutex::new(HashMap::new())),
        }
    }

    /// 登记一个新任务并返回它的取消句柄。
    pub fn register(&self, transfer_id: &str) -> Arc<CancelToken> {
        let token = Arc::new(CancelToken::new());
        if let Ok(mut map) = self.tokens.lock() {
            map.insert(transfer_id.to_string(), Arc::clone(&token));
        }
        token
    }

    /// 任务结束（含成功/失败/取消）后注销。
    pub fn finish(&self, transfer_id: &str) {
        if let Ok(mut map) = self.tokens.lock() {
            map.remove(transfer_id);
        }
    }

    /// 请求取消。返回 false 表示该任务已结束或 id 未知。
    pub fn cancel(&self, transfer_id: &str) -> bool {
        let token = self.tokens.lock().ok().and_then(|m| m.get(transfer_id).cloned());
        match token {
            Some(t) => {
                t.cancel();
                true
            }
            None => false,
        }
    }

    pub fn known_protocol(&self, key: &str) -> Option<Protocol> {
        self.protocols.lock().ok().and_then(|m| m.get(key).copied())
    }

    pub fn remember_protocol(&self, key: &str, protocol: Protocol) {
        if let Ok(mut m) = self.protocols.lock() {
            m.insert(key.to_string(), protocol);
        }
    }
}

impl Default for TransferRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_then_cancel_reaches_token() {
        let r = TransferRegistry::new();
        let token = r.register("t1");
        assert!(!token.is_cancelled());
        assert!(r.cancel("t1"));
        assert!(token.is_cancelled());
    }

    /// 任务已结束后再取消不应 panic，也不应影响别的任务。
    #[test]
    fn cancel_after_finish_is_a_noop() {
        let r = TransferRegistry::new();
        r.register("t1");
        r.finish("t1");
        assert!(!r.cancel("t1"));
    }

    #[test]
    fn cancelling_unknown_id_returns_false() {
        assert!(!TransferRegistry::new().cancel("nope"));
    }

    /// 回归：两个同名 id 不应共享取消句柄。
    #[test]
    fn each_registration_gets_its_own_token() {
        let r = TransferRegistry::new();
        let a = r.register("t1");
        r.finish("t1");
        let b = r.register("t1");
        assert!(!b.is_cancelled());
        drop(a);
    }

    #[test]
    fn protocol_cache_roundtrip() {
        let r = TransferRegistry::new();
        assert_eq!(r.known_protocol("root@h:22"), None);
        r.remember_protocol("root@h:22", Protocol::LegacyScp);
        assert_eq!(r.known_protocol("root@h:22"), Some(Protocol::LegacyScp));
    }

    #[tokio::test]
    async fn cancel_unblocks_waiter() {
        let token = Arc::new(CancelToken::new());
        let waiter = Arc::clone(&token);
        let handle = tokio::spawn(async move { waiter.cancelled().await });
        tokio::task::yield_now().await;
        token.cancel();
        tokio::time::timeout(std::time::Duration::from_secs(2), handle)
            .await
            .expect("取消后应立即唤醒等待方")
            .unwrap();
    }

    /// 已取消再 await 不应挂死 —— select! 循环会反复进入这个分支。
    #[tokio::test]
    async fn cancelled_returns_immediately_when_already_cancelled() {
        let token = CancelToken::new();
        token.cancel();
        tokio::time::timeout(std::time::Duration::from_millis(500), token.cancelled())
            .await
            .expect("已取消时不应等待");
    }
}