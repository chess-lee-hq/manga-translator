import { useEffect, useRef, useState } from 'react';
import { translatePage, translatePageBatch } from '../lib/translatePage';
import { buildContextInstruction, collectRecentPairs } from '../lib/translationContext';
import type { Correction } from '../lib/corrections';
import type { PageError, TranslationCache, TranslationResult, TranslationSettings, UploadedImage } from '../types';
import { useDebouncedValue } from './useDebouncedValue';
import { getCacheKey } from './useTranslationCache';

const AUTO_TRANSLATE_STORAGE_KEY = 'manga-translator-auto-translate';
/** 동시에 보내는 요청 수 */
const TRANSLATION_CONCURRENCY = 3;
/**
 * 미리 번역해 두는 페이지는 이만큼씩 묶어 요청 한 번으로 처리합니다.
 * 프롬프트·단어장·맥락이 요청당 한 번만 들어가므로 페이지당 토큰이 크게 줄어듭니다.
 * 지금 보고 있는 페이지는 묶지 않고 한 장씩 바로 요청해 기다리는 시간을 늘리지 않습니다.
 */
const PRELOAD_BATCH_SIZE = 3;
/** API 키 입력이 멈춘 뒤 이 시간이 지나야 번역을 시작 */
const API_KEY_DEBOUNCE_MS = 800;

interface Options {
  images: UploadedImage[];
  /** 번역할 페이지 순서 (보이는 페이지가 앞) */
  queue: number[];
  /** 지금 화면에 보이는 페이지 (이 페이지들은 묶지 않고 먼저 번역) */
  visibleIndices: number[];
  settings: TranslationSettings;
  translationCache: TranslationCache;
  onPageTranslated: (key: string, results: TranslationResult[]) => void;
  /** 작품 노트 (인물·말투 요약) — 번역 프롬프트에 함께 전달 */
  notes?: string;
  /** 사용자가 직접 고친 번역 — 번역 프롬프트에 교정 예시로 전달 */
  corrections?: Correction[];
}

export function useTranslationQueue({ images, queue, visibleIndices, settings, translationCache, onPageTranslated, notes, corrections }: Options) {
  // 진행 상태는 페이지 번호가 아니라 캐시 키(파일) 기준 → 이미지 추가·재정렬 중에도 중복 호출·누락 없음
  const inFlightRef = useRef<Set<string>>(new Set());
  const [translatingKeys, setTranslatingKeys] = useState<Set<string>>(() => new Set());
  const [pageErrors, setPageErrors] = useState<Record<string, PageError>>({});
  const [autoTranslate, setAutoTranslateState] = useState(() => localStorage.getItem(AUTO_TRANSLATE_STORAGE_KEY) !== 'false');
  const [retryTrigger, setRetryTrigger] = useState(0);

  const currentKey = settings.openaiKey;
  // API 키를 한 글자씩 입력하는 도중에는 번역을 시작하지 않도록, 입력이 멈춘 뒤의 값만 사용
  // (Gemini 키는 재요청에만 쓰는 선택 사항이라 번역 시작 조건에 넣지 않음)
  const liveCredential = settings.openaiKey;
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
  const translatePages = async (indices: number[], batchSize = 1) => {
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
      return buildContextInstruction(notes, collectRecentPairs(images, cache, pageIndex), corrections);
    };

    const finish = (job: typeof jobs[number], results: TranslationResult[]) => {
      runResults.set(job.key, results);
      onPageTranslated(job.key, results);
    };
    const fail = (job: typeof jobs[number], err: any) => {
      console.error(`Page ${job.idx + 1} 번역 실패:`, err);
      setPageErrors(prev => ({
        ...prev,
        [job.key]: { message: err?.message || '번역 중 오류가 발생했습니다.', credential: attemptCredential },
      }));
    };
    const release = (group: typeof jobs) => {
      group.forEach(job => inFlightRef.current.delete(job.key));
      setTranslatingKeys(new Set(inFlightRef.current));
    };

    const translateOne = async (job: typeof jobs[number]) => {
      try {
        finish(job, await translatePage(job.img, { ...attemptSettings, context: contextFor(job.idx) }));
      } catch (err) {
        fail(job, err);
      }
    };

    /** 묶음 요청이 실패하면 그 묶음만 한 장씩 다시 시도해, 한 번의 오류로 여러 장을 잃지 않게 합니다. */
    const translateGroup = async (group: typeof jobs) => {
      try {
        const byPage = await translatePageBatch(group.map(job => ({ id: job.key, img: job.img })), {
          ...attemptSettings,
          context: contextFor(group[0].idx),
        });
        group.forEach(job => finish(job, byPage.get(job.key) ?? []));
      } catch (err) {
        console.warn(`${group.length}장 묶음 번역 실패 → 한 장씩 다시 시도합니다:`, (err as Error)?.message ?? err);
        for (const job of group) await translateOne(job);
      }
    };

    // 묶음은 OpenAI 전용. Gemini 보조 모드에서는 한 장씩
    const canBatch = batchSize > 1;
    const groups: (typeof jobs)[] = [];
    for (let i = 0; i < jobs.length; i += canBatch ? batchSize : 1) {
      groups.push(jobs.slice(i, i + (canBatch ? batchSize : 1)));
    }

    let cursor = 0;
    const worker = async () => {
      while (cursor < groups.length) {
        const group = groups[cursor++];
        try {
          if (group.length === 1) await translateOne(group[0]);
          else await translateGroup(group);
        } finally {
          release(group);
        }
      }
    };
    const concurrency = Math.min(TRANSLATION_CONCURRENCY, groups.length);
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

    if (missingIndices.length === 0) return;

    // 보고 있는 페이지를 먼저 한 장씩(빠른 응답) → 그 뒤 미리 받아둘 페이지를 묶음으로(토큰 절약)
    const visible = new Set(visibleIndices);
    const immediate = missingIndices.filter(i => visible.has(i));
    const preload = missingIndices.filter(i => !visible.has(i));
    (async () => {
      if (immediate.length > 0) await translatePages(immediate);
      if (preload.length > 0) await translatePages(preload, PRELOAD_BATCH_SIZE);
    })();
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
