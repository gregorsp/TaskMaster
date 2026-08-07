ALTER TABLE `tasks` ADD `urgency_mode` text DEFAULT 'before_days' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `urgency_value` integer;