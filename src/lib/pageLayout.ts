import type { ViewMode } from '../types';

interface PageShape {
  isSpread: boolean;
}

/** 2장 모드: 가로로 긴 펼침면은 혼자, 아니면 현재 장과 다음 장(다음 장도 펼침면이 아닐 때)을 함께 보여줍니다. */
export function getVisibleIndices(pages: PageShape[], currentPageIndex: number, viewMode: ViewMode): number[] {
  if (currentPageIndex < 0 || currentPageIndex >= pages.length) return [];
  if (viewMode === '1page' || pages[currentPageIndex].isSpread) return [currentPageIndex];
  const next = currentPageIndex + 1;
  return next < pages.length && !pages[next].isSpread ? [currentPageIndex, next] : [currentPageIndex];
}

/** 특정 페이지가 속한 2장 묶음의 시작 페이지를 찾습니다. (페이지 번호로 이동하거나 이전 페이지로 갈 때 사용) */
export function getSpreadStartIndex(pages: PageShape[], targetIndex: number, viewMode: ViewMode): number {
  if (viewMode === '1page') return targetIndex;
  let i = 0;
  let lastStart = 0;
  while (i <= targetIndex && i < pages.length) {
    lastStart = i;
    if (pages[i].isSpread) {
      if (i === targetIndex) break;
      i += 1;
    } else if (i + 1 < pages.length && !pages[i + 1].isSpread) {
      if (i === targetIndex || i + 1 === targetIndex) break;
      i += 2;
    } else {
      if (i === targetIndex) break;
      i += 1;
    }
  }
  return lastStart;
}

/** 보이는 페이지를 먼저, 그 뒤로 preloadCount장을 미리 번역할 순서 */
export function buildTranslationQueue(visibleIndices: number[], totalPages: number, preloadCount: number): number[] {
  if (visibleIndices.length === 0) return [];
  const last = visibleIndices[visibleIndices.length - 1];
  const queue = [...visibleIndices];
  for (let i = 1; i <= preloadCount && last + i < totalPages; i++) queue.push(last + i);
  return queue;
}
