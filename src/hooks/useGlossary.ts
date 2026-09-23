import { useState } from 'react';
import { loadGlossary, saveGlossary } from '../lib/glossaryStore';
import type { Glossary } from '../types';

/**
 * 작품별 단어장. 작품이 바뀌면 같은 렌더에서 바로 그 작품의 단어장을 읽습니다. (useWorkNotes와 같은 방식)
 * 추천 용어 "모두 추가"처럼 한 번에 여러 번 합칠 때 앞의 것이 덮이지 않도록 이전 상태를 기준으로 갱신합니다.
 */
export function useGlossary(workKey: string) {
  const [state, setState] = useState(() => ({ workKey, glossary: loadGlossary(workKey) }));
  if (state.workKey !== workKey) {
    setState({ workKey, glossary: loadGlossary(workKey) });
  }
  const glossary = state.workKey === workKey ? state.glossary : loadGlossary(workKey);

  const update = (change: (current: Glossary) => Glossary) => {
    setState(prev => {
      const current = prev.workKey === workKey ? prev.glossary : loadGlossary(workKey);
      const next = change(current);
      saveGlossary(workKey, next);
      return { workKey, glossary: next };
    });
  };

  /** 항목을 이 작품의 단어장에 합칩니다. 같은 원문은 새 값으로 바뀌고 나머지 기존 항목은 유지됩니다. */
  const mergeGlossary = (entries: Glossary) => update(current => ({ ...current, ...entries }));

  const removeGlossaryEntry = (original: string) => update(current => {
    const next = { ...current };
    delete next[original];
    return next;
  });

  return { glossary, mergeGlossary, removeGlossaryEntry };
}
