CREATE TABLE `task_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`occurrence_date` integer NOT NULL,
	`planned_date` integer,
	`is_completed` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`completed_by_id` text,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`completed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_occurrences_unique` ON `task_occurrences` (`task_id`, `occurrence_date`);
--> statement-breakpoint
UPDATE `app_meta` SET `value` = '7' WHERE `key` = 'schema_version';
