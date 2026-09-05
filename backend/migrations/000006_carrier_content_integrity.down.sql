DROP TRIGGER IF EXISTS track_content_work_consistency_guard ON track_contents;
DROP FUNCTION IF EXISTS enforce_track_content_work_consistency();
DROP TRIGGER IF EXISTS track_work_consistency_guard ON tracks;
DROP FUNCTION IF EXISTS enforce_track_work_consistency();
