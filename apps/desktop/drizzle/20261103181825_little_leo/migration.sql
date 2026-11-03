CREATE TABLE `attachments` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`message_id` text,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`path` text NOT NULL,
	`text_path` text,
	CONSTRAINT `fk_attachments_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_attachments_message_id_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`turn` integer NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	`finish_reason` text,
	`tokens_input` integer DEFAULT 0 NOT NULL,
	`tokens_output` integer DEFAULT 0 NOT NULL,
	`tokens_cache_read` integer DEFAULT 0 NOT NULL,
	`tokens_cache_write` integer DEFAULT 0 NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_messages_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `outputs` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`ai_draft` text,
	`edited` text,
	`edited_at` integer,
	`exported_at` integer,
	`export_format` text,
	CONSTRAINT `fk_outputs_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `parts` (
	`id` text PRIMARY KEY,
	`message_id` text NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_parts_message_id_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_parts_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `permission_log` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`tool` text NOT NULL,
	`input` text,
	`decision` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_permission_log_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `kernel_session_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `model` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `permission_mode` text DEFAULT 'ask' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `status` text DEFAULT 'running' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `turns` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `last_error` text;--> statement-breakpoint
CREATE INDEX `messages_session` ON `messages` (`session_id`,`turn`);--> statement-breakpoint
CREATE INDEX `parts_message` ON `parts` (`message_id`,`seq`);--> statement-breakpoint
CREATE INDEX `sessions_updated_at` ON `sessions` (`updated_at`);