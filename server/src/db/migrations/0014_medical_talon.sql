CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_notes_user_created` ON `notes` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`ordinal` integer DEFAULT 0 NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer DEFAULT 0 NOT NULL,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`language` text DEFAULT 'de' NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`started_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_recordings_owner` ON `recordings` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE TABLE `transcript_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`idx` integer NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_transcript_segments_recording_idx` ON `transcript_segments` (`recording_id`,`idx`);--> statement-breakpoint
CREATE TABLE `transcription_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`progress_ms` integer DEFAULT 0 NOT NULL,
	`claimed_by` text,
	`lease_until` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_transcription_jobs_recording` ON `transcription_jobs` (`recording_id`);--> statement-breakpoint
CREATE INDEX `idx_transcription_jobs_user_status` ON `transcription_jobs` (`user_id`,`status`);--> statement-breakpoint
ALTER TABLE `users` ADD `transcription_language` text DEFAULT 'de' NOT NULL;