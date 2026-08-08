ALTER TABLE `users` ADD `profile_picture` text;--> statement-breakpoint
UPDATE `app_meta` SET `value` = '2' WHERE `key` = 'schema_version';