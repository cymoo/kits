-- 会话搜索（⌘K、会话历史）：标题 + 正文（用户消息和回复正文）。trigram 分词对中文也能做子串匹配，
-- 少于 3 个字的查询走 LIKE（session-store.ts 的 search）。写入时由 SessionStore.reindex 维护。
CREATE VIRTUAL TABLE `sessions_fts` USING fts5(`session_id` UNINDEXED, `title`, `content`, tokenize = 'trigram');
--> statement-breakpoint
INSERT INTO `sessions_fts` (`session_id`, `title`, `content`)
SELECT `s`.`id`, `s`.`title`, coalesce((
  SELECT group_concat(`t`, char(10)) FROM (
    SELECT `m`.`text` AS `t`, `m`.`created_at` AS `c` FROM `messages` `m`
    WHERE `m`.`session_id` = `s`.`id` AND `m`.`role` = 'user' AND `m`.`text` <> ''
    UNION ALL
    SELECT json_extract(`p`.`payload`, '$.text'), `p`.`created_at` FROM `parts` `p`
    WHERE `p`.`session_id` = `s`.`id` AND `p`.`type` = 'text'
    ORDER BY `c`
  )
), '') FROM `sessions` `s`;
