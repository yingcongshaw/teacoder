-- Schema v15: projects / sessions 加稳定排序字段
--
-- 侧边栏三级(项目 → 会话分类 → 会话)改为按用户拖定的固定顺序展示,不再按最近
-- 更新时间倒序。session_categories 早已有 sort_order,本次只补另外两张表。
--
-- 存量数据按原展示顺序(updated_at DESC)回填成连续序列,之后新建走 max+1 追加
-- 到同级末尾,所以排序值不重复、不留空洞。updated_at 仅在排序值撞车时兜底,
-- 正常情况下永远轮不到它出场。

ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- 项目:按原顺序编号。updated_at 相同时用 id 打破平局,否则两行会拿到同一个号。
UPDATE projects SET sort_order = (
    SELECT COUNT(*) FROM projects p2
    WHERE p2.updated_at > projects.updated_at
       OR (p2.updated_at = projects.updated_at AND p2.id < projects.id)
);

-- 会话:按 (项目, 未分类会话自成组) 分组,组内按原顺序编号。
-- COALESCE 让 category_id 为 NULL 与空串归入同一组 —— 前端判"未分类"用的
-- 也是 !category_id,两端口径必须一致,否则拖到项目根目录的会话会算错位置。
-- 平局同样用 id 打破。
UPDATE sessions SET sort_order = (
    SELECT COUNT(*) FROM sessions s2
    WHERE s2.project_id = sessions.project_id
      AND COALESCE(s2.category_id, '') = COALESCE(sessions.category_id, '')
      AND (
            s2.updated_at > sessions.updated_at
         OR (s2.updated_at = sessions.updated_at AND s2.id < sessions.id)
      )
);

INSERT INTO schema_version (version, applied_at) VALUES (15, strftime('%s','now') * 1000);