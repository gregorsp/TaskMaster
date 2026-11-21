ALTER TABLE `users` ADD `default_private` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `ai_provider` text;--> statement-breakpoint
ALTER TABLE `users` ADD `ai_key_encrypted` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `status` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `duration` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `energy` text;--> statement-breakpoint
CREATE TABLE `contexts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created_by_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE TABLE `task_contexts` (
	`task_id` text NOT NULL,
	`context_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `context_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_id`) REFERENCES `contexts`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `idx_contexts_owner` ON `contexts` (`created_by_id`);--> statement-breakpoint
INSERT INTO `contexts` (`id`, `name`, `color`, `created_by_id`, `created_at`)
SELECT lower(hex(randomblob(16))), 'Telefon', '#1e88e5', u.`id`, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `users` u
WHERE NOT EXISTS (SELECT 1 FROM `contexts` c WHERE c.`created_by_id` = u.`id` AND lower(c.`name`) = 'telefon');--> statement-breakpoint
INSERT INTO `contexts` (`id`, `name`, `color`, `created_by_id`, `created_at`)
SELECT lower(hex(randomblob(16))), 'Computer', '#8e24aa', u.`id`, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `users` u
WHERE NOT EXISTS (SELECT 1 FROM `contexts` c WHERE c.`created_by_id` = u.`id` AND lower(c.`name`) = 'computer');--> statement-breakpoint
INSERT INTO `contexts` (`id`, `name`, `color`, `created_by_id`, `created_at`)
SELECT lower(hex(randomblob(16))), 'Online', '#43a047', u.`id`, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `users` u
WHERE NOT EXISTS (SELECT 1 FROM `contexts` c WHERE c.`created_by_id` = u.`id` AND lower(c.`name`) = 'online');--> statement-breakpoint
INSERT INTO `contexts` (`id`, `name`, `color`, `created_by_id`, `created_at`)
SELECT lower(hex(randomblob(16))), 'Zuhause', '#fb8c00', u.`id`, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `users` u
WHERE NOT EXISTS (SELECT 1 FROM `contexts` c WHERE c.`created_by_id` = u.`id` AND lower(c.`name`) = 'zuhause');--> statement-breakpoint
INSERT INTO `contexts` (`id`, `name`, `color`, `created_by_id`, `created_at`)
SELECT lower(hex(randomblob(16))), 'Besorgungen', '#e53935', u.`id`, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `users` u
WHERE NOT EXISTS (SELECT 1 FROM `contexts` c WHERE c.`created_by_id` = u.`id` AND lower(c.`name`) = 'besorgungen');--> statement-breakpoint
INSERT INTO `contexts` (`id`, `name`, `color`, `created_by_id`, `created_at`)
SELECT lower(hex(randomblob(16))), 'Uni', '#3949ab', u.`id`, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `users` u
WHERE NOT EXISTS (SELECT 1 FROM `contexts` c WHERE c.`created_by_id` = u.`id` AND lower(c.`name`) = 'uni');--> statement-breakpoint
INSERT OR IGNORE INTO `task_contexts` (`task_id`, `context_id`)
SELECT t.`id`, c.`id`
FROM `tasks` t
JOIN `contexts` c ON c.`created_by_id` = t.`created_by_id` AND lower(c.`name`) = 'telefon'
WHERE lower(t.`title`) LIKE '@telefon:%';--> statement-breakpoint
UPDATE `tasks` SET `title` = trim(substr(`title`, 11)) WHERE lower(`title`) LIKE '@telefon:%';--> statement-breakpoint
INSERT OR IGNORE INTO `task_contexts` (`task_id`, `context_id`)
SELECT t.`id`, c.`id`
FROM `tasks` t
JOIN `contexts` c ON c.`created_by_id` = t.`created_by_id` AND lower(c.`name`) = 'computer'
WHERE lower(t.`title`) LIKE '@computer:%';--> statement-breakpoint
UPDATE `tasks` SET `title` = trim(substr(`title`, 12)) WHERE lower(`title`) LIKE '@computer:%';--> statement-breakpoint
INSERT OR IGNORE INTO `task_contexts` (`task_id`, `context_id`)
SELECT t.`id`, c.`id`
FROM `tasks` t
JOIN `contexts` c ON c.`created_by_id` = t.`created_by_id` AND lower(c.`name`) = 'online'
WHERE lower(t.`title`) LIKE '@online:%';--> statement-breakpoint
UPDATE `tasks` SET `title` = trim(substr(`title`, 10)) WHERE lower(`title`) LIKE '@online:%';--> statement-breakpoint
INSERT OR IGNORE INTO `task_contexts` (`task_id`, `context_id`)
SELECT t.`id`, c.`id`
FROM `tasks` t
JOIN `contexts` c ON c.`created_by_id` = t.`created_by_id` AND lower(c.`name`) = 'zuhause'
WHERE lower(t.`title`) LIKE '@zuhause:%';--> statement-breakpoint
UPDATE `tasks` SET `title` = trim(substr(`title`, 11)) WHERE lower(`title`) LIKE '@zuhause:%';--> statement-breakpoint
INSERT OR IGNORE INTO `task_contexts` (`task_id`, `context_id`)
SELECT t.`id`, c.`id`
FROM `tasks` t
JOIN `contexts` c ON c.`created_by_id` = t.`created_by_id` AND lower(c.`name`) = 'besorgungen'
WHERE lower(t.`title`) LIKE '@besorgungen:%';--> statement-breakpoint
UPDATE `tasks` SET `title` = trim(substr(`title`, 15)) WHERE lower(`title`) LIKE '@besorgungen:%';--> statement-breakpoint
INSERT OR IGNORE INTO `task_contexts` (`task_id`, `context_id`)
SELECT t.`id`, c.`id`
FROM `tasks` t
JOIN `contexts` c ON c.`created_by_id` = t.`created_by_id` AND lower(c.`name`) = 'uni'
WHERE lower(t.`title`) LIKE '@uni:%';--> statement-breakpoint
UPDATE `tasks` SET `title` = trim(substr(`title`, 7)) WHERE lower(`title`) LIKE '@uni:%';--> statement-breakpoint
UPDATE `tasks` SET `energy` = 'high' WHERE `description` LIKE '%energie:hoch%';--> statement-breakpoint
UPDATE `tasks` SET `description` = NULLIF(trim(replace(`description`, 'energie:hoch', '')), '')
WHERE `description` LIKE '%energie:hoch%';--> statement-breakpoint
UPDATE `tasks` SET `energy` = 'low' WHERE `description` LIKE '%energie:niedrig%';--> statement-breakpoint
UPDATE `tasks` SET `description` = NULLIF(trim(replace(`description`, 'energie:niedrig', '')), '')
WHERE `description` LIKE '%energie:niedrig%';--> statement-breakpoint
UPDATE `tasks` SET `duration` = 'under_2_min'
WHERE `description` = '2 min' OR `description` LIKE '% 2 min';--> statement-breakpoint
UPDATE `tasks` SET `description` = NULLIF(trim(substr(`description`, 1, length(`description`) - 5)), '')
WHERE `duration` = 'under_2_min' AND (`description` = '2 min' OR `description` LIKE '% 2 min');--> statement-breakpoint
UPDATE `tasks` SET `duration` = '15_min'
WHERE (`description` = '15 min' OR `description` LIKE '% 15 min') AND `duration` IS NULL;--> statement-breakpoint
UPDATE `tasks` SET `description` = NULLIF(trim(substr(`description`, 1, length(`description`) - 6)), '')
WHERE `duration` = '15_min' AND (`description` = '15 min' OR `description` LIKE '% 15 min');--> statement-breakpoint
UPDATE `tasks` SET `status` = 'next'
WHERE `status` IS NULL AND `id` IN (
	SELECT tc.`task_id` FROM `task_categories` tc
	JOIN `categories` c ON c.`id` = tc.`category_id`
	WHERE lower(c.`name`) IN ('nächste schritte', 'nächster schritt')
);--> statement-breakpoint
UPDATE `tasks` SET `status` = 'waiting'
WHERE `status` IS NULL AND `id` IN (
	SELECT tc.`task_id` FROM `task_categories` tc
	JOIN `categories` c ON c.`id` = tc.`category_id`
	WHERE lower(c.`name`) = 'warten auf'
);--> statement-breakpoint
UPDATE `tasks` SET `status` = 'someday'
WHERE `status` IS NULL AND `id` IN (
	SELECT tc.`task_id` FROM `task_categories` tc
	JOIN `categories` c ON c.`id` = tc.`category_id`
	WHERE lower(c.`name`) IN ('irgendwann/vielleicht', 'irgendwann')
);--> statement-breakpoint
DELETE FROM `task_categories` WHERE `category_id` IN (
	SELECT `id` FROM `categories`
	WHERE lower(`name`) IN ('projekte', 'projekt', 'nächste schritte', 'nächster schritt', 'warten auf', 'irgendwann/vielleicht', 'irgendwann')
);--> statement-breakpoint
DELETE FROM `categories` WHERE lower(`name`) IN (
	'projekte', 'projekt', 'nächste schritte', 'nächster schritt', 'warten auf', 'irgendwann/vielleicht', 'irgendwann'
);--> statement-breakpoint
WITH RECURSIVE tree(`id`, `root_private`) AS (
	SELECT `id`, `is_private` FROM `tasks` WHERE `parent_id` IS NULL
	UNION ALL
	SELECT t.`id`, tree.`root_private` FROM `tasks` t JOIN tree ON t.`parent_id` = tree.`id`
)
UPDATE `tasks`
SET `is_private` = (SELECT tree.`root_private` FROM tree WHERE tree.`id` = `tasks`.`id`)
WHERE `is_private` <> (SELECT tree.`root_private` FROM tree WHERE tree.`id` = `tasks`.`id`);--> statement-breakpoint
UPDATE `app_meta` SET `value` = '17' WHERE `key` = 'schema_version';
