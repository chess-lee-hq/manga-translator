import { useState } from 'react';
import { Check, Loader2, Sparkles, Trash2 } from 'lucide-react';
import type { PolishState } from '../hooks/usePolishPass';
import { countPolishLines, type PolishProposal, type PolishSource } from '../lib/polish';

interface PolishPanelProps {
  pages: PolishSource[];
  polish: PolishState;
  mainEngineLabel: string;
  onStart: (range: [number, number]) => void;
  onApply: (proposals: PolishProposal[]) => void;
  onDiscard: (ids: string[]) => void;
  onJump: (imgIndex: number) => void;
}

/**
 * 다듬기 탭: 번역이 끝난 페이지들의 대사를 텍스트만 모아 한 번 더 감수받고,
 * 말투·호칭·표기가 흔들린 줄의 수정 제안을 골라 적용합니다.
 */
export function PolishPanel({ pages, polish, mainEngineLabel, onStart, onApply, onDiscard, onJump }: PolishPanelProps) {
  const firstPage = pages.length > 0 ? pages[0].imgIndex + 1 : 1;
  const lastPage = pages.length > 0 ? pages[pages.length - 1].imgIndex + 1 : 1;
  const [from, setFrom] = useState(polish.range?.[0] ?? firstPage);
  const [to, setTo] = useState(polish.range?.[1] ?? lastPage);
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set());

  const inRange = pages.filter(page => page.imgIndex + 1 >= from && page.imgIndex + 1 <= to);
  const lineCount = countPolishLines(inRange);
  const running = polish.status === 'running';
  const selected = polish.proposals.filter(p => !unchecked.has(p.id));

  const toggle = (id: string) => setUnchecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const pageInput = (value: number, onChange: (next: number) => void) => (
    <input
      type="number"
      min={firstPage}
      max={lastPage}
      value={value}
      disabled={running}
      onChange={e => onChange(Math.min(lastPage, Math.max(firstPage, Number(e.target.value) || firstPage)))}
      className="w-16 px-1.5 py-0.5 border border-gray-200 rounded text-right text-xs"
    />
  );

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        페이지를 한 장씩 번역하면 말투·호칭·표기가 페이지마다 조금씩 흔들릴 수 있습니다.
        번역이 끝난 대사를 <b>텍스트만</b> 모아 {mainEngineLabel}에 한 번 더 감수받습니다. 이미지를 보내지 않아 비용이 적고, 제안은 골라서 적용합니다.
      </p>

      {pages.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">번역된 페이지가 없습니다.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-gray-200 bg-gray-50 mb-3 text-xs text-gray-700">
          {pageInput(from, next => { setFrom(next); if (next > to) setTo(next); })} 쪽부터
          {pageInput(to, next => { setTo(next); if (next < from) setFrom(next); })} 쪽까지
          <span className="text-gray-400">· 대사 {lineCount}줄</span>
          <button
            onClick={() => { setUnchecked(new Set()); onStart([from, to]); }}
            disabled={running || lineCount === 0}
            className="ml-auto flex items-center gap-1 px-3 py-1 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {running ? `다듬는 중 ${polish.done}/${polish.total}` : '다듬기 실행'}
          </button>
        </div>
      )}

      {polish.status === 'error' && <p className="text-sm text-red-600 mb-3">다듬기 실패: {polish.error}</p>}
      {polish.status === 'done' && polish.failedChunks > 0 && (
        <p className="text-xs text-amber-700 mb-3">{polish.failedChunks}묶음은 요청이 실패해 건너뛰었습니다. 다시 실행하면 그 부분도 다듬습니다.</p>
      )}
      {polish.status === 'done' && polish.proposals.length === 0 && (
        <p className="text-sm text-gray-500 py-6 text-center">{polish.range?.[0]}~{polish.range?.[1]}쪽은 고칠 곳이 없다는 결과입니다.</p>
      )}

      {polish.proposals.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-600">수정 제안 {polish.proposals.length}개 · 선택 {selected.length}개</p>
            <div className="flex gap-1">
              <button
                onClick={() => onDiscard(polish.proposals.map(p => p.id))}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-gray-200 text-gray-600 hover:bg-gray-100"
              >
                <Trash2 size={12} /> 모두 버리기
              </button>
              <button
                onClick={() => onApply(selected)}
                disabled={selected.length === 0}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-green-200 text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-50"
              >
                <Check size={12} /> 선택한 {selected.length}개 적용
              </button>
            </div>
          </div>
          <ul className="divide-y divide-gray-100 border rounded-lg">
            {polish.proposals.map(proposal => (
              <li key={proposal.id} className="flex items-start gap-2 px-3 py-2">
                <input type="checkbox" checked={!unchecked.has(proposal.id)} onChange={() => toggle(proposal.id)} className="mt-1" />
                <button onClick={() => onJump(proposal.imgIndex)} className="shrink-0 w-10 text-left text-xs text-gray-400 hover:text-gray-700 pt-0.5" title="이 페이지로 이동">
                  {proposal.imgIndex + 1}쪽
                </button>
                <div className="flex-1 min-w-0 text-xs">
                  <p className="text-gray-400 line-through break-keep">{proposal.before}</p>
                  <p className="text-gray-900 font-medium break-keep">{proposal.after}</p>
                  <p className="text-[11px] text-gray-400 font-serif">{proposal.original}</p>
                </div>
                {proposal.why && <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-100">{proposal.why}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
