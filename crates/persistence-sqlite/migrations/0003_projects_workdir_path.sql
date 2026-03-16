ALTER TABLE projects ADD COLUMN workdir_path TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_workdir_path
ON projects(workdir_path)
WHERE workdir_path IS NOT NULL;
