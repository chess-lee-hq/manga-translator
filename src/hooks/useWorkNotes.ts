import { useState } from 'react';
import { loadWorkNotes, saveWorkNotes, type WorkNotes } from '../lib/workNotes';

/**
 * 작품별 "작품 노트"(인물·말투·호칭 요약)를 읽고 저장합니다.
 * 작품이 바뀌면 같은 렌더에서 바로 그 작품의 노트를 읽습니다.
 * (한 렌더 늦게 반영되면 노트가 없는 것으로 보여 자동 갱신이 불필요하게 돌아감)
 */
export function useWorkNotes(workName: string) {
  const [state, setState] = useState(() => ({ workName, notes: loadWorkNotes(workName) }));

  if (state.workName !== workName) {
    setState({ workName, notes: loadWorkNotes(workName) });
  }
  const notes = state.workName === workName ? state.notes : loadWorkNotes(workName);

  const saveNotes = (text: string, pageCount?: number) => {
    const next: WorkNotes = {
      text,
      pageCount: pageCount ?? notes?.pageCount ?? 0,
      updatedAt: new Date().toISOString(),
    };
    saveWorkNotes(workName, next);
    setState({ workName, notes: next });
  };

  return { notes, saveNotes };
}
