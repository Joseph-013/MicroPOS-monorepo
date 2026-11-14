-- The discounts permission, for people whose permission lists were written before it existed (rows on a role preset,
-- permissions NULL, get it from the preset). Cashiers did not discount before and still do not: it goes to everyone who
-- could void or refund a sale, or manage users (the managers and admins).
UPDATE `employees`
SET `permissions` = json_insert(`permissions`, '$[#]', 'discounts.give')
WHERE `permissions` IS NOT NULL
  AND json_valid(`permissions`)
  AND EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE `value` IN ('orders.reverse', 'users.manage'))
  AND NOT EXISTS (SELECT 1 FROM json_each(`permissions`) WHERE `value` = 'discounts.give');
