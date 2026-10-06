# 우리학교 교육활동 아카이브 v4

학교에서 운영한 교육활동의 정보를 기록하고, 다음 학년도의 교육활동 선택에 필요한 정보를 제공하는 아카이브 시스템입니다.

## 핵심 기능
- 교육활동 기본정보 등록: 활동명 / 유형 / 운영기관 / 프로그램 소개 / 소요시간
- 신청 가능한 학년 1~6학년 선택
- 연도별 운영 기록: 운영 연도 / 실제 운영 학년 / 예산 / 만족도 / 장점 / 단점 / 재실시 추천 / 추가 의견 / 작성자
- 일반 화면: 학년 필터, 검색, 활동 상세, 연도별 기록 확인
- 관리자: 교육활동 등록·수정·비활성화, 운영 기록 등록·수정

## 중요: Neon DB
기존 v3 테이블은 건드리지 않습니다. `server/sql/schema.sql`은 `_v4` 테이블만 생성합니다.
이미 Neon에서 이 SQL을 실행했다면 다시 실행할 필요가 없습니다.

## Render
Root Directory: `server`
Build Command: `npm install`
Start Command: `npm start`
환경변수:
- DATABASE_URL = 기존 Neon DATABASE_URL 그대로
- JWT_SECRET = 긴 임의 문자열
- ADMIN_PASSWORD = 관리자 비밀번호
- CLIENT_ORIGIN = Netlify 주소
- PORT = 10000 (Render에서 자동 PORT를 제공하므로 없어도 됨)

## Netlify
Base directory: `client`
Build command: `npm run build`
Publish directory: `dist`
환경변수:
- VITE_API_URL = `https://school-activity-review-api.onrender.com/api`

## 기존 Render/Netlify 주소를 그대로 쓸 경우
현재 사용 중인 Render API와 Netlify 사이트를 새 v4 코드로 교체해서 사용할 수 있습니다. 기존 v3 DB 테이블은 삭제하지 않습니다.
