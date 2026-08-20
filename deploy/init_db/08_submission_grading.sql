-- 08_submission_grading.sql — MusicBrainz 式分级创建：公开归属与可见性
ALTER TABLE artists ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_artists_created_by ON artists(created_by);
