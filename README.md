# 전국 날씨 · 미세먼지 지도 + AI 여행 도우미

정적 프론트엔드(Leaflet 2D 지도) + Vercel 서버리스 함수(`/api/chat`)로만 구성됩니다. 별도 서버(Railway 등)는 쓰지 않습니다.

## 에이전트 구조

```
브라우저 chat.js ──POST /api/chat──▶ api/chat.js (Gemini function calling 루프)
                                      ├─ get_weather(location)  → Open-Meteo 실시간 날씨 + 미세먼지
                                      └─ find_spots(area, category, limit) → 장소 검색
```

1. 사용자가 질문하면 Gemini 가 두 도구 중 필요한 것을 **선택(function call)** 한다.
2. 서버가 도구를 실행하고 결과를 Gemini 에 돌려준다. 필요하면 반복한다(최대 6회).
3. 최종 답변 + 호출 기록 + 추천 장소(지도 마커)를 반환한다.

예) "오늘 제주에서 뭐 하면 좋을까?" → `get_weather("제주")` → 날씨/미세먼지에 따라 `find_spots("제주", "beach" 또는 "indoor")` → 추천.

`find_spots` 데이터 소스
- **권장: 카카오 로컬 API** (`KAKAO_REST_API_KEY` 설정) — 전국 모든 장소·카페·식당, 실제 주소와 장소 페이지 링크. 지역명 → 좌표 변환에도 사용
- 키가 없을 때: `api/_spots.js` 의 전국 주요 명소 큐레이션(서울·부산·제주·경주·강릉 등 약 13개 지역)으로 대체. 카페·식당은 검색 불가

## Vercel 배포

1. 이 저장소를 Vercel 에서 Import (Framework Preset: **Other**, 빌드 설정 없음)
2. Settings → Environment Variables
   - `GEMINI_API_KEY` (필수) — https://aistudio.google.com/apikey
   - `GEMINI_MODEL` (선택, 기본 `gemini-2.5-flash`)
   - `KAKAO_REST_API_KEY` (권장) — https://developers.kakao.com → 내 애플리케이션 → 앱 만들기 → 앱 키 → **REST API 키**
     (403 이 나면 앱 설정에서 '카카오맵' 사용 설정이 켜져 있는지 확인)
3. 환경변수 추가 후 **Redeploy**

키는 서버 함수에서만 사용되며 브라우저로 전달되지 않습니다.

## 로컬 실행

```bash
npm i -g vercel
cp .env.example .env.local   # GEMINI_API_KEY 입력
vercel dev
```
