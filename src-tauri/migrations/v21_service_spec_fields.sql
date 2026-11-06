-- Schema v21: 服务的构建产物与入口信息
--
-- 服务启动前要先确认「产物在不在」：Java 服务要用项目绑定环境里的 Maven 打包，
-- 有了 jar 才启动，跟 IDEA 的 Maven + Services 一个路子。
-- artifact_id 是产物的基名（Java 取 pom 的 artifactId，C/C++ 取可执行文件名），
-- artifact_dir 是产物所在子目录（Java 取 target），main_class 是入口类。
-- 老服务没有这些字段，按「不检查产物」处理。

ALTER TABLE services ADD COLUMN artifact_id TEXT;
ALTER TABLE services ADD COLUMN artifact_dir TEXT;
ALTER TABLE services ADD COLUMN main_class TEXT;

INSERT INTO schema_version (version, applied_at) VALUES (21, strftime('%s','now') * 1000);
