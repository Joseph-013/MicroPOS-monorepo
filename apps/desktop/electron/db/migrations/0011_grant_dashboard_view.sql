-- The dashboard permission, for people whose permission lists were written before it existed (rows on a role preset,
-- permissions NULL, get it from the preset). It goes to everyone who could view items (the stock overview it replaces)
-- or reports.
UPDATE `employees`
SET `permissions` = json_insert(`permissions`, '$[#]', 'dashboard.view')
WHERE `permissions` IS NOT NULL
  AND json_valid(`permissions`)
  AND EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE `value` IN ('catalog.view', 'reports.view'))
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE `value` = 'dashboard.view');
