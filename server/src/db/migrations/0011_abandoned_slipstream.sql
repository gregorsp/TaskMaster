ALTER TABLE `tasks` ADD `is_habit` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `confirm_habit_completion` integer DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE `app_meta` SET `value` = '9' WHERE `key` = 'schema_version';
