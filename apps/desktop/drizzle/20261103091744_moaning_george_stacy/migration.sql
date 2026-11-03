CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`agent` text NOT NULL,
	`kernel` text NOT NULL,
	`workdir` text NOT NULL,
	`created_at` integer NOT NULL
);
