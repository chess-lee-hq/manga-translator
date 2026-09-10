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
