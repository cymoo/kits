CREATE TABLE `diffs` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`turn` integer NOT NULL,
	`path` text NOT NULL,
	`status` text NOT NULL,
	`additions` integer DEFAULT 0 NOT NULL,
	`deletions` integer DEFAULT 0 NOT NULL,
	`patch` text DEFAULT '' NOT NULL,
	CONSTRAINT `fk_diffs_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `diffs_session` ON `diffs` (`session_id`,`turn`);