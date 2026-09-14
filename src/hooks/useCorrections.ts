import { useState } from 'react';
import { applyCorrection, loadCorrections, mergeCorrections, saveCorrections, type Correction } from '../lib/corrections';

/**
 * 작품별 "내가 고친 번역" 기록.
 * 작품이 바뀌면 같은 렌더에서 바로 그 작품의 기록을 읽습니다. (useWorkNotes와 같은 방식)
 */
export function useCorrections(workName: string) {
  const [state, setState] = useState(() => ({ workName, list: loadCorrections(workName) }));
  if (state.workName !== workName) {
    setState({ workName, list: loadCorrections(workName) });
  }
  const corrections = state.workName === workName ? state.list : loadCorrections(workName);

  const update = (next: Correction[]) => {
    if (next === corrections) return;
    saveCorrections(workName, next);
    setState({ workName, list: next });
  };

  return {
    corrections,
    /** 대본에서 번역을 고쳤을 때 호출 */
    recordCorrection: (original: string, before: string, after: string) => update(applyCorrection(corrections, original, before, after)),
    removeCorrection: (original: string) => update(corrections.filter(c => c.original !== original)),
    clearCorrections: () => update([]),
    /** 백업에서 불러온 기록을 합침 */
    mergeImported: (incoming: Correction[]) => update(mergeCorrections(corrections, incoming)),
  };
}
