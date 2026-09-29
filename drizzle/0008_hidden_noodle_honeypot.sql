ALTER TABLE `noodle_players` ADD `leaderboardHidden` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `noodle_players` ADD `honeypotKey` varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `noodle_players` SET `honeypotKey` = SHA2(CONCAT(`id`, UUID(), RAND()), 256) WHERE `honeypotKey` = '';
