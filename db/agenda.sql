CREATE TABLE IF NOT EXISTS agenda_events (
id TEXT PRIMARY KEY, activity TEXT NOT NULL, event_date TEXT NOT NULL, city TEXT NOT NULL, place TEXT NOT NULL,
nickname TEXT NOT NULL DEFAULT '', description TEXT NOT NULL, participants INTEGER NOT NULL CHECK(participants BETWEEN 1 AND 100000),
lat REAL NOT NULL, lng REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','hidden')),
fingerprint TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, reviewed_at TEXT, consent_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agenda_public ON agenda_events(status,event_date);
CREATE TABLE IF NOT EXISTS agenda_rate(bucket TEXT PRIMARY KEY,attempts INTEGER NOT NULL,expires_at INTEGER NOT NULL);