-- v4.1 migration
-- 1) 교육활동 소요시간을 분 -> 차시(1차시=40분)로 변경
-- 2) 학년부장이 관리자 로그인 없이 학년별 운영기록을 입력할 수 있도록 운영기록을 학년 단위로 분리

BEGIN;

ALTER TABLE activities_v4
  ADD COLUMN IF NOT EXISTS duration_periods INTEGER;

-- 기존 분 데이터가 있다면 가장 가까운 차시로 변환
UPDATE activities_v4
SET duration_periods = ROUND(duration_minutes / 40.0)::INTEGER
WHERE duration_periods IS NULL AND duration_minutes IS NOT NULL;

ALTER TABLE activities_v4
  DROP CONSTRAINT IF EXISTS activities_v4_duration_periods_check;
ALTER TABLE activities_v4
  ADD CONSTRAINT activities_v4_duration_periods_check
  CHECK (duration_periods IS NULL OR duration_periods BETWEEN 1 AND 20);

-- 기존 분 컬럼은 당장은 보존하여 기존 데이터 안전성 확보

ALTER TABLE activity_records_v4
  ADD COLUMN IF NOT EXISTS reviewer_grade INTEGER;

ALTER TABLE activity_records_v4
  DROP CONSTRAINT IF EXISTS activity_records_v4_reviewer_grade_check;
ALTER TABLE activity_records_v4
  ADD CONSTRAINT activity_records_v4_reviewer_grade_check
  CHECK (reviewer_grade IS NULL OR reviewer_grade BETWEEN 1 AND 6);

-- 기존 기록이 정확히 한 학년으로 기록되어 있다면 작성 학년으로 보정
UPDATE activity_records_v4 r
SET reviewer_grade = x.grade
FROM (
  SELECT record_id, MIN(grade) AS grade, COUNT(*) AS cnt
  FROM activity_record_grades_v4
  GROUP BY record_id
) x
WHERE r.id = x.record_id AND x.cnt = 1 AND r.reviewer_grade IS NULL;

-- 기존의 활동+연도 단일 기록 제약 제거
ALTER TABLE activity_records_v4
  DROP CONSTRAINT IF EXISTS activity_records_v4_activity_id_school_year_key;

-- 이제 같은 활동/연도라도 학년별로 별도 기록을 저장할 수 있음
ALTER TABLE activity_records_v4
  DROP CONSTRAINT IF EXISTS activity_records_v4_activity_id_school_year_reviewer_grade_key;
ALTER TABLE activity_records_v4
  ADD CONSTRAINT activity_records_v4_activity_id_school_year_reviewer_grade_key
  UNIQUE (activity_id, school_year, reviewer_grade);

COMMIT;
