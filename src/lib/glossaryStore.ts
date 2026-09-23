import type { Glossary } from '../types';

/**
 * 작품별 단어장 저장소.
 *
 * 단어장은 번역 프롬프트에 "원문에 이 단어가 있으면 반드시 이렇게 번역해"라는 **강제 규칙**으로 들어갑니다.
 * 모든 작품이 한 단어장을 같이 쓰면, 한 작품에서 인물 이름으로 등록한 단어(예: 進 → 신)가
 * 다른 작품에서 평범한 뜻으로 쓰일 때도 강제로 바뀌어 버립니다. 그래서 작품(workIdentity의 key)별로 나눕니다.
 */
const PREFIX = 'manga-work-glossary-';

/** 작품별로 나누기 전, 모든 작품이 함께 쓰던 단어장 (가져오기용으로만 남겨 둠) */
export const LEGACY_GLOSSARY_KEY = 'manga-glossary-current';

const glossaryKey = (workKey: string) => `${PREFIX}${workKey || 'default'}`;

function parseGlossary(raw: string | null): Glossary {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[0].trim() && !!entry[1].trim()),
    );
  } catch {
    return {};
  }
}

export function loadGlossary(workKey: string): Glossary {
  try {
    return parseGlossary(localStorage.getItem(glossaryKey(workKey)));
  } catch {
    return {};
  }
}

/** 이 작품의 단어장이 한 번이라도 만들어졌는지 (비어 있어도 "사용자가 비운 것"이므로 있음으로 봄) */
export function hasStoredGlossary(workKey: string): boolean {
  try {
    return localStorage.getItem(glossaryKey(workKey)) !== null;
  } catch {
    return false;
  }
}

/** 비어 있어도 저장합니다. (다 지운 단어장에 예전 단어장이 다시 옮겨 오지 않도록) */
export function saveGlossary(workKey: string, glossary: Glossary) {
  try {
    localStorage.setItem(glossaryKey(workKey), JSON.stringify(glossary));
  } catch (err) {
    console.warn('단어장 저장 실패:', err);
  }
}

/** 지금 열려 있지 않은 작품의 단어장에 항목을 합칩니다. (백업 복원 등) */
export function mergeIntoStoredGlossary(workKey: string, entries: Glossary) {
  saveGlossary(workKey, { ...loadGlossary(workKey), ...entries });
}

export function loadLegacyGlossary(): Glossary {
  try {
    return parseGlossary(localStorage.getItem(LEGACY_GLOSSARY_KEY));
  } catch {
    return {};
  }
}

export function clearLegacyGlossary() {
  try {
    localStorage.removeItem(LEGACY_GLOSSARY_KEY);
  } catch {
    // 저장소를 못 쓰는 환경이면 지울 것도 없음
  }
}
