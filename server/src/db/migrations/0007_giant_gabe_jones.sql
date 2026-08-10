CREATE TABLE `task_links` (
	`task_id_a` text NOT NULL,
	`task_id_b` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`task_id_a`, `task_id_b`),
	FOREIGN KEY (`task_id_a`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id_b`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `parent_id` text REFERENCES tasks(id);