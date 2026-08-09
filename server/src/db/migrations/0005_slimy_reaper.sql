ALTER TABLE `tasks` ADD `pomodoros` integer;--> statement-breakpoint
UPDATE `app_meta` SET `value` = '3' WHERE `key` = 'schema_version';