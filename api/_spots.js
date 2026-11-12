// 전국 주요 명소 큐레이션 데이터 (find_spots 기본 데이터 소스)
// category: attraction(관광명소) | museum(박물관·미술관) | park(공원·자연) | beach(해변) | indoor(실내 놀거리)
// indoor: 비·미세먼지 때 가기 좋은 실내 장소 여부. 좌표는 지도 표시용 대략값(약 1km 오차).
// 전국 모든 장소·카페·식당까지 검색하려면 환경변수 KAKAO_REST_API_KEY 를 설정한다(_lib.js 참고).
const SPOTS = [
  // ── 서울 ──
  { name: "경복궁", area: "서울", category: "attraction", indoor: false, lat: 37.5796, lon: 126.977, desc: "조선의 법궁, 근정전과 경회루" },
  { name: "북촌한옥마을", area: "서울", category: "attraction", indoor: false, lat: 37.5826, lon: 126.983, desc: "전통 한옥 골목 산책" },
  { name: "N서울타워(남산)", area: "서울", category: "attraction", indoor: false, lat: 37.5512, lon: 126.9882, desc: "서울 전경 전망" },
  { name: "서울숲", area: "서울", category: "park", indoor: false, lat: 37.5444, lon: 127.0374, desc: "도심 속 대형 숲 공원" },
  { name: "여의도 한강공원", area: "서울", category: "park", indoor: false, lat: 37.5284, lon: 126.9326, desc: "한강 산책, 피크닉" },
  { name: "국립중앙박물관", area: "서울", category: "museum", indoor: true, lat: 37.524, lon: 126.9803, desc: "한국 최대 규모 박물관" },
  { name: "국립현대미술관 서울관", area: "서울", category: "museum", indoor: true, lat: 37.5788, lon: 126.9807, desc: "현대미술 전시" },
  { name: "롯데월드 아쿠아리움", area: "서울", category: "indoor", indoor: true, lat: 37.5131, lon: 127.104, desc: "잠실 롯데월드몰 수족관" },
  { name: "코엑스 별마당도서관", area: "서울", category: "indoor", indoor: true, lat: 37.51, lon: 127.059, desc: "대형 서가가 있는 실내 휴식 공간" },

  // ── 인천 ──
  { name: "송도 센트럴파크", area: "인천", category: "park", indoor: false, lat: 37.3915, lon: 126.64, desc: "해수 수로가 있는 도심 공원" },
  { name: "인천 차이나타운", area: "인천", category: "attraction", indoor: false, lat: 37.4749, lon: 126.617, desc: "짜장면 발상지, 거리 구경" },
  { name: "월미도", area: "인천", category: "attraction", indoor: false, lat: 37.4747, lon: 126.5985, desc: "바다 산책, 놀이시설" },

  // ── 수원 ──
  { name: "수원화성", area: "수원", category: "attraction", indoor: false, lat: 37.2872, lon: 127.0119, desc: "유네스코 세계유산 성곽" },
  { name: "광교호수공원", area: "수원", category: "park", indoor: false, lat: 37.2825, lon: 127.067, desc: "호수 산책로" },

  // ── 춘천 ──
  { name: "남이섬", area: "춘천", category: "attraction", indoor: false, lat: 37.7916, lon: 127.5255, desc: "메타세쿼이아 길이 있는 섬" },
  { name: "소양강 스카이워크", area: "춘천", category: "attraction", indoor: false, lat: 37.8924, lon: 127.7296, desc: "소양강 위 유리 보행교" },

  // ── 강릉 · 속초 ──
  { name: "경포해변", area: "강릉", category: "beach", indoor: false, lat: 37.8057, lon: 128.9086, desc: "넓은 백사장과 경포호" },
  { name: "안목해변 커피거리", area: "강릉", category: "beach", indoor: false, lat: 37.7712, lon: 128.9475, desc: "바다를 보며 커피" },
  { name: "오죽헌", area: "강릉", category: "attraction", indoor: false, lat: 37.7787, lon: 128.8789, desc: "신사임당·율곡 이이의 생가" },
  { name: "속초해수욕장", area: "속초", category: "beach", indoor: false, lat: 38.1919, lon: 128.6, desc: "설악산과 바다를 함께" },
  { name: "설악산 국립공원", area: "속초", category: "park", indoor: false, lat: 38.1195, lon: 128.4656, desc: "케이블카와 울산바위" },
  { name: "아바이마을", area: "속초", category: "attraction", indoor: false, lat: 38.2, lon: 128.5936, desc: "갯배와 함경도 실향민 마을" },

  // ── 대전 ──
  { name: "국립중앙과학관", area: "대전", category: "museum", indoor: true, lat: 36.3768, lon: 127.3786, desc: "과학 체험 전시" },
  { name: "엑스포 한빛탑", area: "대전", category: "attraction", indoor: false, lat: 36.3763, lon: 127.388, desc: "엑스포 시민광장" },
  { name: "대전 오월드", area: "대전", category: "attraction", indoor: false, lat: 36.2878, lon: 127.3978, desc: "동물원·놀이공원" },
  { name: "계족산 황톳길", area: "대전", category: "park", indoor: false, lat: 36.3939, lon: 127.445, desc: "맨발 걷기 황톳길" },

  // ── 대구 ──
  { name: "김광석 다시그리기길", area: "대구", category: "attraction", indoor: false, lat: 35.859, lon: 128.606, desc: "벽화 골목" },
  { name: "이월드", area: "대구", category: "attraction", indoor: false, lat: 35.853, lon: 128.566, desc: "83타워와 놀이공원" },
  { name: "국립대구박물관", area: "대구", category: "museum", indoor: true, lat: 35.8416, lon: 128.6273, desc: "영남 지역 문화유산" },
  { name: "팔공산", area: "대구", category: "park", indoor: false, lat: 35.9929, lon: 128.6913, desc: "케이블카와 등산" },

  // ── 울산 ──
  { name: "대왕암공원", area: "울산", category: "park", indoor: false, lat: 35.4936, lon: 129.4393, desc: "해안 기암과 출렁다리" },

  // ── 경주 ──
  { name: "불국사", area: "경주", category: "attraction", indoor: false, lat: 35.7899, lon: 129.332, desc: "유네스코 세계유산 사찰" },
  { name: "석굴암", area: "경주", category: "attraction", indoor: false, lat: 35.7948, lon: 129.3495, desc: "신라 석굴 사원" },
  { name: "동궁과 월지", area: "경주", category: "attraction", indoor: false, lat: 35.8344, lon: 129.225, desc: "야경 명소" },
  { name: "대릉원", area: "경주", category: "attraction", indoor: false, lat: 35.8386, lon: 129.2121, desc: "신라 고분군, 황리단길 인근" },
  { name: "국립경주박물관", area: "경주", category: "museum", indoor: true, lat: 35.8294, lon: 129.2272, desc: "신라 유물 전시" },

  // ── 부산 ──
  { name: "해운대해수욕장", area: "부산", category: "beach", indoor: false, lat: 35.1587, lon: 129.1604, desc: "국내 대표 해수욕장" },
  { name: "광안리해수욕장", area: "부산", category: "beach", indoor: false, lat: 35.1532, lon: 129.1186, desc: "광안대교 야경" },
  { name: "감천문화마을", area: "부산", category: "attraction", indoor: false, lat: 35.0975, lon: 129.0107, desc: "알록달록한 산비탈 마을" },
  { name: "태종대", area: "부산", category: "park", indoor: false, lat: 35.0512, lon: 129.087, desc: "해안 절벽 산책로" },
  { name: "용두산공원", area: "부산", category: "park", indoor: false, lat: 35.1008, lon: 129.0324, desc: "부산타워가 있는 공원" },
  { name: "부산시민공원", area: "부산", category: "park", indoor: false, lat: 35.1688, lon: 129.0575, desc: "도심 속 대형 공원" },
  { name: "국립해양박물관", area: "부산", category: "museum", indoor: true, lat: 35.0783, lon: 129.0801, desc: "바다 주제 박물관" },
  { name: "부산시립박물관", area: "부산", category: "museum", indoor: true, lat: 35.136, lon: 129.0975, desc: "부산의 역사 전시" },
  { name: "씨라이프 부산 아쿠아리움", area: "부산", category: "indoor", indoor: true, lat: 35.1587, lon: 129.1603, desc: "해운대 해변 앞 수족관" },
  { name: "센텀시티 신세계 백화점", area: "부산", category: "indoor", indoor: true, lat: 35.169, lon: 129.1296, desc: "대형 실내 쇼핑·문화 공간" },

  // ── 전주 ──
  { name: "전주한옥마을", area: "전주", category: "attraction", indoor: false, lat: 35.8149, lon: 127.153, desc: "한옥 골목과 먹거리" },
  { name: "경기전", area: "전주", category: "attraction", indoor: false, lat: 35.8153, lon: 127.1491, desc: "태조 이성계 어진 봉안" },
  { name: "덕진공원", area: "전주", category: "park", indoor: false, lat: 35.8466, lon: 127.1213, desc: "연꽃 호수 공원" },

  // ── 광주 ──
  { name: "국립아시아문화전당", area: "광주", category: "museum", indoor: true, lat: 35.1469, lon: 126.92, desc: "복합 문화 전시관" },
  { name: "무등산 국립공원", area: "광주", category: "park", indoor: false, lat: 35.1337, lon: 126.9887, desc: "주상절리와 등산" },
  { name: "양림동 역사문화마을", area: "광주", category: "attraction", indoor: false, lat: 35.1397, lon: 126.9156, desc: "근대 건축 골목" },

  // ── 여수 ──
  { name: "오동도", area: "여수", category: "park", indoor: false, lat: 34.7432, lon: 127.765, desc: "동백나무 숲 섬" },
  { name: "아쿠아플라넷 여수", area: "여수", category: "indoor", indoor: true, lat: 34.736, lon: 127.7436, desc: "대형 수족관" },
  { name: "여수 해상케이블카", area: "여수", category: "attraction", indoor: false, lat: 34.7317, lon: 127.734, desc: "바다 위 케이블카" },

  // ── 제주 ──
  { name: "성산일출봉", area: "제주", category: "attraction", indoor: false, lat: 33.458, lon: 126.9425, desc: "유네스코 세계유산 분화구" },
  { name: "한라산 국립공원", area: "제주", category: "park", indoor: false, lat: 33.3617, lon: 126.5292, desc: "백록담 등반" },
  { name: "용두암", area: "제주", category: "attraction", indoor: false, lat: 33.516, lon: 126.5116, desc: "공항 근처 해안 기암" },
  { name: "비자림", area: "제주", category: "park", indoor: false, lat: 33.4903, lon: 126.8056, desc: "비자나무 숲길" },
  { name: "협재해수욕장", area: "제주", category: "beach", indoor: false, lat: 33.394, lon: 126.2398, desc: "에메랄드빛 바다" },
  { name: "함덕해수욕장", area: "제주", category: "beach", indoor: false, lat: 33.543, lon: 126.6697, desc: "얕고 맑은 해변" },
  { name: "국립제주박물관", area: "제주", category: "museum", indoor: true, lat: 33.512, lon: 126.578, desc: "제주 역사·문화 전시" },
  { name: "제주민속자연사박물관", area: "제주", category: "museum", indoor: true, lat: 33.513, lon: 126.526, desc: "제주의 자연과 민속" },
  { name: "아쿠아플라넷 제주", area: "제주", category: "indoor", indoor: true, lat: 33.4335, lon: 126.9288, desc: "성산 대형 수족관" },
  { name: "천지연폭포", area: "서귀포", category: "attraction", indoor: false, lat: 33.2467, lon: 126.5545, desc: "서귀포 시내 폭포" },
  { name: "중문·색달해변", area: "서귀포", category: "beach", indoor: false, lat: 33.2447, lon: 126.4093, desc: "서핑 명소" },
  { name: "이중섭미술관", area: "서귀포", category: "museum", indoor: true, lat: 33.2455, lon: 126.565, desc: "화가 이중섭 거주지 전시" },
];

const COVERED_AREAS = [...new Set(SPOTS.map((s) => s.area))];

module.exports = { SPOTS, COVERED_AREAS };
