-- Schema v16: 传输与删除操作日志
--
-- 文件传输面板底部的「同步进度和日志」表原先只活在前端内存里，面板一关就没了。
-- 落库有两个用处：跨会话查看历史，以及给删除这类破坏性操作留痕 —— 传输失败还能
-- 重来，删掉的文件没有回退。
--
-- session_id 外键到 sessions，ON DELETE CASCADE：会话被删掉时，它的上传下载记录
-- 一起清掉，不留悬空日志。Terminal 会话没有对应的 session 行，session_id 为
-- NULL —— NULL 不参与外键检查，照样能记。
--
-- request_id 由前端生成并回传，用来把实时进度事件对应到某一行。进度本身不落库
-- （一次传输每秒好几条事件，落库会把库写爆），只在内存里跟着走。

CREATE TABLE IF NOT EXISTS transfer_log (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  -- upload / download / delete
  kind TEXT NOT NULL,
  -- remote / local，删除时区分删的是哪一端
  side TEXT,
  name TEXT NOT NULL,
  path TEXT,
  bytes INTEGER,
  -- running / done / error
  state TEXT NOT NULL,
  error TEXT,
  protocol TEXT,
  elapsed_ms INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transfer_log_created ON transfer_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_log_session ON transfer_log (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_log_request ON transfer_log (request_id);

INSERT INTO schema_version (version, applied_at) VALUES (16, strftime('%s','now') * 1000);
