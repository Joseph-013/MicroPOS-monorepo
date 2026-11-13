-- The new "Change shop settings" permission goes to everyone who could manage users (the admins), whose permission
-- lists were written before it existed. Rows on a role preset (permissions NULL) get it from the preset.
UPDATE `employees`
SET `permissions` = json_insert(`permissions`, '$[#]', 'settings.manage')
WHERE `permissions` IS NOT NULL
  AND json_valid(`permissions`)
  AND EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE `value` = 'users.manage')
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE `value` = 'settings.manage');
