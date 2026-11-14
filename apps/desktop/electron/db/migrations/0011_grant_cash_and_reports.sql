-- The cash drawer and reports permissions, for people whose permission lists were written before they existed (rows on a
-- role preset, permissions NULL, get them from the preset). Using the drawer goes to everyone who could sell; reports go
-- to everyone who could void or refund a sale, or manage users (the managers and admins).
UPDATE `employees`
SET `permissions` = json_insert(`permissions`, '$[#]', 'cash.manage')
WHERE `permissions` IS NOT NULL
  AND json_valid(`permissions`)
  AND EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE `value` = 'checkout.sell')
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE `value` = 'cash.manage');--> statement-breakpoint
UPDATE `employees`
SET `permissions` = json_insert(`permissions`, '$[#]', 'reports.view')
WHERE `permissions` IS NOT NULL
  AND json_valid(`permissions`)
  AND EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE `value` IN ('orders.reverse', 'users.manage'))
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE `value` = 'reports.view');
