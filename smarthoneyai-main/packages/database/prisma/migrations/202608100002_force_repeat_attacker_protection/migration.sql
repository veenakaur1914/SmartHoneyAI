-- Repeat-attacker automation is a mandatory baseline. Legacy sites created
-- before the feature existed must not keep issuing disabled signed policies.
UPDATE "Site"
SET "autoBlockEnabled" = true
WHERE "autoBlockEnabled" = false;
