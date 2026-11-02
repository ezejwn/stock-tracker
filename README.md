# 아이씨에이치 (368600) 기업 노트

기존 `stock-tracker`(실시간 주가 & 뉴스 대시보드)를 아이씨에이치 기업 노트로 확장한 버전입니다. **저장소 구조·Netlify 설정·환경변수 이름은 기존과 같습니다.** 이 폴더 내용으로 저장소를 덮어쓰고 push하면 같은 사이트(teal-salamander-64b50e)에 그대로 배포됩니다.

## 폴더 구성 (기존과 같은 자리)

```
├─ public/                      ← 기존과 같은 publish 폴더
│   ├─ index.html               화면 뼈대
│   ├─ app.js                   렌더링·차트·필터
│   └─ data/ich-data.js         ★ 내용 데이터 — 업데이트는 여기만
├─ netlify/functions/
│   ├─ stock.js                 ← 기존 파일 확장 (KIS 현재가·일봉·투자자, 토큰 재사용)
│   ├─ news.js                  ← 기존 파일 확장 (네이버 뉴스, axios 대신 fetch)
│   └─ notes.js                 신규 — 사이트에서 기록 추가
├─ netlify.toml                 publish = "public" (기존과 동일)
├─ package.json
└─ .gitignore                   .env 커밋 방지
```

`main.py`, `.vscode/`는 사이트에 쓰이지 않으니 지워도 됩니다(로컬 토큰 테스트용으로 남겨도 무방하나 `.env`는 반드시 저장소에서 삭제).

## 반영 순서

1. **KIS 앱키 재발급** — 예전 `.env`가 공개 저장소에 올라가 있었으므로 KIS Developers에서 새로 발급.
2. 저장소에서 `.env` 삭제, 이 폴더 내용으로 덮어쓰기 → commit → push.
3. Netlify → Site configuration → Environment variables:

| 이름 | 필수 | 내용 |
|---|---|---|
| `KIS_APPKEY` | ✅ | 새로 발급한 앱키 |
| `KIS_APPSECRET` | ✅ | 새로 발급한 시크릿 |
| `NAVER_CLIENT_ID` | | 네이버 검색 API (실시간 뉴스) |
| `NAVER_CLIENT_SECRET` | | 〃 |
| `NOTE_ADMIN_TOKEN` | | 사이트에서 기록 추가·삭제용 비밀 문자열 (아무 긴 문자열) |

4. Deploys → **Trigger deploy → Clear cache and deploy site**.
5. 확인: `https://teal-salamander-64b50e.netlify.app/.netlify/functions/stock?type=price` 를 열어 `"ok":true`가 나오면 연결 성공.

| 열었을 때 | 의미 |
|---|---|
| 404 | 함수가 배포 안 됨 — 드래그 앤 드롭 배포는 함수를 안 올림. Git 연결로 배포 |
| `환경변수가 없습니다` | 3번 후 재배포 안 함 |
| `토큰 발급 실패` | 키 오류 또는 1분 1회 발급 제한 — 1분 뒤 재시도 |

## 기존 대비 바뀐 점

- **stock.js** — 예전처럼 `?code=005930`만 주면 현재가 원본을 그대로 반환(호환). `&type=price|daily|investor`로 정리된 데이터·일봉·투자자별 매매. 토큰을 24시간 저장해 재사용(예전엔 매 조회마다 새 토큰 → 1분 제한에 걸려 실패).
- **news.js** — 검색어 기본값 `아이씨에이치`, 20건, HTML 태그 제거, 날짜 정리. `axios` 의존성 제거.
- **화면** — 대시보드 → 기업 노트(시세·개요·투자 관점·사업·고객/아이템 트래커·실적·자본 이력·밸류·산업·누적 기록·확인할 것·일정/리스크·기사·연혁·용어·출처).

## 정보 업데이트

**데이터 파일** `public/data/ich-data.js`를 고쳐 push하면 반영됩니다.

| 새로 생긴 것 | 고칠 곳 |
|---|---|
| 미팅·IR·통화 | `LOG` 맨 위에 추가 |
| 기사 | `NEWS` 맨 위에 추가 (중요하면 `LOG`에도) |
| 분기 실적 | `QUARTERS` 가이던스 행 → 실적, `BS`·`META.equity`·`META.ttmSales` 갱신 |
| 고객·아이템 진척 | `ITEMS`의 `stage`·`size`·`updated` |
| 답을 들은 질문 | `OPEN`의 `status`·`answer`·`date` |
| 투자 관점 | `THESIS` |
| 수정 내역 | `CHANGELOG` 맨 위 |

**사이트에서 바로** — '누적 기록' 아래 "기록 추가"에 `NOTE_ADMIN_TOKEN` 값을 넣고 저장. 실시간 뉴스의 NEW 기사는 "+ 기록"으로 한 번에 추가. 비공개로 저장한 기록은 토큰이 있는 브라우저에서만 보입니다.

## 공개 범위
netlify.app 주소는 링크를 아는 누구나 볼 수 있습니다(검색 노출만 `noindex`로 막음). 미팅 메모 중 '공개 불가' 항목과 NDA 대상 고객 명칭은 넣지 않았습니다.
