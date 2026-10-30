-- The shop PC's clock minus the cloud's (ms), told on every copy pass: a PC with no internet never
-- corrects its own, and a flat clock battery restarts it wrong. The admin list and the Owner view say so.
ALTER TABLE devices ADD COLUMN clock_off_ms INTEGER;
