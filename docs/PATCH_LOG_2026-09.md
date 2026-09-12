# 대량 패치 기록 (2026-09-10)

코드 리뷰 결과를 3단계로 나눠 적용한 기록입니다. 단계마다 커밋과 태그를 따로 남겨서 어느 시점으로든 되돌릴 수 있습니다.

## 복구 지점

| 시점 | Git 참조 | 설명 |
|---|---|---|
| 패치 전 | `backup/before-mass-patch-2026-09-10` (커밋 `7242336`) | 패치를 시작하기 직전의 `main` |
| 1단계 후 | `mass-patch/phase1` | 치명 버그 5종 + Error Boundary |
| 2단계 후 | `mass-patch/phase2` | 재시도·IME·단어장·중복 번역 등 |
| 3단계 후 | `mass-patch/phase3` | App.tsx 분리, 검출 Worker, 새로고침 복원 |

작업 브랜치: `patch/mass-refactor-2026-09` (`main`에는 아직 반영하지 않음 — `main`에 push하면 GitHub Pages로 자동 배포됨)

### 되돌리는 방법

```bash
# 1) 특정 시점 코드를 둘러보기만 (읽기 전용)
git switch --detach backup/before-mass-patch-2026-09-10

# 2) 특정 단계 상태에서 새 브랜치로 이어서 작업
git switch -c restore-from-phase1 mass-patch/phase1

# 3) 이미 main에 병합·배포한 뒤 되돌리기 (이력 보존, 권장)
git switch main
git revert --no-edit -m 1 <병합 커밋 해시>
git push

# 4) 아직 push하지 않은 로컬 main을 패치 전으로 강제 복구 (이력 삭제, 주의)
git switch main
git reset --hard backup/before-mass-patch-2026-09-10
```

### 브라우저 데이터 호환성

- 번역 캐시 키 형식(`manga-cache-unified-<파일명>-<크기>`)과 단어장 키(`manga-glossary-current`)는 **바꾸지 않았습니다.** 어느 단계로 되돌려도 기존 번역 기록을 그대로 읽습니다.
- 1단계부터 번역 데이터를 읽을 때 좌표가 깨진 항목은 걸러냅니다. (과거 버그로 저장된 손상 데이터가 화면을 멈추게 하던 문제)

---

## 1단계 — 치명 버그 수정

| # | 문제 | 수정 | 주요 파일 |
|---|---|---|---|
| 1 | ZIP 내보내기가 페이지를 넘기며 화면을 캡처 → 책 전체 자동 번역(과금), 번역 도착 전 페이지는 빈 채로 저장, 대본 모드에선 번역 없음, 화면 해상도로 저장 | 원본 이미지 + 저장된 번역을 캔버스에 직접 합성. 페이지 이동 없음, 원본 해상도, 원본이 PNG면 PNG / 그 외 JPG. 미번역 페이지 수를 미리 안내. 페이지별 다운로드도 같은 방식 | `src/lib/exportCanvas.ts`, `src/lib/download.ts` |
| 2 | macOS 압축 ZIP/CBZ 업로드 전체 실패, `.JPG` 누락, `1, 10, 2` 순서, 챕터 폴더 섞임 | `__MACOSX`·숨김 파일 제외, 확장자 대소문자 무시, 폴더 경로 포함 자연 정렬, 깨진 이미지는 건너뛰고 개수 안내 | `src/lib/fileImport.ts` |
| 3 | 새 영역 번역·재번역 결과를 배열 위치로 저장 → 대기 중 삭제·재정렬 시 엉뚱한 말풍선 덮어쓰기, 좌표 없는 항목 저장 후 흰 화면 | 모든 갱신을 말풍선 `id` 기준으로 변경. 저장소·JSON·백업에서 읽는 데이터 검증 | `src/App.tsx`, `src/lib/results.ts` |
| 4 | 구글 로그인 팝업을 닫으면 드라이브 버튼이 영구 로딩 | `error_callback` 추가, 사용자가 닫은 경우 조용히 종료 | `src/App.tsx` |
| 5 | 이미지 로드 후 파일을 끌어다 놓으면 브라우저가 파일을 열어 작업 유실 | 화면 전체를 드롭 영역으로(놓으면 추가), 그 밖은 파일 열기 차단, 이탈 경고 | `src/App.tsx` |
| + | 렌더링 오류 시 흰 화면 | Error Boundary: 새로고침 / 번역 기록 초기화 후 새로고침 안내 | `src/components/ErrorBoundary.tsx` |

부수 변경
- `html2canvas` 의존성 제거 (JS 번들 1.31MB → 1.12MB)
- `vitest` 도입, `npm test` 추가
- API 응답 타입 분리: `RawTranslationResult`(id 없음) / `TranslationResult`(id 필수)

검증
- `tsc -b` 통과, `vitest` 15개 통과, `vite build` 성공
- 브라우저: `__MACOSX/._10.JPG`·`.DS_Store`·대문자 확장자가 섞인 CBZ + 손상 항목이 든 JSON을 함께 드롭 → 3장이 1·2·10 순서로 로드, 손상 항목 2개 제거 후 정상 렌더링. ZIP 내보내기 결과가 원본 800×1200, 말풍선 위치에 흰 배경 합성 확인

---

## 2단계 — 안정성·비용·입력 개선

| # | 문제 | 수정 | 주요 파일 |
|---|---|---|---|
| 1 | Gemini는 503만 재시도, 429(요청 한도)는 즉시 실패. 재시도 코드가 5곳에 중복 | 공통 `withRetry`: 429·5xx·네트워크 오류만 지수 백오프+jitter로 3회 재시도, OpenAI `Retry-After` 존중, 결제 한도 소진(`insufficient_quota`)은 재시도 안 함. 최종 실패는 한국어 안내(키 오류/한도 초과/과부하)로 변환 | `src/lib/retry.ts`, `gemini.ts`, `openai.ts` |
| 2 | **(테스트 중 발견, 기존 버그)** 3장을 동시에 번역하면 ONNX 세션 동시 실행 오류(`Session already started`)로 2장이 실패 | 말풍선 검출 추론을 큐로 직렬화. 모델 로드 실패 후 재시도 가능 | `src/lib/yolo.ts` |
| 3 | 번역 진행 표시가 페이지 번호 기준 → `추가`로 순서가 바뀌면 중복 호출(과금)·누락 | 캐시 키(파일) 기준으로 추적. 동시 3장 워커 풀, 끝난 페이지부터 즉시 반영 | `src/App.tsx` |
| 4 | API 키를 한 글자씩 치면 첫 글자에서 번역 시작 → 실패로 남음 | 키 입력이 800ms 멈춘 뒤에만 번역 시작. 저장된 키는 첫 렌더부터 읽어 지연 없음 | `src/App.tsx` |
| 5 | 실패 원인이 콘솔에만 찍히고 화면엔 "오류 발생"만. 키가 없어도 "번역 실패"로 표시 | 페이지별 오류 메시지 + 페이지별 다시 시도. 키 없음/자동 번역 꺼짐/대기/번역 중 상태 구분. 덮어쓰기 모드용 하단 바 상태 표시. 같은 키로 실패한 페이지는 자동 재호출 안 함(키를 바꾸면 재시도) | `src/App.tsx` |
| 6 | `기록 삭제` 직후 현재+10장 자동 재번역(의도치 않은 과금) | 삭제 시 자동 번역 OFF. 상단 `자동 번역 ON/OFF` 토글(저장됨), 꺼져 있을 때 "이 페이지만 번역" | `src/App.tsx` |
| 7 | 백업을 불러오면 단어장을 덮어씀(옛 백업이면 삭제) | 현재 단어장에 병합, 병합 개수 안내 | `src/App.tsx` |
| 8 | 한글 IME 조합 중 Enter로 저장/추가 → 마지막 글자 잔류 | 조합 중 Enter 무시 (대본 수정, 단어장 입력) | `src/App.tsx` |
| 9 | 단어장 전체를 모든 프롬프트에 첨부 | 원문을 아는 요청(재번역·OpenAI)은 등장하는 항목만 첨부(요미가나 표기 무시하고 매칭) | `src/lib/prompt.ts` |
| 10 | 2장 모드에서 한 장만 보여도 "5 - 6" 표시 / Ctrl+휠 시 브라우저 화면도 확대 | 보이는 장수 기준 표시 / non-passive wheel 리스너로 브라우저 확대 차단 | `src/App.tsx` |
| + | "이어서 자동 번역 재개"가 localStorage의 빈 캐시는 안 지워 새로고침 시 되살아남 | 저장소에서도 삭제 | `src/App.tsx` |

새 설정값 (localStorage): `manga-translator-auto-translate` (`true`/`false`). 되돌려도 무시될 뿐 문제없음.

검증
- `tsc -b` 통과, `vitest` 30개 통과(재시도·프롬프트 15개 추가), `vite build` 성공
- 브라우저(Gemini API를 가짜 응답으로 대체):
  - 키 없음 안내 → 키를 한 글자씩 입력하는 동안 호출 0회 → 입력 멈춘 뒤 정확히 3회(보이는 2장+미리 1장)
  - 잘못된 키(400)는 재시도 없이 "Gemini API 키가 올바르지 않거나 권한이 없습니다" 페이지별 표시
  - 다시 시도 → 429 응답 후 2초 대기·재시도 → 번역 반영
  - 기록 삭제 → 자동 번역 OFF, 이후 페이지 이동해도 호출 0회
  - Ctrl+휠: 브라우저 기본 확대 차단, 앱 배율 100%→110% / 표시 "- 2 / 3" → 마지막 장 "/ 3"
  - 조합 중 Enter는 단어장 추가 안 됨, 일반 Enter는 추가 / 백업 드롭 시 단어장 3개로 병합

---

## 3단계 — 구조 개편 · 검출 백그라운드 실행 · 새로고침 복원

| 항목 | 내용 | 주요 파일 |
|---|---|---|
| App.tsx 분리 | 1,950줄 한 파일 → 조립만 하는 약 490줄. 화면은 `components/`, 상태 로직은 `hooks/`, 순수 로직은 `lib/`로 분리 | 아래 구조 참고 |
| 말풍선 검출 Web Worker | ONNX 추론과 전처리(640×640 레터박스)를 Worker에서 실행해 번역 중 화면이 멈추지 않음. Worker 안에서 요청을 순서대로 처리(세션 동시 실행 오류 방지), 모델 로드 실패 시 다음 요청에서 재시도. 후처리·NMS는 순수 함수로 분리해 테스트 | `lib/yolo.worker.ts`, `lib/yolo.ts`, `lib/yoloPostprocess.ts`, `vite.config.ts` |
| 새로고침 복원 | 이미지·순서·작품명·읽던 페이지를 IndexedDB에 저장 → 다시 열면 자동 복원. 이미 저장된 이미지는 다시 쓰지 않고 추가·삭제분만 반영. 복원이 끝나기 전엔 저장하지 않아 기존 작업을 덮어쓰지 않음. 헤더에 **작업 닫기** 추가(번역 기록·단어장은 유지) | `lib/sessionStore.ts`, `hooks/useSessionPersistence.ts` |
| 캔버스 기반 내보내기 | 1단계에서 이미 적용 → 이번엔 App에서 분리만 | `lib/exportCanvas.ts` |
| 번역 파이프라인 정리 | 페이지 번역·새 영역 번역·문장 재번역을 App 밖으로 이동, 격자 좌표 변환 중복 제거, `openai.ts`의 미사용 인자 제거, 키 확인을 검출 전에 수행(키가 없으면 모델을 불필요하게 돌리지 않음) | `lib/translatePage.ts` |
| 파일 가져오기 정리 | 이미지·ZIP/CBZ·백업·JSON 가져오기를 순수 결과 객체로 반환, 병합·정렬 함수 분리 | `lib/importFiles.ts` |
| 페이지 배치 | 보이는 페이지·2장 묶음 시작·미리 번역 순서를 순수 함수로 분리 | `lib/pageLayout.ts` |
| + | 새 영역 번역이 실패했을 때 원래 번역이 없던 페이지면 빈 캐시를 남기지 않음(빈 캐시가 자동 번역을 막던 문제) | `hooks/useTranslationCache.ts` |

### 파일 구조

```
src/
├─ App.tsx                     화면 조립 + 사용자 동작 연결
├─ types.ts                    공용 타입
├─ components/
│  ├─ AppHeader.tsx  EmptyState.tsx  PageNavigator.tsx
│  ├─ MangaViewer.tsx          페이지·오버레이·영역 그리기·이동·확대
│  ├─ ScriptPanel.tsx          우측 대본(수정·삭제·재번역·순서 변경)
│  ├─ GlossaryModal.tsx  DriveModal.tsx
│  ├─ BoxEditor.tsx            (src/BoxEditor.tsx에서 이동)
│  └─ ErrorBoundary.tsx
├─ hooks/
│  ├─ useTranslationCache.ts   번역 캐시(localStorage)
│  ├─ useTranslationQueue.ts   자동 번역 대기열·페이지별 오류
│  ├─ useSessionPersistence.ts 새로고침 복원(IndexedDB)
│  ├─ useDriveSync.ts  useGlossary.ts  useDebouncedValue.ts
└─ lib/
   ├─ translatePage.ts  importFiles.ts  pageLayout.ts  sessionStore.ts
   ├─ yolo.ts  yolo.worker.ts  yoloPostprocess.ts
   ├─ exportCanvas.ts  fileImport.ts  results.ts  retry.ts  prompt.ts  download.ts
   └─ gemini.ts  openai.ts  drive.ts  imageUtils.ts  readingOrder.ts  cacheKey.ts
```

### 사용자가 느끼는 변화
- 새로고침하거나 탭을 닫았다 열어도 마지막 작품·페이지로 돌아옴. 새 작품은 **작업 닫기** 후 시작
- 페이지 이탈 경고는 저장이 끝나지 않았거나 ZIP 내보내기 중일 때만 표시 (IndexedDB를 못 쓰는 환경에선 예전처럼 항상 경고)
- 번역 중에도 화면이 끊기지 않음
- 첫 로딩 JS 1.12MB → 722KB (검출 코드 407KB는 번역이 시작될 때 Worker로 따로 로드)

### 새 브라우저 저장소
- IndexedDB `manga-translator` (`pages`, `meta`). 이전 단계로 되돌리면 사용되지 않고 남을 뿐 문제없음
- 지우려면 브라우저 콘솔에서 `indexedDB.deleteDatabase('manga-translator')`

### 검증
- `tsc -b` 통과, `vitest` 44개 통과(페이지 배치·검출 후처리·이미지 병합 14개 추가), `vite build` 성공
- 브라우저(개발 서버, Gemini 가짜 응답):
  - Worker에서 검출 실행 로그 확인 — 첫 장 13초(모델 로드 포함), 이후 장당 약 6초 순차 처리, 3장 모두 자동 번역
  - 덮어쓰기 모드에서 영역을 그려 새 말풍선 번역 → id로 추가·저장
  - 3페이지로 이동 후 새로고침 → 같은 작품·3페이지·번역 그대로 복원, 새로고침 후 API 호출 0회
  - 작업 닫기 후 새로고침 → 첫 화면, IndexedDB 페이지 0개, 번역 기록은 유지
- 배포 빌드(`vite build` + `vite preview`): Worker 파일(`assets/yolo.worker-*.js`)이 정상 로드되어 검출 2.4초, 번역 반영, 콘솔 오류 없음

---

## 추가 수정 — 푸시 전 테스트 피드백

| 문제 | 수정 | 파일 |
|---|---|---|
| 파일 이름이 길면 헤더가 가로로 늘어나 오른쪽 버튼(작업 닫기·모델 선택·API 키)이 잘림 | 파일 이름은 남는 공간만큼만 보이고 말줄임표 처리(마우스를 올리면 전체 이름). 화면 폭 1900px 미만에서는 헤더 버튼을 아이콘만 표시(마우스를 올리면 이름). 앱 제목은 2200px 이상에서만 표시. 그래도 모자라면 오른쪽 버튼 묶음이 다음 줄로 내려감 | `components/AppHeader.tsx` |

검증
- 긴 일본어 파일명으로 2400·2000·1920·1800·1536·1280·1024px 폭 확인 → 헤더·페이지 모두 가로 넘침 0px, 1024px에서는 헤더가 두 줄
- 예전 앱 형식의 백업 ZIP(id 없는 번역, 번역 없는 페이지, 단어장, 읽던 페이지 포함)을 드롭 → 드라이브 불러오기와 같은 복원 코드로 번역 3장·좌표·기존 id·단어장 병합·읽던 페이지까지 복원. 백업 ZIP 형식과 드라이브 업로드·다운로드 코드는 패치 전과 같음(읽을 때 좌표가 깨진 항목만 걸러내는 부분만 추가)

참고: 개발 서버(`http://localhost:5199`)에서 드라이브 로그인 시 `400 origin_mismatch`가 나는 것은 코드 문제가 아니라, Google Cloud Console의 OAuth 클라이언트 "승인된 JavaScript 원본"에 해당 주소가 등록되어 있지 않아서입니다.

---

## 추가 수정 2 — 이미지 저장(ZIP·페이지 다운로드) 화질과 글자 규칙

| 문제 | 원인 | 수정 | 파일 |
|---|---|---|---|
| 저장 이미지 해상도가 낮아 보임 | 원본 픽셀 크기 그대로 그려서, 레티나 화면보다 글자가 흐림. JPG 품질 0.92 | 원본 높이가 2400px보다 작으면 최대 3배까지 키워 그림(고품질 보간, 출력 1600만 픽셀 상한). JPG 품질 0.95 | `lib/exportCanvas.ts` |
| 저장본의 글자 줄바꿈이 화면 덮어쓰기와 다름 | ① 글자 크기를 "박스에 들어가는 최대 크기"로 따로 계산(화면은 글자 수·박스 비율로 추정) ② 화면 높이를 650px로 고정 가정 → 큰 모니터에서 저장본 글자가 상대적으로 커져 줄바꿈 증가 ③ 흰 상자가 긴 단어에서 넓어지는 규칙(최대 2배) 없음 ④ 자간·여백·글꼴 차이 | 화면과 저장이 같은 규칙 상수(`OVERLAY_STYLE`)와 같은 글자 크기 공식을 공유. 저장 시 지금 화면의 페이지 높이·배율·글꼴을 기준으로 CSS 배치(상자 너비 규칙, 줄바꿈, 높이 확장, 줄 높이 안 글자 위치)를 그대로 재현 | `lib/exportCanvas.ts`, `components/MangaViewer.tsx`, `App.tsx` |

검증
- `tsc -b` 통과, `vitest` 51개 통과(배치·해상도 테스트 추가)
- 브라우저: 짧은 효과음형·긴 대사·끊을 수 없는 긴 단어·단어 묶음 해제·줄바꿈 포함 5종 말풍선에서 화면 DOM과 저장 로직의 글자 크기·줄 수·상자 너비·높이가 모두 일치. 페이지 다운로드 결과 800×1200 원본 → 1600×2400 JPG, 화면 위에 겹쳐 비교해 동일

---

## 추가 수정 3 — 효과음(큰 글씨)은 원문을 두고 바깥에 작은 딱지

| 항목 | 내용 | 파일 |
|---|---|---|
| 자동 판별 | 번역문이 짧고(공백·문장부호 제외 5자 이하), 원문 한 글자가 페이지의 0.5% 이상을 차지할 만큼 크며 글자 영역이 페이지의 1% 이상이면 효과음으로 봄. 기준값은 `SFX_RULE`. 이미 번역해 둔 기록에도 바로 적용(재번역 불필요) | `lib/bubbleDisplay.ts` |
| 작은 딱지 | 원문 글자 영역 **바깥**의 오른쪽 → 왼쪽 → 아래 → 위 → 네 모서리 순으로 후보를 두고, 원문·다른 말풍선·다른 딱지와 가장 덜 겹치고 페이지 안에 들어오는 자리에 배치. 크기는 `TAG_STYLE`(배율 100%에서 16px) | `lib/bubbleDisplay.ts`, `components/MangaViewer.tsx` |
| 수동 전환 | 영역 수정 모드에서 말풍선 왼쪽 위 **덮기/작게** 버튼. 대본 패널의 **작게 표시** 버튼을 누르면 덮기로 전환. 직접 고른 값은 `display_mode`로 저장되어 자동 판별보다 우선 | `components/BoxEditor.tsx`, `components/ScriptPanel.tsx`, `App.tsx` |
| 이미지 저장 | 화면과 같은 배치 계산으로 덮기 말풍선 → 작은 딱지 순서로 그림 | `lib/exportCanvas.ts` |
| 구조 | 화면·저장 공용 배치 코드를 `lib/overlayLayout.ts`로 분리 (`exportCanvas.ts`는 그리기만) | |

새 저장 필드: 번역 결과의 `display_mode` (`'cover' | 'tag'`, 없으면 자동). 이전 버전으로 되돌리면 무시될 뿐 문제없음.

검증
- `tsc -b` 통과, `vitest` 61개 통과(효과음 판별·딱지 배치 10개 추가)
- 브라우저: 큰 효과음 2개 + 일반 대사 2개 페이지에서 효과음만 딱지로 자동 판별. 딱지는 원문 바깥(오른쪽 끝 효과음은 왼쪽)에 붙고 원문·다른 말풍선과 겹침 0px, 페이지 안, 글자 넘침 없음. 대본 패널 버튼·영역 수정 버튼으로 전환·저장 확인. 페이지 다운로드(1600×2400)를 화면 위에 겹쳐 딱지 위치까지 동일

---

## 추가 수정 4 — 놓친 글자·중복 번역·맥락 기억 (1·2단계)

### 1단계 — 검출과 중복 (API 비용 증가 없음)

| 문제 | 수정 | 파일 |
|---|---|---|
| 검은 배경의 흰 글씨를 검출하지 못해 번역에서 빠짐 | 어두운 픽셀이 5% 이상인 페이지는 색을 뒤집어 한 번 더 검출하고 결과를 합침 (모델이 학습한 "밝은 배경의 검은 글씨" 형태가 됨). 해당 페이지만 검출 시간 2배 | `lib/yolo.worker.ts`, `lib/yoloPostprocess.ts` |
| 같은 대사가 두 번 번역됨 | ① 큰 박스 안에 70% 이상 들어간 작은 박스는 버림 (IoU 기준만으로는 안 걸러짐) ② 모델이 같은 칸 번호를 두 번 돌려주면 첫 응답만 사용 | `lib/yoloPostprocess.ts`, `lib/translatePage.ts` |
| 박스를 딱 맞게 잘라 글자 획이 잘림 | 크롭에 사방 8% 여백 + 고품질 보간 | `lib/imageUtils.ts` |
| 작은 말풍선에서 글자가 넘침 | 최소 글자 크기 13px → **10px** (배율 100% 기준, 화면·저장 공통) | `lib/overlayLayout.ts` |

### 2단계 — 말투·맥락 기억

- **직전 대사 전달:** 이미 번역된 앞 페이지의 대사(최대 16줄)를 "이어지는 맥락"으로 프롬프트에 넣어 말투·호칭·고유명사를 일관되게 유지. 병렬 번역으로 바로 앞 페이지가 아직 없으면 번역이 끝난 가장 가까운 앞 페이지를 사용 (`lib/translationContext.ts`)
- **작품 노트:** 번역이 쌓이면(처음 3장, 이후 10장마다) Gemini가 인물별 말투·호칭·고유명사 표기를 요약해 저장하고, 이후 모든 번역 프롬프트에 함께 전달. 헤더 **[작품 노트]** 에서 직접 편집·AI 재정리 가능. 작품별로 저장되고 백업 ZIP에 포함 (`lib/workNotes.ts`, `hooks/useWorkNotes.ts`, `components/WorkNotesModal.tsx`)
- **문맥 우선 모드:** 작품 노트 창의 체크박스. 동시 3장 → 1장으로 낮춰 한 장씩 순서대로 번역해 앞 내용을 최대한 반영 (느리지만 일관성 최고)
- **버그 수정(테스트 중 발견):** 새로고침 직후 저장된 노트를 읽기 전에 자동 갱신이 먼저 돌아 불필요한 Gemini 요청 1회 + 오류 배너가 떴음 → 작품 노트를 같은 렌더에서 바로 읽도록 수정, 자동 갱신 실패는 배너 없이 로그만 남김

새 저장값: `manga-notes-<작품 이름>`, `manga-translator-auto-notes`, `manga-translator-context-first`. 이전 버전으로 되돌리면 무시될 뿐 문제없음

### 검증
- `tsc -b` 통과, `vitest` 75개 통과(중복 박스 정리·칸 중복 응답·맥락 수집 등 14개 추가), `vite build` 성공
- 브라우저(가짜 Gemini 응답, 3장):
  - 어두운 페이지(어두운 비율 0.665)에서 색 반전 재검출이 돌아 흰 글씨 1개 검출, 밝은 페이지는 재검출 없이 종료
  - 2번째 페이지 요청에 1번째 번역이, 3번째 요청에는 1·2번째 번역이 포함됨 (문맥 우선 모드)
  - 작품 노트 자동 생성·저장, 편집창 반영, AI 재정리 동작
  - 새로고침 후 불필요한 Gemini 요청 0회, 오류 배너 없음
  - 아주 작은 박스(폭 4.5% × 높이 1.5%)에서 글자 10px 적용
- **실제 만화로는 확인하지 못함.** 효과음 판별과 마찬가지로 반전 검출·중복 제거 기준값은 추정치이므로, 실사용에서 과·소 검출이 보이면 기준값 조정 필요

---

## 추가 수정 5 — 드라이브 저장 이름 기억 (같은 파일 계속 덮어쓰기)

| 문제 | 원인 | 수정 | 파일 |
|---|---|---|---|
| 드라이브에 저장할 때 기본 파일 이름이 계속 원본 만화 파일명으로 돌아감 | 저장 기본값을 화면에 표시되는 작품 이름(`loadedFilename`)에서 만들었음. 새 이름으로 저장해도 기억하지 않고, 원본 CBZ를 추가로 올리면 그 이름으로 바뀜 | 드라이브 저장 대상 이름(`driveFileName`)을 따로 기억. ① 드라이브에서 불러온 파일 이름 ② 로컬 백업 ZIP을 드롭한 이름 ③ 마지막으로 저장한 이름 순으로 유지되고, 세션(IndexedDB)에 저장돼 새로고침 후에도 남음. 페이지를 추가해도 바뀌지 않음 | `lib/drive.ts`(`defaultBackupFilename`), `App.tsx`, `hooks/useDriveSync.ts`, `hooks/useSessionPersistence.ts`, `lib/sessionStore.ts`, `lib/importFiles.ts` |

부수 변경
- 드라이브 버튼 설명에 덮어쓸 파일 이름 표시: `구글 드라이브에 저장 — "내 번역본.zip" 덮어쓰기`
- 저장 이름 입력창에 "같은 이름이면 드라이브의 기존 파일을 덮어씁니다" 안내 추가, 저장 완료 알림에 파일 이름 표시
- 작업 닫기 시 저장 대상 이름도 초기화

검증
- `tsc -b` 통과, `vitest` 79개 통과(기본 이름 규칙 4개 추가), lint 경고 증가 없음
- 브라우저(구글 로그인·드라이브 API를 가짜로 대체):
  - 백업 `DriveSave_1권.zip` 복원 → 저장 기본값이 같은 이름, 버튼 설명에도 표시
  - 첫 저장은 새 파일 생성(POST), 같은 이름으로 재저장하면 **기존 파일 덮어쓰기(PATCH)**
  - 원본 CBZ를 추가로 드롭해 작품 이름이 원문명으로 바뀌어도 저장 기본값은 `DriveSave_1권.zip` 유지
  - 다른 이름(`Renamed_v2.zip`)으로 저장하면 그 이름을 기억 → 다음 기본값·버튼 설명·세션에 반영, 새로고침 후에도 유지

---

## 추가 수정 6 — 빈 번역 자동 정리 · 홀쭉한 영역 세로쓰기

| 문제 | 수정 | 파일 |
|---|---|---|
| 그림을 글자로 잘못 인식해 번역이 비어 있는 빈 말풍선 자리가 남음 | 번역문이 비었거나 공백뿐인 항목은 저장·불러오기 시점에 걸러냄. 이미 저장된 기록도 열 때 정리되고 저장소에도 반영 | `lib/results.ts`, `hooks/useTranslationCache.ts` |
| 말풍선 없이 세로로 한 줄 쓰인 원문 자리에 가로로 쓰면, 줄바꿈이 안 돼 흰 영역을 넘침 | 홀쭉한 영역(가로로는 한 줄에 3글자도 못 들어가는 경우)은 자동으로 **세로쓰기**. 박스 높이에 맞춰 한 열에 들어갈 글자 수를 정하고, 넘치면 왼쪽으로 열을 늘림(일본 만화 방향). 박스 안에 들어가는 가장 큰 글자 크기를 고름 | `lib/overlayLayout.ts`, `components/VerticalBubbleText.tsx` |
| 자동 판별이 틀릴 때 | 영역 수정 모드 말풍선 왼쪽 아래 **가로/세로** 버튼으로 전환. 선택은 `text_direction`으로 저장되어 자동 판별보다 우선 | `components/BoxEditor.tsx`, `components/MangaViewer.tsx`, `App.tsx` |
| 이미지 저장 | 화면과 같은 배치 계산으로 세로쓰기도 그대로 그림 | `lib/exportCanvas.ts` |

새 저장 필드: 번역 결과의 `text_direction` (`'horizontal' | 'vertical'`, 없으면 자동). 이전 버전으로 되돌리면 무시될 뿐 문제없음

검증
- `tsc -b` 통과, `vitest` 89개 통과(빈 번역 정리·세로쓰기 배치 10개 추가), lint 경고 증가 없음
- 브라우저: 빈 번역·공백 번역 2건이 화면과 저장소에서 사라짐. 폭 32px·높이 335px 영역이 세로쓰기 12칸으로 표시되고 흰 상자가 영역을 덮으며 넘치지 않음. 일반 말풍선은 가로쓰기 유지. 페이지 다운로드(1600×2400)를 화면 위에 겹쳐 세로쓰기까지 동일. 영역 수정에서 **세로 → 가로** 전환 시 저장·즉시 반영 확인

---

## 추가 수정 7 — Gemini 토큰 절감 · [임시] OpenAI 비전 단독 테스트 토글

### 왜
OpenAI 모드에서는 번역을 OpenAI가 하는데도 Gemini에게 **전체 페이지 이미지 + 격자 이미지 2장**을 보내고 **번역문까지** 받아 버리고 있었다(받은 번역문은 쓰지 않고 버림). 또한 OpenAI가 이미지를 직접 읽을 수 있으므로 Gemini 없이도 되는지 실제 품질로 비교해볼 필요가 있었다.

| 변경 | 내용 | 파일 |
|---|---|---|
| ① Gemini 토큰 절감 | OpenAI 모드에서는 Gemini에게 **격자 이미지 1장만** 보내고 **원문 읽기(OCR)만** 요청. 전체 페이지 이미지·단어장·맥락 지시문을 빼고, 응답 스키마에서도 `translated_text`를 제거해 출력 토큰도 줄임. Gemini 모드(제공자=Gemini)는 이전과 완전히 동일 | `lib/gemini.ts`, `lib/translatePage.ts` |
| ② [임시] 비전 단독 토글 | 헤더에 **🧪 비전 단독 ON/OFF** (제공자가 OpenAI일 때만 보임). 켜면 **Gemini 호출 0건**, OpenAI(`gpt-5.6-sol`/`terra`)가 격자 이미지를 직접 읽어 OCR+번역을 한 번에 처리. 이 모드에서는 Google API 키가 필요 없음 | `components/AppHeader.tsx`, `App.tsx`, `types.ts`, `lib/openai.ts`, `lib/translatePage.ts` |
| 토큰 사용량 로그 | 모든 Gemini·OpenAI 호출의 입력·출력 토큰을 콘솔(`[tokens] …`)에 남기고 누적치를 `window.__mangaTokenUsage`로 확인 가능. 세 방식의 실제 소모량을 직접 비교하기 위한 장치 | `lib/usageLog.ts`(신규) |
| 안내 문구 수정 | "말풍선 위치 인식을 위한 Google API 키" → 말풍선 **위치**는 YOLO가 찾고 Gemini는 **원문 읽기(OCR)** 담당이라는 사실에 맞게 수정. 비전 단독 토글 안내도 함께 | `lib/translatePage.ts` |

### 세 가지 경로 정리
| 설정 | Gemini | OpenAI |
|---|---|---|
| 제공자=Gemini | 전체 페이지+격자 2장 → OCR+번역 | 호출 없음 |
| 제공자=OpenAI, 비전 단독 OFF | 격자 1장 → **OCR만** | 원문 텍스트 → 번역 |
| 제공자=OpenAI, 비전 단독 **ON** | **호출 없음** | 격자 1장 → OCR+번역 |

### 새 저장 키
- `manga-translator-openai-vision-only` (`'true'`/`'false'`) — **임시 실험용**. 비교가 끝나면 이 키와 관련 코드를 함께 제거

### 비교 테스트 방법
1. 제공자를 **OpenAI**로 두고 페이지를 번역 → 콘솔에서 `[tokens]` 확인
2. 헤더 **🧪 비전 단독**을 ON → **기록 삭제**로 그 페이지 캐시를 지워야 같은 페이지가 다시 번역됨(이미 번역된 페이지는 저장된 결과를 그대로 보여줌)
3. 두 결과의 번역 품질·원문 인식 정확도·토큰 소모량을 비교

### 되돌리기 (토글 제거 시 손댈 곳)
- `openAiVisionOnly` / `visionOnly` / `OPENAI_VISION_ONLY_STORAGE_KEY` / `translateGridImageOpenAI` / `FlaskConical` 를 검색하면 실험 코드 전부가 나옴
- ①만 남기려면 위 항목을 지우고 `translateGridImage`의 `ocrOnly` 경로는 유지
- ②를 정식 채택하려면 `translateGridImageOpenAI`를 기본 경로로 올리고 `lib/gemini.ts`의 격자 함수와 Google 키 입력을 정리

### 검증
- `tsc -b` 통과, `vitest` **96개** 통과(토큰 기록 2개, Gemini 격자 요청 3개, OpenAI 비전 2개 추가), `oxlint` 경고 12개로 이전과 동일, `vite build` 통과
- 브라우저(가짜 API 목, 말풍선 6개 페이지):
  - OpenAI 모드 OFF → Gemini 요청에 이미지 **1장**(격자)만 담기고 프롬프트에 "번역은 하지 마", 응답 스키마 `[id, original_text]` 확인. 이어서 OpenAI에 텍스트 전용 번역 요청 1건
  - 비전 단독 ON → **Gemini 요청 0건**, OpenAI 요청에 `image_url`(격자) 1장이 담기고 칸 번호대로 6개 말풍선에 번역이 들어감
  - 비전 단독 ON + Google 키 없음 → 정상 번역. OFF + Google 키 없음 → "Google API 키도 함께 필요합니다 (비전 단독 토글을 켜면…)" 안내
  - 콘솔 오류 0건, 토큰 누적치가 `window.__mangaTokenUsage`에 기록됨
- 테스트 후 localStorage·IndexedDB 정리, QA 서버(5299) 종료

---

## 추가 수정 8 — OpenAI 주력 전환 · Gemini 보조 · 지침/단어장/맥락 공통화

### 결정
실제 만화로 "비전 단독(플라스크)" 모드를 써본 결과 품질에 문제가 없어, **OpenAI를 주력으로 정식 채택**하고 실험 토글을 제거했다.

| 항목 | 전 | 후 |
|---|---|---|
| 기본 엔진 | Gemini | **OpenAI 5.6 Terra** (Sol도 선택 가능) |
| OpenAI 모드 동작 | Gemini가 원문 인식(OCR) → OpenAI가 번역 (키 2개 필요) | **OpenAI가 격자 이미지를 직접 읽어 인식·번역 한 번에** (OpenAI 키만) |
| Gemini | 필수 (OCR 담당) | **보조 옵션** — 같은 일을 Gemini가 처리 (Gemini 키만) |
| 요청 수 / 페이지 | 2회 (Gemini + OpenAI) | **1회** |
| 프롬프트 | 엔진마다 다른 문구, OCR 단계에는 단어장·맥락 없음 | **엔진 무관 공통** (번역 지침 + 단어장 + 앞 페이지 맥락) |
| 플라스크 토글 | 임시 실험용 | 제거 |

### 변경 내용
| 변경 | 파일 |
|---|---|
| 번역 지침·읽기 규칙·단어장·맥락·작품 노트 프롬프트를 한곳에서 생성. 두 엔진이 같은 모듈을 씀 | `lib/translationPrompt.ts`(신규) |
| 효과음 치환·분류 태그 금지 규칙을 공통 지침으로 끌어올림 (전에는 페이지 전체 경로에만 있었음) | `lib/translationPrompt.ts` |
| OpenAI: 격자 번역(주력) · 페이지 전체 대체 경로 · 작품 노트 정리 · 문장 재번역 | `lib/openai.ts` |
| Gemini: `ocrOnly` 제거, 공통 프롬프트 사용, 보조 경로로 정리 | `lib/gemini.ts` |
| 제공자별로 자기 키만 요구 (교차 의존 제거) | `lib/translatePage.ts` |
| 작품 노트도 고른 엔진으로 정리 → **Gemini 키 없이도 말투 맥락 기능이 동작** | `App.tsx`, `lib/openai.ts` |
| 엔진·모델 선택을 기억 (새로고침·재방문에도 유지) | `App.tsx` |
| 헤더: OpenAI를 앞(주력)·Gemini를 뒤(보조)로 배치, Terra를 첫 옵션으로, 키 입력란에 엔진 이름 표시, 플라스크 버튼 삭제 | `components/AppHeader.tsx` |
| API 키에 한글·개행이 섞였을 때 브라우저 원본 오류(`non ISO-8859-1 code point`) 대신 한국어 안내. 키 입력은 자동 trim | `lib/retry.ts`, `lib/openai.ts`, `lib/gemini.ts`, `App.tsx` |

### 새 저장 키
- `manga-translator-provider` / `manga-translator-gemini-version` / `manga-translator-openai-version` — 고른 엔진·모델 기억
- 제거: `manga-translator-openai-vision-only` (실험 토글). 남아 있어도 무해

### 되돌리기
- 이 패치 직전 상태: `git revert <이 커밋>` 또는 `git checkout 00c4036 -- src docs`
- Gemini를 다시 주력으로 되돌리려면 `App.tsx`의 provider 기본값을 `'google'`로 바꾸고 헤더 순서만 되돌리면 됨 (두 엔진 경로는 독립적이라 서로 영향 없음)

### 검증
- `tsc -b` 통과, `vitest` **103개** 통과, `oxlint` 경고 12개(이전과 동일), `vite build` 통과
- 단위 테스트로 확인: 두 엔진 프롬프트에 단어장·맥락·번역 지침이 모두 실림 / Gemini는 응답에 번역문까지 요구 / OpenAI 격자 요청은 이미지 1장·요청 1회 / 페이지 전체 대체 경로는 좌표를 받아 일본 만화 읽는 순서로 정렬 / 작품 노트는 대사가 없으면 호출하지 않음 / 재번역은 원문에 등장하는 단어장만 실음
- 브라우저(가짜 API 목): 기본값이 **OpenAI Terra**, 헤더 순서 OpenAI→Gemini, 플라스크 없음, 키 입력란 "OpenAI Key"
  - OpenAI 키만 넣고 3장 자동 번역 → 페이지당 OpenAI 요청 1건, **Gemini 0건**, 프롬프트에 단어장(`拳王 -> 권왕`)·`이어지는 맥락`·`직전까지의 번역`·`작품 노트`·`번역 지침` 모두 포함
  - 3장 번역 시점에 **작품 노트가 OpenAI로 자동 생성**됨 (Gemini 키 없음)
  - Gemini 보조 모드로 전환 → Gemini로만 요청이 가고 OpenAI 호출 0건, 엔진 선택이 새로고침 후에도 유지
  - 한글 섞인 키로 번역 시 "OpenAI API 키에 입력할 수 없는 문자…" 안내 표시 (원본 브라우저 오류 아님)
- 참고: `@google/genai` SDK는 내부에서 fetch 참조를 따로 잡아 브라우저 목으로 가로채지지 않음 → Gemini 프롬프트 내용은 SDK를 직접 목으로 바꾼 단위 테스트로 검증
- 테스트 후 localStorage·IndexedDB 정리

### 토큰 사용량 (측정치)
1200×1700 페이지, 말풍선 6개 기준 격자 이미지 900×600 → 이미지 약 **765 토큰**(high detail) + 프롬프트·맥락 약 700~1500 토큰 = **페이지당 입력 1500~2300 토큰, 요청 1회**. 콘솔 `[tokens]` 로그와 `window.__mangaTokenUsage`로 확인 가능

---

## 이번 패치 범위 밖 (다음 후보)
- 템플릿 잔재 정리: `src/App.css`, `src/assets/*`, 템플릿 README, `test-lint.json`, `index.html`의 `lang="en"`
- 배포물에 WASM 27.8MB가 들어가지만 실제로는 CDN에서 받음 → 한쪽으로 통일, WebGPU·모델 양자화 검토
- 이미지를 dataURL 대신 Blob/ObjectURL로 보관, 문맥용 전체 페이지 이미지는 축소해 전송
- 캐시 키를 파일 이름+크기 → 파일 해시로
- 키보드 단축키, 토스트 알림, 작품별 단어장, 앞 페이지 대사를 번역 문맥으로 전달
- GitHub Actions 배포 전에 lint·test 실행
- lint 경고 10개는 대부분 의도적으로 effect 의존성을 생략한 부분
