ALTER TABLE `task_events` ADD `occurrence_date` integer;
--> statement-breakpoint
UPDATE `app_meta` SET `value` = '8' WHERE `key` = 'schema_version';
