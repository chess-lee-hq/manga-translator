import { useState } from 'react';
import type { Glossary } from '../types';

const STORAGE_KEY = 'manga-glossary-current';

function persist(glossary: Glossary) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(glossary));
  } catch (err) {
    console.warn('단어장 저장 실패:', err);
  }
}

export function useGlossary() {
  const [glossary, setGlossary] = useState<Glossary>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  /** 항목을 현재 단어장에 합칩니다. 같은 원문은 새 값으로 바뀌고 나머지 기존 항목은 유지됩니다. */
  const mergeGlossary = (entries: Glossary) => {
    setGlossary(prev => {
      const next = { ...prev, ...entries };
      persist(next);
      return next;
    });
  };

  const removeGlossaryEntry = (original: string) => {
    setGlossary(prev => {
      const next = { ...prev };
      delete next[original];
      persist(next);
      return next;
    });
  };

  return { glossary, mergeGlossary, removeGlossaryEntry };
}
