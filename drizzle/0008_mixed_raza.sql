ALTER TABLE `noodle_players` ADD `shadowBanned` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `noodle_players` ADD `shadowBanReason` varchar(32);--> statement-breakpoint
ALTER TABLE `noodle_players` ADD `shadowBannedAt` timestamp;--> statement-breakpoint
ALTER TABLE `noodle_players` ADD `shadowTotalClicks` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `noodle_players` ADD `shadowBeefClicks` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `noodle_players` ADD `shadowChickenClicks` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `noodle_players` ADD `shadowOctopusClicks` int unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `noodle_players` ADD `shadowExperience` longtext;