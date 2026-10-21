-- The admin's audit log: who signed in to /admin, which shop's data they opened, and which
-- shop they removed (cloud/src/admin.ts). Kept with the shop's name, so a removed shop is still named.
CREATE TABLE admin_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  action     TEXT    NOT NULL,                   -- signed-in, wrong-password, signed-out, opened-shop, read-shop, removed-shop
  shop_id    TEXT,
  shop_name  TEXT,
  via        TEXT    NOT NULL,                   -- browser (the /admin pages) or key (the laptop's Shops screen)
  ip         TEXT
);
CREATE INDEX ix_admin_log_at ON admin_log (at);

-- Removing a shop (a shop that leaves): its events may go only while its row says so, inside the
-- one transaction that removes everything of it. Every other shop's events still never go.
ALTER TABLE shops ADD COLUMN removing INTEGER NOT NULL DEFAULT 0;
DROP TRIGGER events_never_deleted;
CREATE TRIGGER events_never_deleted BEFORE DELETE ON events
WHEN (SELECT removing FROM shops WHERE id = OLD.tenant_id) IS NOT 1
BEGIN SELECT RAISE(ABORT, 'events are never deleted'); END;
