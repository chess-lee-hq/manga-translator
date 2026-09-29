import type { TranslationResult, TranslationSettings } from '../types';
import { normalizeEllipsis } from './ellipsis';
import { polishTranslationsGemini } from './gemini';
import { polishTranslationsOpenAI } from './openai';
import { stripFurigana } from './prompt';
import type { PolishChangeWire } from './responseShape';
import { assessCell } from './translationQuality';
import type { PolishLine } from './translationPrompt';

/**
 * 다듬기(감수) 패스: 번역이 끝난 페이지들의 대사를 **텍스트만** 모아 메인 엔진에 한 번 더 보여주고,
 * 말투·호칭·표기가 흔들린 줄과 명백한 오역만 고친 제안을 받습니다. (이미지를 안 보내 입력 토큰이 적음)
 * 받은 제안은 바로 적용하지 않고 검수 창에서 사람이 골라 적용합니다.
 */

export interface PolishSource {
  /** 0부터 시작하는 페이지 번호 */
  imgIndex: number;
  key: string;
  results: TranslationResult[];
}

export interface PolishProposal {
  key: string;
  id: string;
  imgIndex: number;
  original: string;
  before: string;
  after: string;
  why: string;
}

/** 요청 한 번에 보내는 최대 줄 수 (페이지 중간에서 자르지 않음) */
export const POLISH_CHUNK_LINES = 120;
const PLACEHOLDER_TEXTS = new Set(['...', '번역 중...', '인식된 텍스트가 없습니다.']);

interface Entry {
  source: PolishSource;
  result: TranslationResult;
}

function entriesOf(source: PolishSource): Entry[] {
  return source.results
    .filter(r => r.translated_text?.trim() && !PLACEHOLDER_TEXTS.has(r.translated_text.trim()))
    .map(result => ({ source, result }));
}

/** 페이지 단위로 묶어 줄 수가 한도를 넘지 않게 나눕니다. (한 페이지가 한도보다 길면 그 페이지만 한 묶음) */
export function chunkForPolish(sources: PolishSource[], maxLines = POLISH_CHUNK_LINES): Entry[][] {
  const chunks: Entry[][] = [];
  let current: Entry[] = [];
  for (const source of sources) {
    const entries = entriesOf(source);
    if (entries.length === 0) continue;
    if (current.length > 0 && current.length + entries.length > maxLines) {
      chunks.push(current);
      current = [];
    }
    current.push(...entries);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export const countPolishLines = (sources: PolishSource[]) => sources.reduce((sum, source) => sum + entriesOf(source).length, 0);

const compact = (text: string) => text.replace(/\s+/g, '');
const JAPANESE = /[ぁ-ゖァ-ヺ㐀-䶿一-鿿]/;

/**
 * 받은 제안 중 쓸 만한 것만 남깁니다.
 * 줄 번호가 없거나, 실제로 바뀐 게 없거나, 일본어가 남았거나, 말풍선에 안 들어갈 만큼 길어진 제안은 버림
 */
export function acceptChanges(chunk: Entry[], changes: PolishChangeWire[]): PolishProposal[] {
  const seen = new Set<number>();
  const proposals: PolishProposal[] = [];
  for (const change of changes) {
    if (!Number.isInteger(change.i) || change.i < 1 || change.i > chunk.length || seen.has(change.i)) continue;
    seen.add(change.i);
    const { source, result } = chunk[change.i - 1];
    const before = result.translated_text.trim();
    const after = normalizeEllipsis((change.ko ?? '').trim());
    if (!after || compact(after) === compact(before)) continue;
    if (assessCell({ id: change.i, original_text: result.original_text, translated_text: after }) !== null) continue;
    // 원래 번역에 없던 한자·가나가 새로 들어간 제안 (감수가 오히려 일본어를 되살린 경우)
    if (JAPANESE.test(after) && !JAPANESE.test(before)) continue;
    const beforeLength = Array.from(before).length;
    if (Array.from(after).length > Math.max(beforeLength * 1.6, beforeLength + 8)) continue;
    proposals.push({
      key: source.key,
      id: result.id,
      imgIndex: source.imgIndex,
      original: stripFurigana(result.original_text ?? ''),
      before,
      after,
      why: (change.why ?? '').trim(),
    });
  }
  return proposals;
}

function requireMainKey(settings: TranslationSettings) {
  if (settings.mainEngine === 'gemini' ? !settings.googleKey : !settings.openaiKey) {
    throw new Error(`${settings.mainEngine === 'gemini' ? 'Gemini' : 'OpenAI'} API 키를 먼저 입력해주세요.`);
  }
}

/**
 * 다듬기 패스를 실행합니다. 묶음은 순서대로 보내고(앞 묶음이 실패해도 뒤 묶음은 계속), 끝난 묶음 수를 알려줍니다.
 * settings.context(작품 노트)·recentContext(내 교정)·glossary가 프롬프트에 함께 들어갑니다.
 */
export async function runPolishPass(
  sources: PolishSource[],
  settings: TranslationSettings,
  onProgress?: (done: number, total: number) => void,
): Promise<{ proposals: PolishProposal[]; failedChunks: number }> {
  requireMainKey(settings);
  const chunks = chunkForPolish(sources);
  const options = { glossary: settings.glossary, context: settings.context, recentContext: settings.recentContext };
  const proposals: PolishProposal[] = [];
  let failedChunks = 0;
  onProgress?.(0, chunks.length);
  for (let n = 0; n < chunks.length; n++) {
    const chunk = chunks[n];
    const lines: PolishLine[] = chunk.map(({ source, result }, index) => ({
      i: index + 1,
      page: source.imgIndex + 1,
      jp: stripFurigana(result.original_text ?? '').trim(),
      ko: result.translated_text.trim(),
    }));
    try {
      const changes = settings.mainEngine === 'gemini'
        ? await polishTranslationsGemini(settings.googleKey, settings.geminiVersion, lines, options)
        : await polishTranslationsOpenAI(settings.openAiVersion, settings.openaiKey, lines, options);
      const accepted = acceptChanges(chunk, changes);
      console.info(`[polish] ${n + 1}/${chunks.length}묶음 · ${lines.length}줄 중 제안 ${changes.length}개 → 채택 후보 ${accepted.length}개`);
      proposals.push(...accepted);
    } catch (error) {
      failedChunks++;
      console.warn(`[polish] ${n + 1}/${chunks.length}묶음 실패:`, (error as Error)?.message ?? error);
      if (n === 0 && chunks.length === 1) throw error;
    }
    onProgress?.(n + 1, chunks.length);
  }
  return { proposals, failedChunks };
}
