ALTER TABLE `messages` ADD `context_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `kernel_turn` integer;