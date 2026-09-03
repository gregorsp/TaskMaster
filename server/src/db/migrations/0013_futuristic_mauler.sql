ALTER TABLE `tasks` ADD `slug` text;--> statement-breakpoint
UPDATE `tasks` SET `slug` = lower(hex(randomblob(10))) WHERE `slug` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tasks_slug_unique` ON `tasks` (`slug`);--> statement-breakpoint
UPDATE `app_meta` SET `value` = '11' WHERE `key` = 'schema_version';