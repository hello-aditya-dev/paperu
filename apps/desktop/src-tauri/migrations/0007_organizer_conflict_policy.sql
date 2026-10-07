-- 90% §6: organizer collision-safety. Persist the per-rule conflict policy
-- (rename | skip). Default NULL → treated as "rename" by the Rust policy_of.
ALTER TABLE organizer_rule ADD COLUMN conflict_policy TEXT;
