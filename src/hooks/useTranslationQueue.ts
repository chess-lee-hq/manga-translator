import { useEffect, useRef, useState } from 'react';
import { translatePage } from '../lib/translatePage';
import { buildContextInstruction, collectRecentPairs } from '../lib/translationContext';
import type { PageError, TranslationCache, TranslationResult, TranslationSettings, UploadedImage } from '../types';
import { useDebouncedValue } from './useDebouncedValue';
import { getCacheKey } from './useTranslationCache';

const AUTO_TRANSLATE_STORAGE_KEY = 'manga-translator-auto-translate';
/** 동시에 번역을 요청하는 페이지 수 */
const TRANSLATION_CONCURRENCY = 3;
/** API 키 입력이 멈춘 뒤 이 시간이 지나야 번역을 시작 */
const API_KEY_DEBOUNCE_MS = 800;

interface Options {
  images: UploadedImage[];
  /** 번역할 페이지 순서 (보이는 페이지가 앞) */
  queue: number[];
  settings: TranslationSettings;
  translationCache: TranslationCache;
  onPageTranslated: (key: string, results: TranslationResult[]) => void;
  /** 작품 노트 (인물·말투 요약) — 번역 프롬프트에 함께 전달 */
  notes?: string;
  /** 한 장씩 순서대로 번역해 앞 페이지 내용을 최대한 반영 */
  contextFirst?: boolean;
}

export function useTranslationQueue({ images, queue, settings, translationCache, onPageTranslated, notes, contextFirst }: Options) {
  // 진행 상태는 페이지 번호가 아니라 캐시 키(파일) 기준 → 이미지 추가·재정렬 중에도 중복 호출·누락 없음
  const inFlightRef = useRef<Set<string>>(new Set());
  const [translatingKeys, setTranslatingKeys] = useState<Set<string>>(() => new Set());
  const [pageErrors, setPageErrors] = useState<Record<string, PageError>>({});
  const [autoTranslate, setAutoTranslateState] = useState(() => localStorage.getItem(AUTO_TRANSLATE_STORAGE_KEY) !== 'false');
  const [retryTrigger, setRetryTrigger] = useState(0);

  const currentKey = settings.provider === 'google' ? settings.googleKey : settings.openaiKey;
  // API 키를 한 글자씩 입력하는 도중에는 번역을 시작하지 않도록, 입력이 멈춘 뒤의 값만 사용
  const liveCredential = `${settings.provider}|${settings.googleKey}|${settings.openaiKey}`;
  const credential = useDebouncedValue(liveCredential, API_KEY_DEBOUNCE_MS);
  const isCredentialSettled = credential === liveCredential;

  const setAutoTranslate = (enabled: boolean) => {
    setAutoTranslateState(enabled);
    try {
      localStorage.setItem(AUTO_TRANSLATE_STORAGE_KEY, String(enabled));
    } catch (err) {
      console.warn('자동 번역 설정 저장 실패:', err);
    }
  };

  /**
   * 지정한 페이지들을 번역합니다. 호출 시점에 파일(캐시 키)로 고정하므로 도중에 이미지가 추가·재정렬돼도 안전합니다.
   * 동시에 TRANSLATION_CONCURRENCY장씩 처리하고, 끝난 페이지부터 바로 화면에 반영합니다.
   */
  const translatePages = async (indices: number[]) => {
    const jobs = indices
      .filter(idx => images[idx])
      .map(idx => ({ idx, img: images[idx], key: getCacheKey(images[idx].file) }))
      .filter(job => !inFlightRef.current.has(job.key));
    if (jobs.length === 0) return;

    const attemptSettings = settings;
    const attemptCredential = credential;
    jobs.forEach(job => inFlightRef.current.add(job.key));
    setTranslatingKeys(new Set(inFlightRef.current));
    setPageErrors(prev => {
      const next = { ...prev };
      jobs.forEach(job => delete next[job.key]);
      return next;
    });

    // 이번 실행에서 방금 번역한 페이지도 다음 페이지의 맥락에 포함 (화면 상태 반영 전이라 따로 모아둠)
    const runResults = new Map<string, TranslationResult[]>();
    const contextFor = (pageIndex: number) => {
      const cache = runResults.size > 0 ? { ...translationCache, ...Object.fromEntries(runResults) } : translationCache;
      return buildContextInstruction(notes, collectRecentPairs(images, cache, pageIndex));
    };

    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        try {
          const results = await translatePage(job.img, { ...attemptSettings, context: contextFor(job.idx) });
          runResults.set(job.key, results);
          onPageTranslated(job.key, results);
        } catch (err: any) {
          console.error(`Page ${job.idx + 1} 번역 실패:`, err);
          setPageErrors(prev => ({
            ...prev,
            [job.key]: { message: err?.message || '번역 중 오류가 발생했습니다.', credential: attemptCredential },
          }));
        } finally {
          inFlightRef.current.delete(job.key);
          setTranslatingKeys(new Set(inFlightRef.current));
        }
      }
    };
    const concurrency = Math.min(contextFirst ? 1 : TRANSLATION_CONCURRENCY, jobs.length);
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  };

  const retryPage = (imgIndex: number) => {
    translatePages([imgIndex]);
  };

  /** 자동 번역을 켜고 즉시 대기열을 다시 확인합니다. */
  const resumeAutoTranslate = () => {
    setAutoTranslate(true);
    setRetryTrigger(r => r + 1);
  };

  const clearPageErrors = () => setPageErrors({});

  useEffect(() => {
    if (!autoTranslate || !isCredentialSettled || !currentKey || images.length === 0 || queue.length === 0) return;

    const missingIndices = queue.filter(i => {
      const key = getCacheKey(images[i].file);
      const failure = pageErrors[key];
      // 같은 키로 이미 실패한 페이지는 자동으로 다시 부르지 않음 (반복 실패·과금 방지). 키를 바꾸거나 '다시 시도'로 재요청
      return !translationCache[key] && !inFlightRef.current.has(key) && !(failure && failure.credential === credential);
    });

    if (missingIndices.length > 0) translatePages(missingIndices);
  }, [queue.join(','), images, credential, isCredentialSettled, autoTranslate, retryTrigger]);

  return {
    translatingKeys,
    pageErrors,
    autoTranslate,
    setAutoTranslate,
    translatePages,
    retryPage,
    resumeAutoTranslate,
    clearPageErrors,
    hasApiKey: !!currentKey,
  };
}
