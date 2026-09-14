import { useState } from 'react';
import { loadCandidates, mergeCandidates, saveCandidates, type GlossaryCandidate } from '../lib/glossaryCandidates';

/** 작품별 단어장 후보(추천 용어)와 사용자가 무시한 원문 목록 */
export function useGlossaryCandidates(workName: string) {
  const [state, setState] = useState(() => ({ workName, data: loadCandidates(workName) }));
  if (state.workName !== workName) {
    setState({ workName, data: loadCandidates(workName) });
  }
  const data = state.workName === workName ? state.data : loadCandidates(workName);

  const update = (next: typeof data) => {
    saveCandidates(workName, next);
    setState({ workName, data: next });
  };

  return {
    candidates: data.candidates,
    dismissed: data.dismissed,
    /** 새로 뽑은 후보(이미 걸러진 것)를 대기 목록에 합침 */
    addCandidates: (incoming: GlossaryCandidate[], glossary: Record<string, string>) =>
      update({ ...data, candidates: mergeCandidates(data.candidates, incoming, glossary, data.dismissed) }),
    /** 단어장에 추가했거나 이미 있는 후보를 목록에서 뺌 */
    removeCandidate: (original: string) => update({ ...data, candidates: data.candidates.filter(c => c.original !== original) }),
    /** 다시 추천하지 않도록 무시 */
    dismissCandidate: (original: string) => update({
      candidates: data.candidates.filter(c => c.original !== original),
      dismissed: [...new Set([...data.dismissed, original])],
    }),
  };
}
