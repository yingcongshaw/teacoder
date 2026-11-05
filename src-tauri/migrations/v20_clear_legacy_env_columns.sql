-- Schema v20: 清空 projects 上已被 project_dev_envs 取代的旧环境列
--
-- v19 把项目与环境的绑定搬进了 project_dev_envs，旧列留着会出现两处数据不一致。
-- 列按约定不删（禁止 ALTER TABLE 删列），清空值让两处保持一致。

UPDATE projects SET java_env_id = NULL, node_env_id = NULL;

INSERT INTO schema_version (version, applied_at) VALUES (20, strftime('%s','now') * 1000);
