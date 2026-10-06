-- 우리학교 교육활동 아카이브 v4
-- 기존 v3 테이블은 삭제하지 않습니다.
-- Neon SQL Editor에서 전체 실행하세요.

BEGIN;

CREATE TABLE IF NOT EXISTS activities_v4 (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    activity_type VARCHAR(100) NOT NULL,
    provider VARCHAR(200),
    description TEXT,
    duration_minutes INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_available_grades_v4 (
    activity_id BIGINT NOT NULL REFERENCES activities_v4(id) ON DELETE CASCADE,
    grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 6),
    PRIMARY KEY (activity_id, grade)
);

CREATE TABLE IF NOT EXISTS activity_records_v4 (
    id BIGSERIAL PRIMARY KEY,
    activity_id BIGINT NOT NULL REFERENCES activities_v4(id) ON DELETE CASCADE,
    school_year INTEGER NOT NULL CHECK (school_year BETWEEN 2000 AND 2100),
    budget NUMERIC(12,0) CHECK (budget >= 0),
    overall_satisfaction NUMERIC(2,1)
        CHECK (overall_satisfaction IS NULL OR overall_satisfaction BETWEEN 1 AND 5),
    recommendation VARCHAR(20) NOT NULL DEFAULT '추천'
        CHECK (recommendation IN ('적극 추천', '추천', '조건부 추천', '비추천')),
    pros TEXT,
    cons TEXT,
    additional_comment TEXT,
    reviewer_name VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (activity_id, school_year)
);

CREATE TABLE IF NOT EXISTS activity_record_grades_v4 (
    record_id BIGINT NOT NULL REFERENCES activity_records_v4(id) ON DELETE CASCADE,
    grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 6),
    PRIMARY KEY (record_id, grade)
);

CREATE INDEX IF NOT EXISTS idx_activities_v4_active
    ON activities_v4(is_active);

CREATE INDEX IF NOT EXISTS idx_available_grades_v4_grade
    ON activity_available_grades_v4(grade);

CREATE INDEX IF NOT EXISTS idx_records_v4_activity
    ON activity_records_v4(activity_id);

CREATE INDEX IF NOT EXISTS idx_records_v4_year
    ON activity_records_v4(school_year);

CREATE INDEX IF NOT EXISTS idx_record_grades_v4_grade
    ON activity_record_grades_v4(grade);

CREATE OR REPLACE FUNCTION update_v4_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_activities_v4_updated_at ON activities_v4;
CREATE TRIGGER trg_activities_v4_updated_at
BEFORE UPDATE ON activities_v4
FOR EACH ROW EXECUTE FUNCTION update_v4_updated_at();

DROP TRIGGER IF EXISTS trg_activity_records_v4_updated_at ON activity_records_v4;
CREATE TRIGGER trg_activity_records_v4_updated_at
BEFORE UPDATE ON activity_records_v4
FOR EACH ROW EXECUTE FUNCTION update_v4_updated_at();

COMMIT;

SELECT 'activities_v4' AS table_name, COUNT(*) AS row_count FROM activities_v4
UNION ALL
SELECT 'activity_available_grades_v4', COUNT(*) FROM activity_available_grades_v4
UNION ALL
SELECT 'activity_records_v4', COUNT(*) FROM activity_records_v4
UNION ALL
SELECT 'activity_record_grades_v4', COUNT(*) FROM activity_record_grades_v4;
