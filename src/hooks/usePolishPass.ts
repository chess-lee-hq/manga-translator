import { useState } from 'react';
import { runPolishPass, type PolishProposal, type PolishSource } from '../lib/polish';
import type { TranslationSettings } from '../types';

export interface PolishState {
  status: 'idle' | 'running' | 'done' | 'error';
  done: number;
  total: number;
  proposals: PolishProposal[];
  failedChunks: number;
  error?: string;
  /** 마지막으로 다듬은 쪽 범위 (1부터) */
  range?: [number, number];
}

const IDLE: PolishState = { status: 'idle', done: 0, total: 0, proposals: [], failedChunks: 0 };

/**
 * 다듬기 패스의 진행 상태와 제안 목록. 검수 창을 닫아도 제안이 남도록 App에 둠.
 * 작품이 바뀌면 다른 작품의 제안이 남지 않게 비움 (진행 중이던 결과도 버림)
 */
export function usePolishPass(workKey: string) {
  const [state, setState] = useState<PolishState & { workKey: string }>({ ...IDLE, workKey });
  if (state.workKey !== workKey) setState({ ...IDLE, workKey });

  const start = async (sources: PolishSource[], settings: TranslationSettings, range: [number, number]) => {
    if (state.status === 'running') return;
    const startedFor = workKey;
    const update = (patch: (prev: PolishState) => Partial<PolishState>) =>
      setState(prev => (prev.workKey === startedFor ? { ...prev, ...patch(prev) } : prev));
    setState({ ...IDLE, workKey, status: 'running', range });
    try {
      const { proposals, failedChunks } = await runPolishPass(sources, settings, (done, total) => update(() => ({ done, total })));
      update(() => ({ status: 'done', proposals, failedChunks }));
    } catch (error) {
      update(() => ({ status: 'error', error: (error as Error)?.message ?? String(error) }));
    }
  };

  /** 적용했거나 버린 제안을 목록에서 뺌 */
  const removeProposals = (ids: string[]) => {
    const drop = new Set(ids);
    setState(prev => ({ ...prev, proposals: prev.proposals.filter(p => !drop.has(p.id)) }));
  };

  return { polish: state as PolishState, startPolish: start, removeProposals };
}
