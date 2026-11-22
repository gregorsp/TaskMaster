DROP TABLE IF EXISTS `goals`;--> statement-breakpoint
DROP TABLE IF EXISTS `time_blocks`;--> statement-breakpoint
ALTER TABLE `tasks` DROP COLUMN `goal_id`;--> statement-breakpoint
ALTER TABLE `users` ADD `pomodoro_settings` text;
