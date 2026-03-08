PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS events_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    project_id INTEGER NULL REFERENCES projects(id) ON DELETE SET NULL,
    linked_task_id INTEGER NULL REFERENCES tasks(id) ON DELETE SET NULL,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    timezone TEXT NOT NULL,
    event_type TEXT NOT NULL,
    rrule TEXT NULL,
    recurrence_exceptions TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT INTO events_new (
    id,
    title,
    description,
    project_id,
    linked_task_id,
    start_at,
    end_at,
    timezone,
    event_type,
    rrule,
    recurrence_exceptions,
    notes,
    created_at,
    updated_at
)
SELECT
    id,
    title,
    description,
    project_id,
    linked_task_id,
    start_at,
    end_at,
    timezone,
    event_type,
    rrule,
    recurrence_exceptions,
    notes,
    created_at,
    updated_at
FROM events;

DROP TABLE events;
ALTER TABLE events_new RENAME TO events;

CREATE INDEX IF NOT EXISTS idx_events_project_id ON events(project_id);
CREATE INDEX IF NOT EXISTS idx_events_start_at ON events(start_at);
CREATE INDEX IF NOT EXISTS idx_events_linked_task_id ON events(linked_task_id);

PRAGMA foreign_keys = ON;
