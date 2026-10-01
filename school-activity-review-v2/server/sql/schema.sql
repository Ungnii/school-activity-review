CREATE TABLE IF NOT EXISTS activities (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '기타',
  activity_date DATE,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
  id BIGSERIAL PRIMARY KEY,
  activity_id BIGINT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  reviewer_key TEXT NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  educational_effect SMALLINT NOT NULL CHECK (educational_effect BETWEEN 1 AND 5),
  student_participation SMALLINT NOT NULL CHECK (student_participation BETWEEN 1 AND 5),
  operation_ease SMALLINT NOT NULL CHECK (operation_ease BETWEEN 1 AND 5),
  reuse_intention SMALLINT NOT NULL CHECK (reuse_intention BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(activity_id, reviewer_key)
);

CREATE INDEX IF NOT EXISTS idx_reviews_activity_id ON reviews(activity_id);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at DESC);

INSERT INTO activities (title, category, activity_date, description)
SELECT '생태회랑길 체험활동', '체험활동', CURRENT_DATE, '학교 인근 생태회랑길을 활용한 생태·환경 체험활동입니다.'
WHERE NOT EXISTS (SELECT 1 FROM activities);
