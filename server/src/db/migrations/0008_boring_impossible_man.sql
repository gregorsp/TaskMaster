PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`due_at` integer,
	`base_date` integer,
	`last_completed_at` integer,
	`is_completed` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`completed_by_id` text,
	`is_important` integer DEFAULT false NOT NULL,
	`is_urgent` integer DEFAULT false NOT NULL,
	`pomodoros` integer,
	`urgency_mode` text DEFAULT 'before_days' NOT NULL,
	`urgency_value` integer,
	`is_private` integer DEFAULT false NOT NULL,
	`recurrence_type` text DEFAULT 'none' NOT NULL,
	`recurrence_rule` text,
	`parent_id` text,
	`planned_date` integer,
	`created_by_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`completed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "title", "description", "due_at", "base_date", "last_completed_at", "is_completed", "completed_at", "completed_by_id", "is_important", "is_urgent", "pomodoros", "urgency_mode", "urgency_value", "is_private", "recurrence_type", "recurrence_rule", "parent_id", "planned_date", "created_by_id", "created_at") SELECT "id", "title", "description", "due_at", "base_date", "last_completed_at", "is_completed", "completed_at", "completed_by_id", "is_important", "is_urgent", "pomodoros", "urgency_mode", "urgency_value", "is_private", "recurrence_type", "recurrence_rule", "parent_id", "planned_date", "created_by_id", "created_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
UPDATE `app_meta` SET `value` = '6' WHERE `key` = 'schema_version';