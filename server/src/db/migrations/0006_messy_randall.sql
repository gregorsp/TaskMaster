ALTER TABLE `users` ADD `capacity` text;--> statement-breakpoint
UPDATE `app_meta` SET `value` = '4' WHERE `key` = 'schema_version';