import { useEffect, useState } from 'react';
import { detectPageBubbleShapes, type BubbleDetection } from '../lib/bubbleShape';
import { loadImage } from '../lib/imageUtils';
import type { TranslationResult } from '../types';

/** 페이지 이미지 → (그 페이지 박스 배치 → 말풍선 모양). 박스가 바뀌면 그 페이지만 다시 계산 */
const cache = new Map<string, { signature: string; boxes: Record<string, string>; shapes: Record<string, BubbleDetection> }>();
const MAX_CACHED_PAGES = 40;

const boxKey = (result: TranslationResult) => result.box_2d.map(Math.round).join(',');
const signatureOf = (results: TranslationResult[]) => results.map(r => `${r.id}:${boxKey(r)}`).join('|');

/**
 * 보이는 페이지들의 원본 말풍선 모양을 찾아 둡니다. (페이지 이미지 픽셀을 읽는 작업이라 화면 표시 뒤 비동기로 계산)
 * 아직 계산 중이면 undefined, 계산했으면 { shape } 또는 { shape: null, failure: 못 찾은 이유 }를 돌려줍니다.
 * isReady(src, result): 그 칸의 계산이 끝났는지 (계산 전에는 임시 배치가 잠깐 보였다 바뀌며 깜빡였으므로 그리지 않는 데 씀)
 * @param pages 보이는 페이지 먼저, 그다음 미리 계산해 둘 앞뒤 페이지 (넘길 때 바로 그려지도록)
 */
export function useBubbleShapes(pages: { src: string; results: TranslationResult[] }[], enabled: boolean) {
  const [, setVersion] = useState(0);

  const pending = enabled
    ? pages.filter(page => page.results.length > 0 && cache.get(page.src)?.signature !== signatureOf(page.results))
    : [];
  const pendingKey = pending.map(page => `${page.src}:${signatureOf(page.results)}`).join('#');

  useEffect(() => {
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const page of pending) {
        const image = await loadImage(page.src).catch(() => null);
        if (cancelled) return;
        const signature = signatureOf(page.results);
        let shapes: Record<string, BubbleDetection> = {};
        try {
          shapes = image ? detectPageBubbleShapes(image, page.results) : {};
        } catch (error) {
          console.warn('말풍선 모양 찾기 실패 — 둥근 사각형으로 표시합니다:', error);
        }
        cache.delete(page.src);
        cache.set(page.src, { signature, boxes: Object.fromEntries(page.results.map(r => [r.id, boxKey(r)])), shapes });
        if (cache.size > MAX_CACHED_PAGES) cache.delete(cache.keys().next().value!);
        const found = Object.values(shapes).filter(d => d.shape).length;
        console.debug(`[bubble] 말풍선 모양 ${found}/${page.results.length}개 찾음`);
        // 페이지마다 바로 반영하고 다음 페이지 전에 화면이 그려질 틈을 줌
        setVersion(v => v + 1);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    })();
    return () => {
      cancelled = true;
    };
    // pending은 매 렌더 새 배열이라, 실제 계산 대상이 바뀌었을 때(pendingKey)만 다시 실행
  }, [pendingKey]);

  const isReady = (src: string, result: TranslationResult) => cache.get(src)?.boxes[result.id] === boxKey(result);
  const detectionOf = (src: string, result: TranslationResult): BubbleDetection | undefined => {
    // 박스를 옮긴 직후에는 옛 자리의 모양을 쓰지 않도록 박스가 같을 때만 돌려줌
    if (!isReady(src, result)) return undefined;
    return cache.get(src)!.shapes[result.id];
  };
  return Object.assign(detectionOf, { isReady });
}
