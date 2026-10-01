# 우리학교 교육활동 리뷰 v2

단일 학교에서 사용하는 교육활동 리뷰 시스템입니다.

## 주요 기능
- 교육활동 목록/분류/상세
- 학교 구성원 인증코드 로그인
- 구성원만 리뷰 작성/수정
- 리뷰 화면에서는 작성자를 익명으로 표시
- 종합평점 + 교육적 효과 + 학생 참여도 + 운영 편의성 + 재실행 의향 평가
- 관리자 대시보드
- 교육활동 추가/삭제
- Excel(.xlsx) 다운로드: 전체 리뷰 + 활동별 요약
- PostgreSQL(Neon 등) 사용

## 1. DB 준비
PostgreSQL 데이터베이스를 만든 뒤 `server/sql/schema.sql`을 실행합니다.

## 2. 서버 환경변수
`server/.env.example`을 `.env`로 복사하고 입력합니다.

- DATABASE_URL: PostgreSQL 연결 문자열
- JWT_SECRET: 긴 임의 문자열
- ADMIN_PASSWORD: 관리자 비밀번호
- SCHOOL_ACCESS_CODE: 학교 구성원 인증코드
- CLIENT_ORIGIN: 프론트 주소(로컬에서는 http://localhost:5173)
- PORT: Render에서는 자동으로 주입되므로 보통 수정하지 않습니다.

## 3. 서버 실행
```bash
cd server
npm install
npm start
```

## 4. 프론트 실행
```bash
cd client
npm install
npm run dev
```

`client/.env`에 `VITE_API_URL`을 실제 서버 주소로 설정합니다.

## 5. Render 배포
- Root Directory: `server`
- Build Command: `npm install`
- Start Command: `npm start`
- 환경변수: 위 `.env` 항목 입력

## 6. Netlify 배포
- Base directory: `client`
- Build command: `npm run build`
- Publish directory: `client/dist`
- 환경변수 `VITE_API_URL=https://YOUR-RENDER-DOMAIN/api`

## 운영상 권장
현재 구성원 인증은 '학교에서 공유하는 접근코드' 방식입니다. 즉, 개인정보를 별도로 수집하지 않으면서 학교 구성원만 리뷰를 작성하게 하는 MVP입니다. 실제 학교 계정(예: Google Workspace/Microsoft 365)으로 엄격히 제한하려면 다음 단계에서 OAuth 로그인을 붙일 수 있습니다.
