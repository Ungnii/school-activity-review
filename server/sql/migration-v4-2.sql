-- v4.2: 연도 중심 아카이브 및 연도별 예산/운영 학년 분리
-- 기존 교육활동과 평가 기록을 보존하고 연도별 운영 테이블을 추가합니다.
BEGIN;

CREATE TABLE IF NOT EXISTS activity_years_v4 (
  id BIGSERIAL PRIMARY KEY,
  activity_id BIGINT NOT NULL REFERENCES activities_v4(id) ON DELETE CASCADE,
  school_year INTEGER NOT NULL CHECK (school_year BETWEEN 2000 AND 2100),
  budget NUMERIC(12,0) CHECK (budget IS NULL OR budget >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(activity_id, school_year)
);

CREATE TABLE IF NOT EXISTS activity_year_grades_v4 (
  activity_year_id BIGINT NOT NULL REFERENCES activity_years_v4(id) ON DELETE CASCADE,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 6),
  PRIMARY KEY(activity_year_id, grade)
);

-- 이전 운영기록에 있는 연도/예산/운영학년을 새 연도별 테이블로 옮깁니다.
INSERT INTO activity_years_v4(activity_id, school_year, budget)
SELECT activity_id, school_year, MAX(budget)
FROM activity_records_v4
GROUP BY activity_id, school_year
ON CONFLICT(activity_id, school_year) DO UPDATE
SET budget = COALESCE(activity_years_v4.budget, EXCLUDED.budget);

INSERT INTO activity_year_grades_v4(activity_year_id, grade)
SELECT DISTINCT ay.id, COALESCE(r.reviewer_grade, rg.grade)
FROM activity_records_v4 r
JOIN activity_years_v4 ay ON ay.activity_id = r.activity_id AND ay.school_year = r.school_year
LEFT JOIN activity_record_grades_v4 rg ON rg.record_id = r.id
WHERE COALESCE(r.reviewer_grade, rg.grade) BETWEEN 1 AND 6
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_activity_years_v4_year ON activity_years_v4(school_year);
CREATE INDEX IF NOT EXISTS idx_activity_year_grades_v4_grade ON activity_year_grades_v4(grade);

DROP TRIGGER IF EXISTS trg_activity_years_v4_updated_at ON activity_years_v4;
CREATE TRIGGER trg_activity_years_v4_updated_at
BEFORE UPDATE ON activity_years_v4
FOR EACH ROW EXECUTE FUNCTION update_v4_updated_at();

COMMIT;
