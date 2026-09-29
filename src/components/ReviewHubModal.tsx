import { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Check, ClipboardCheck, EyeOff, RefreshCw, X } from 'lucide-react';
import {
  findGlossaryMisses, findInconsistentLines, loadIgnoredOriginals, saveIgnoredOriginals,
  type ConsistencyPage, type LineRef,
} from '../lib/consistency';
import type { PolishState } from '../hooks/usePolishPass';
import type { PolishProposal } from '../lib/polish';
import { PolishPanel } from './PolishPanel';

export interface ReviewItem {
  /** 0부터 시작하는 페이지 번호 */
  imgIndex: number;
  key: string;
  id: string;
  review: string;
  originalText: string;
  translatedText: string;
}

export interface TranslationChange {
  key: string;
  id: string;
  translated: string;
}

export type ReviewTab = 'review' | 'consistency' | 'polish';

interface ReviewHubModalProps {
  initialTab?: ReviewTab;
  reviewItems: ReviewItem[];
  pages: ConsistencyPage[];
  glossary: Record<string, string>;
  workKey: string;
  onJump: (imgIndex: number) => void;
  onDismissReview: (key: string, id: string) => void;
  onApplyChanges: (changes: TranslationChange[]) => void;
  /** 단어장을 지키도록 이 줄들만 다시 번역 (메인 엔진, 텍스트만) */
  onRetranslateLines: (refs: LineRef[]) => void;
  onAddToGlossary: (original: string, translated: string) => void;
  /** 다듬기 탭 */
  polish: PolishState;
  mainEngineLabel: string;
  onStartPolish: (range: [number, number]) => void;
  onApplyPolish: (proposals: PolishProposal[]) => void;
  onDiscardPolish: (ids: string[]) => void;
  onClose: () => void;
}

const pagesLabel = (refs: LineRef[]) => [...new Set(refs.map(r => r.imgIndex + 1))].sort((a, b) => a - b).map(n => `${n}쪽`).join(', ');

/** 한 단어처럼 짧은 원문이면 단어장 추가 버튼을 보여줌 (긴 문장은 단어장에 맞지 않음) */
const GLOSSARY_MAX_LENGTH = 10;

/**
 * 검수 창: 번역을 사람이 손볼 곳을 모아 봅니다.
 * - 검토 목록: 자동 재요청 뒤에도 확신할 수 없어 "검토" 표시가 남은 말풍선
 * - 일관성 검사: 같은 원문이 다르게 번역된 곳, 단어장 표기를 지키지 않은 곳 (API 요청 없이 바로 계산)
 * - 다듬기: 번역이 끝난 대사를 텍스트만 모아 한 번 더 감수받고 제안을 골라 적용
 */
export function ReviewHubModal(props: ReviewHubModalProps) {
  const {
    initialTab = 'review', reviewItems, pages, glossary, workKey, onJump, onDismissReview, onApplyChanges, onRetranslateLines, onAddToGlossary,
    polish, mainEngineLabel, onStartPolish, onApplyPolish, onDiscardPolish, onClose,
  } = props;
  const [tab, setTab] = useState<ReviewTab>(initialTab);
  const [ignored, setIgnored] = useState(() => loadIgnoredOriginals(workKey));

  const groups = useMemo(() => findInconsistentLines(pages, ignored), [pages, ignored]);
  const misses = useMemo(() => findGlossaryMisses(pages, glossary), [pages, glossary]);
  const consistencyCount = groups.length + misses.reduce((sum, m) => sum + m.refs.length, 0);

  const ignore = (original: string) => {
    const next = [...ignored, original];
    saveIgnoredOriginals(workKey, next);
    setIgnored(next);
  };

  const unify = (refs: LineRef[], translated: string) => {
    onApplyChanges(refs.filter(r => r.translatedText.trim() !== translated).map(r => ({ key: r.key, id: r.id, translated })));
  };

  const tabs: [ReviewTab, string, number][] = [
    ['review', '검토 목록', reviewItems.length],
    ['consistency', '일관성 검사', consistencyCount],
    ['polish', '다듬기', polish.proposals.length],
  ];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-amber-600">
            <ClipboardCheck size={22} />
            <h3 className="text-lg font-bold text-gray-800">검수</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" title="닫기">
            <X size={22} />
          </button>
        </div>

        <div className="flex bg-gray-100 p-0.5 rounded-md border border-gray-200 mb-3 self-start">
          {tabs.map(([value, label, count]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`px-3 py-1 rounded text-xs font-medium ${tab === value ? 'bg-white text-amber-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {label} {count > 0 && <span className="ml-0.5 text-[10px] font-bold">{count}</span>}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto -mx-2 px-2">
          {tab === 'review' && (
            <>
              <p className="text-xs text-gray-500 mb-3">
                자동으로 다시 읽어도 확신할 수 없었던 말풍선입니다. 페이지로 가서 대본의 원문 고치기·이미지에서 다시 읽기로 바로잡거나, 괜찮으면 확인을 눌러 표시를 지우세요.
              </p>
              {reviewItems.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">검토할 말풍선이 없습니다.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {reviewItems.map(item => (
                    <li key={item.id} className="flex items-start gap-3 py-2.5">
                      <span className="shrink-0 text-xs font-bold text-gray-500 w-12 pt-0.5">{item.imgIndex + 1}쪽</span>
                      <div className="flex-1 min-w-0">
                        <span className="inline-block mb-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">{item.review}</span>
                        <p className="text-sm text-gray-800 break-keep">{item.translatedText}</p>
                        <p className="text-[11px] text-gray-400 font-serif">{item.originalText}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <SmallButton onClick={() => onJump(item.imgIndex)} title="이 페이지로 이동"><ArrowRight size={12} /> 이동</SmallButton>
                        <SmallButton onClick={() => onDismissReview(item.key, item.id)} title="확인했음 (표시 지우기)" tone="green"><Check size={12} /> 확인</SmallButton>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === 'polish' && (
            <PolishPanel
              pages={pages}
              polish={polish}
              mainEngineLabel={mainEngineLabel}
              onStart={onStartPolish}
              onApply={onApplyPolish}
              onDiscard={onDiscardPolish}
              onJump={onJump}
            />
          )}

          {tab === 'consistency' && (
            <>
              <p className="text-xs text-gray-500 mb-3">
                지금 연 페이지들의 번역만 비교합니다. API 요청 없이 바로 계산하며, 고친 뒤 다시 열면 목록이 갱신됩니다.
              </p>

              {misses.length > 0 && (
                <section className="mb-5">
                  <h4 className="text-sm font-bold text-gray-800 mb-2 flex items-center gap-1.5"><BookOpen size={14} className="text-purple-600" /> 단어장 표기를 따르지 않은 줄</h4>
                  <div className="space-y-2">
                    {misses.map(miss => (
                      <div key={miss.term} className="border border-purple-100 rounded-lg p-2.5">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <p className="text-xs text-gray-700"><b className="font-serif">{miss.term}</b> → <b className="text-purple-700">{miss.expected}</b> <span className="text-gray-400">· {miss.refs.length}줄</span></p>
                          <SmallButton onClick={() => onRetranslateLines(miss.refs)} title="단어장을 지키도록 이 줄들만 다시 번역 (메인 엔진, 텍스트만)" tone="purple">
                            <RefreshCw size={12} /> 모두 다시 번역
                          </SmallButton>
                        </div>
                        <ul className="space-y-1">
                          {miss.refs.map(ref => <RefLine key={ref.id} line={ref} onJump={onJump} />)}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h4 className="text-sm font-bold text-gray-800 mb-2">같은 원문, 다른 번역</h4>
                {groups.length === 0 ? (
                  <p className="text-sm text-gray-500 py-6 text-center">다르게 번역된 같은 원문이 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {groups.map(group => {
                      const allRefs = group.variants.flatMap(v => v.refs);
                      return (
                        <div key={group.original} className="border border-gray-200 rounded-lg p-2.5">
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <p className="text-sm font-serif text-gray-800">{group.original}</p>
                            <div className="flex gap-1 shrink-0">
                              {Array.from(group.original).length <= GLOSSARY_MAX_LENGTH && (
                                <SmallButton onClick={() => onAddToGlossary(group.original, group.variants[0].translated)} title="단어장에 추가 (앞으로의 번역에 반영)" tone="purple">
                                  <BookOpen size={12} /> 단어장
                                </SmallButton>
                              )}
                              <SmallButton onClick={() => ignore(group.original)} title="그대로 둬도 됨 (이 작품에서 다시 보이지 않음)"><EyeOff size={12} /> 넘기기</SmallButton>
                            </div>
                          </div>
                          <ul className="space-y-1">
                            {group.variants.map(variant => (
                              <li key={variant.translated} className="flex items-center gap-2 text-xs">
                                <SmallButton onClick={() => unify(allRefs, variant.translated)} title={`${allRefs.length}줄 모두 이 번역으로 바꾸기`} tone="green">
                                  <Check size={12} /> 이걸로 통일
                                </SmallButton>
                                <span className="text-gray-800 break-keep flex-1">{variant.translated}</span>
                                <button onClick={() => onJump(variant.refs[0].imgIndex)} className="text-gray-400 hover:text-gray-700 shrink-0" title="첫 번째 페이지로 이동">
                                  {variant.refs.length}회 · {pagesLabel(variant.refs)}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RefLine({ line, onJump }: { line: LineRef; onJump: (imgIndex: number) => void }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <button onClick={() => onJump(line.imgIndex)} className="shrink-0 w-10 text-left text-gray-400 hover:text-gray-700" title="이 페이지로 이동">{line.imgIndex + 1}쪽</button>
      <span className="flex-1 min-w-0">
        <span className="text-gray-800 break-keep">{line.translatedText}</span>
        <span className="block text-[11px] text-gray-400 font-serif">{line.originalText}</span>
      </span>
    </li>
  );
}

const TONES = {
  gray: 'border-gray-200 text-gray-600 hover:bg-gray-100',
  green: 'border-green-200 text-green-700 bg-green-50 hover:bg-green-100',
  purple: 'border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100',
} as const;

function SmallButton({ onClick, title, tone = 'gray', children }: { onClick: () => void; title: string; tone?: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className={`flex items-center gap-1 px-2 py-1 rounded text-xs border whitespace-nowrap shrink-0 ${TONES[tone]}`}>
      {children}
    </button>
  );
}
