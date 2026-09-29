import { useEffect, useRef, useState } from 'react';
import { loadImage } from '../lib/imageUtils';
import { recognizeBoxes } from '../lib/mangaOcr';
import { isOcrMismatch, OCR_MISMATCH_REVIEW } from '../lib/mangaOcrText';
import type { TranslationCache, TranslationResult, UploadedImage } from '../types';
import { getCacheKey } from './useTranslationCache';

type UpdatePageResults = (key: string, updater: (results: TranslationResult[]) => TranslationResult[] | null) => void;

interface Options {
  enabled: boolean;
  images: UploadedImage[];
  translationCache: TranslationCache;
  /** 확인할 순서 (보이는 페이지가 앞, 그다음 미리 번역하는 페이지) */
  order: number[];
  updatePageResults: UpdatePageResults;
}

/** 아직 번역이 들어오지 않은 임시 말풍선은 건너뜀 */
const isPending = (result: TranslationResult) => result.translated_text === '번역 중...' || result.original_text === '...';
const needsCheck = (result: TranslationResult) => result.ocr_text === undefined && !isPending(result);

/**
 * 로컬 OCR 교차 검증 (API 비용 없음).
 * 번역이 끝난 페이지의 말풍선을 브라우저 안의 manga-ocr로 한 번 더 읽어, LLM이 읽은 원문과 절반 넘게 다르면 "검토" 표시를 붙입니다.
 * 번역을 기다리게 하지 않도록 번역이 끝난 뒤 뒤에서 한 페이지씩 처리합니다. (말풍선 하나에 1초 남짓)
 * 읽은 글자는 결과에 ocr_text로 남아, 다시 열어도 다시 읽지 않습니다.
 */
export function useOcrCrossCheck({ enabled, images, translationCache, order, updatePageResults }: Options) {
  const busyRef = useRef(false);
  /** 실패한 페이지는 이번 세션에서 다시 시도하지 않음 (계속 실패하며 CPU를 쓰지 않게) */
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  /** 한 페이지를 끝낼 때마다 올려 다음 페이지를 찾게 함 */
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || busyRef.current) return;
    const nextIndex = order.find(i => {
      const img = images[i];
      if (!img) return false;
      const key = getCacheKey(img.file);
      return !failed.has(key) && (translationCache[key] ?? []).some(needsCheck);
    });
    if (nextIndex === undefined) return;

    const img = images[nextIndex];
    const key = getCacheKey(img.file);
    const targets = (translationCache[key] ?? []).filter(needsCheck);
    busyRef.current = true;
    (async () => {
      try {
        const image = await loadImage(img.src);
        const texts = await recognizeBoxes(image, targets.map(r => r.box_2d));
        const byId = new Map(targets.map((r, i) => [r.id, texts[i] ?? '']));
        let flagged = 0;
        updatePageResults(key, results => results.map(r => {
          if (!byId.has(r.id)) return r;
          const ocrText = byId.get(r.id)!;
          // 이미 다른 검토 표시가 있으면 그대로 두고, 읽은 글자만 남김
          const mismatch = !r.review && isOcrMismatch(r.original_text, ocrText);
          if (mismatch) flagged++;
          return { ...r, ocr_text: ocrText, ...(mismatch ? { review: OCR_MISMATCH_REVIEW } : {}) };
        }));
        console.info(`[ocr] ${nextIndex + 1}쪽 말풍선 ${targets.length}개 교차 검증 — 원문 불일치 ${flagged}개`);
      } catch (error) {
        setFailed(prev => new Set(prev).add(key));
        console.warn(`[ocr] ${nextIndex + 1}쪽 교차 검증 실패:`, (error as Error)?.message ?? error);
      } finally {
        busyRef.current = false;
        setTick(t => t + 1);
      }
    })();
  }, [enabled, images, translationCache, order, updatePageResults, failed, tick]);
}
