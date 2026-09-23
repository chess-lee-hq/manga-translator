/** 작품별 "작품 노트"(인물·말투·호칭 요약) 저장소. 번역 기록과 마찬가지로 localStorage에 둡니다. */
export const NOTES_PREFIX = 'manga-notes-';

export interface WorkNotes {
  text: string;
  /** 이 노트를 만들 때 번역되어 있던 페이지 수 (다음 갱신 시점 판단용) */
  pageCount: number;
  updatedAt: string;
  /**
   * 이 노트에 이미 반영된 페이지(번역 기록 키). 자동 갱신 때는 여기 없는 페이지의 대사만 보내
   * 같은 대사를 10장마다 되풀이해 보내지 않습니다. (예전 노트에는 없음 → 한 번은 최근 대사로 전체 정리)
   */
  coveredPages?: string[];
}

const workNotesKey = (workName: string) => `${NOTES_PREFIX}${workName || 'default'}`;

export function loadWorkNotes(workName: string): WorkNotes | null {
  try {
    const saved = localStorage.getItem(workNotesKey(workName));
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (typeof parsed?.text !== 'string') return null;
    return {
      text: parsed.text,
      pageCount: typeof parsed.pageCount === 'number' ? parsed.pageCount : 0,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      ...(Array.isArray(parsed.coveredPages) ? { coveredPages: parsed.coveredPages.filter((k: unknown) => typeof k === 'string') } : {}),
    };
  } catch {
    return null;
  }
}

export function saveWorkNotes(workName: string, notes: WorkNotes) {
  try {
    localStorage.setItem(workNotesKey(workName), JSON.stringify(notes));
  } catch (err) {
    console.warn('작품 노트 저장 실패:', err);
  }
}
