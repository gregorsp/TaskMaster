UPDATE `tasks` SET `planned_date` = NULL WHERE `planned_date` = 'planned_date';
--> statement-breakpoint
UPDATE `app_meta` SET `value` = '10' WHERE `key` = 'schema_version';
