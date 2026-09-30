import type { GridTranslationResult, RawTranslationResult } from './gemini';
import { parseJsonResponse } from './prompt';
import { sortMangaBoxesByTier } from './readingOrder';
import { parseWorkNotesResponse, type WorkNotesResult } from './glossaryCandidates';
import {
  fullPageToResult, gridResponseToResults, OPENAI_FULL_PAGE_SCHEMA, OPENAI_GRID_SCHEMA, OPENAI_POLISH_SCHEMA, OPENAI_WORK_NOTES_SCHEMA,
  type FullPageWire, type GridResponseWire, type PolishChangeWire,
} from './responseShape';
import { assertHeaderSafeApiKey, toFriendlyError, withRetry } from './retry';
import {
  buildFullPagePromptParts, buildGridPromptParts, buildPolishPromptParts, buildRetranslatePrompt, buildShortenPrompt, buildWorkNotesPrompt,
  type PolishLine, type PromptContextOptions, type PromptParts,
} from './translationPrompt';
import {
  isUnsupportedParameterError, LOW_REASONING_EFFORT, markCacheBreakpointsUnsupported, markPromptCacheKeyUnsupported, markReasoningControlUnsupported,
  promptCacheKeyFor, shortHash, shouldReduceReasoning, shouldUseCacheBreakpoints,
} from './requestTuning';
import { SCENE_USAGE_VARIANT } from './sceneThumbnail';
import { recordUsage } from './usageLog';

type OpenAiVersion = 'terra' | 'sol' | 'luna';
type HttpError = Error & { status?: number; retryAfterMs?: number };

/**
 * 헤더에서 고르는 이름 → 실제 모델 ID.
 * 세대가 섞여 있어(5.6 / 6) 이름만 이어 붙이지 않고 표로 둡니다.
 * - terra: 기본값. 일본어 인식이 안정적
 * - sol: 가장 강한 인식·번역 (품질 검사 재요청의 승격 대상이기도 함)
 * - luna: 시험용. 고어체·붓글씨체 원문을 잘못 읽는 경우가 있어 지켜보는 중
 */
const OPENAI_MODELS: Record<OpenAiVersion, string> = {
  terra: 'gpt-5.6-terra',
  sol: 'gpt-6.1-sol',
  luna: 'gpt-6-luna',
};

const modelFor = (openAiVersion: OpenAiVersion) => OPENAI_MODELS[openAiVersion] ?? OPENAI_MODELS.terra;

/** Chat Completions 호출. 429·5xx는 Retry-After 헤더를 존중하며 재시도하고, 최종 실패는 안내 메시지로 바꿉니다. */
async function createChatCompletion(apiKey: string, body: Record<string, unknown>, label = '요청', variant?: string): Promise<any> {
  assertHeaderSafeApiKey(apiKey, 'OpenAI');
  const model = String(body.model);
  const send = (payload: Record<string, unknown>) => withRetry(async () => {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errorText = await res.text();
        const error: HttpError = new Error(`OpenAI API Error ${res.status}: ${errorText}`);
        error.status = res.status;
        const retryAfterSeconds = Number(res.headers.get('retry-after'));
        if (retryAfterSeconds > 0) error.retryAfterMs = retryAfterSeconds * 1000;
        throw error;
      }

      return res.json();
    }, {
      onRetry: ({ attempt, delayMs, error }) => {
        console.warn(`OpenAI 요청 재시도 ${attempt}회 (${Math.round(delayMs / 1000)}초 후):`, (error as Error)?.message ?? error);
      },
    });

  // 모델에 따라 모를 수 있는 선택 설정들. 모델이 거절하면(400) 그 설정만 기억해 두고 빼서 다시 보냄
  const optional: Record<string, unknown> = {};
  // 추론 줄이기(사용량 창의 실험 옵션)
  if (shouldReduceReasoning(model)) optional.reasoning_effort = LOW_REASONING_EFFORT;
  // 같은 작품의 요청을 같은 서버로 보내 프롬프트 캐시 적중률을 높임
  const cacheKey = promptCacheKeyFor(model);
  if (cacheKey) optional.prompt_cache_key = cacheKey;
  // 캐시 지점: 자동 지점(요청 전체를 1.25배로 캐시에 씀)을 끄고, 고정 부분 끝에 찍은 지점만 씀 (cachedPromptMessages)
  let useBreakpoints = shouldUseCacheBreakpoints(model);
  const markUnsupported: Record<string, (model: string) => void> = {
    reasoning_effort: markReasoningControlUnsupported,
    prompt_cache_key: markPromptCacheKeyUnsupported,
  };

  try {
    let response;
    for (;;) {
      const payload = useBreakpoints
        ? { ...body, ...optional, prompt_cache_options: { mode: 'explicit' } }
        : { ...body, ...optional, messages: withoutBreakpoints(body.messages) };
      try {
        response = await send(payload);
        break;
      } catch (error) {
        if (useBreakpoints && ['prompt_cache_options', 'prompt_cache_breakpoint'].some(name => isUnsupportedParameterError(error, name))) {
          markCacheBreakpointsUnsupported(model);
          useBreakpoints = false;
          continue;
        }
        const rejected = Object.keys(optional).find(name => isUnsupportedParameterError(error, name));
        if (!rejected) throw error;
        markUnsupported[rejected](model);
        delete optional[rejected];
      }
    }
    const usage = response?.usage;
    // 캐시 진단용: OpenAI가 돌려준 사용량 원본 + 캐시 지점 앞 고정 부분의 길이·지문 (요청마다 지문이 같아야 캐시가 걸림)
    const stable = (body.messages as any[] | undefined)?.find(m => m?.role === 'developer')?.content?.[0]?.text;
    const stableNote = typeof stable === 'string' ? ` · 고정 부분 ${stable.length}자 #${shortHash(stable)}` : '';
    console.info(`[openai usage] ${model} · ${label}${stableNote}`, JSON.stringify(usage));
    recordUsage({
      provider: 'openai',
      model,
      label,
      inputTokens: usage?.prompt_tokens ?? 0,
      cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: usage?.prompt_tokens_details?.cache_write_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      variant,
    });
    return response;
  } catch (error) {
    throw toFriendlyError(error, 'OpenAI');
  }
}

const CACHE_BREAKPOINT = { mode: 'explicit' } as const;

/**
 * 캐시 준비(prewarm).
 * 실측(2026-09-30, gpt-6.1-sol, Chat Completions): 이미지가 붙은 요청은 캐시에 **쓰지 않지만**, 같은 고정 부분·같은 응답 형식으로
 * 글만 보낸 요청이 써 둔 캐시는 **읽음**. 격자 번역은 전부 이미지 요청이라 아무도 캐시를 쓰지 않아 캐시가 0%였음.
 * 그래서 격자 번역 전에 글만 있는 짧은 요청을 한 번 보내 캐시를 써 둠. 캐시는 마지막 사용 후 30분 유지되므로 25분마다 다시 준비.
 * 준비했는데도 이미지 요청이 연달아 캐시를 못 읽으면 그 모델은 이번 세션에서 준비를 멈춤 (준비 요청 비용만 나가지 않게).
 */
const WARM_TTL_MS = 25 * 60 * 1000;
const WARM_GIVE_UP_AFTER_MISSES = 3;
const warmed = new Map<string, { promise: Promise<void>; lastUsed: number }>();
const warmMisses = new Map<string, number>();
const warmDisabled = new Set<string>();

const warmKeyOf = (model: string, stable: string) => `${model}#${shortHash(stable)}`;

/** 테스트용: 캐시 준비 기록을 비움 */
export function resetCacheWarmState() {
  warmed.clear();
  warmMisses.clear();
  warmDisabled.clear();
}

async function ensureCacheWarm(apiKey: string, model: string, stable: string, responseFormat: Record<string, unknown>) {
  if (warmDisabled.has(model) || !shouldUseCacheBreakpoints(model)) return;
  const key = warmKeyOf(model, stable);
  const entry = warmed.get(key);
  if (entry && Date.now() - entry.lastUsed < WARM_TTL_MS) return entry.promise;

  const promise = createChatCompletion(apiKey, {
    model,
    messages: cachedPromptMessages({ stable, volatile: '캐시 준비용 요청이야. cells와 unsure를 모두 빈 배열로 답해.' }),
    response_format: responseFormat,
  }, '캐시 준비').then(() => undefined, error => {
    // 준비가 실패해도 번역은 그대로 진행 (캐시만 안 걸림)
    warmed.delete(key);
    console.warn('[cache] 캐시 준비 요청 실패:', (error as Error)?.message ?? error);
  });
  warmed.set(key, { promise, lastUsed: Date.now() });
  return promise;
}

/** 이미지 요청이 준비해 둔 캐시를 읽었는지 기록 (읽었으면 수명 연장, 계속 못 읽으면 준비를 멈춤) */
function noteWarmResult(model: string, stable: string, cachedTokens: number) {
  const entry = warmed.get(warmKeyOf(model, stable));
  if (!entry) return;
  if (cachedTokens > 0) {
    entry.lastUsed = Date.now();
    warmMisses.set(model, 0);
    return;
  }
  const misses = (warmMisses.get(model) ?? 0) + 1;
  warmMisses.set(model, misses);
  if (misses >= WARM_GIVE_UP_AFTER_MISSES) {
    warmDisabled.add(model);
    console.info(`[cache] ${model}: 캐시를 준비해도 이미지 요청이 ${misses}번 연속 캐시를 못 읽어, 이번 세션에서는 캐시 준비를 멈춥니다.`);
  }
}

/**
 * 캐시가 걸리게 나눈 메시지 두 개.
 * - developer: 고정 부분(지침·단어장·작품 노트) + 끝에 캐시 지점 → 같은 작품에서는 처음 한 번만 1.25배로 쓰고 이후 0.1배로 읽음
 * - user: 매번 바뀌는 부분 + 이미지 → 캐시에 쓰지 않아 정가(1배)
 */
function cachedPromptMessages(parts: PromptParts, imageDataUrls: string[] = [], lowDetailUrls: string[] = []) {
  return [
    { role: 'developer', content: [{ type: 'text', text: parts.stable, prompt_cache_breakpoint: CACHE_BREAKPOINT }] },
    {
      role: 'user',
      content: [
        { type: 'text', text: parts.volatile || '위 지침대로 처리해.' },
        ...imageDataUrls.map(url => ({ type: 'image_url', image_url: { url, detail: 'high' } })),
        ...lowDetailUrls.map(url => ({ type: 'image_url', image_url: { url, detail: 'low' } })),
      ],
    },
  ];
}

/** 캐시 지점 설정을 모르는 모델용: 메시지 모양은 그대로 두고 지점 표시만 뺌 */
function withoutBreakpoints(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  return messages.map(message => (Array.isArray(message?.content)
    ? { ...message, content: message.content.map(({ prompt_cache_breakpoint: _drop, ...part }: Record<string, unknown>) => part) }
    : message));
}

/** 응답 형태는 json_schema(strict)로 강제되므로, 여기서는 파싱만 합니다. */
function parseCells<T>(content: unknown): T[] {
  if (typeof content !== 'string' || !content) throw new Error('No response from OpenAI API');
  try {
    const parsed = parseJsonResponse<{ cells?: T[] }>(content);
    return parsed.cells ?? [];
  } catch (error: any) {
    throw new Error('Failed to parse JSON response: ' + error.message);
  }
}

const contentOf = (response: any): unknown => response?.choices?.[0]?.message?.content;

export interface GridRequestOptions extends PromptContextOptions {
  /** 여러 페이지를 한 격자에 묶었을 때 페이지별 칸 수 */
  pageCellCounts?: number[];
  /** 얼굴 위치로 추정한 화자 힌트 */
  speakerHint?: string;
  /** 품질 검사에 걸린 칸을 다시 보내는 요청 */
  retry?: boolean;
  /** 토큰 사용량 로그에 표시할 이름 */
  label?: string;
  /** [실험] 격자 뒤에 붙일 장면 이미지(페이지 전체 축소본, data URL) */
  sceneImages?: string[];
}

/**
 * [주력] 말풍선 격자 이미지를 OpenAI에게 직접 보여주고 원문 인식(OCR)과 번역을 한 번에 받습니다.
 * 격자가 여러 장으로 나뉘어도(칸 번호는 이어짐) 요청은 한 번이라 지침·단어장·맥락이 한 번만 들어갑니다.
 */
export async function translateGridImageOpenAI(
  openAiVersion: OpenAiVersion,
  apiKey: string,
  gridDataUrls: string[],
  expectedCells: number,
  options: GridRequestOptions = {},
): Promise<GridTranslationResult[]> {
  const { pageCellCounts, label, sceneImages = [], ...promptOptions } = options;
  const parts = buildGridPromptParts({ expectedCells, pageCellCounts, sceneCount: sceneImages.length, ...promptOptions });
  const model = modelFor(openAiVersion);
  const responseFormat = { type: 'json_schema', json_schema: OPENAI_GRID_SCHEMA };

  // 이미지 요청은 캐시를 쓰지 않으므로, 같은 고정 부분·같은 응답 형식으로 캐시를 먼저 써 둠
  await ensureCacheWarm(apiKey, model, parts.stable, responseFormat);
  const response = await createChatCompletion(apiKey, {
    model,
    messages: cachedPromptMessages(parts, gridDataUrls, sceneImages),
    response_format: responseFormat,
  }, label ?? (pageCellCounts && pageCellCounts.length > 1 ? `격자 번역 (${pageCellCounts.length}장 묶음)` : '격자 번역'),
  sceneImages.length > 0 ? SCENE_USAGE_VARIANT : undefined);
  noteWarmResult(model, parts.stable, response?.usage?.prompt_tokens_details?.cached_tokens ?? 0);

  const content = contentOf(response);
  if (typeof content !== 'string' || !content) throw new Error('No response from OpenAI API');
  try {
    return gridResponseToResults(parseJsonResponse<GridResponseWire>(content));
  } catch (error: any) {
    throw new Error('Failed to parse JSON response: ' + error.message);
  }
}

/**
 * 말풍선을 찾지 못한 페이지의 대체 경로: 페이지 전체를 보여주고 좌표까지 함께 받습니다.
 * 좌표는 모델 추정치라 정확도가 낮으므로, 격자 경로가 가능하면 그쪽을 씁니다.
 */
export async function translateFullPageOpenAI(
  openAiVersion: OpenAiVersion,
  apiKey: string,
  pageDataUrl: string,
  options: PromptContextOptions = {},
): Promise<RawTranslationResult[]> {
  const response = await createChatCompletion(apiKey, {
    model: modelFor(openAiVersion),
    messages: cachedPromptMessages(buildFullPagePromptParts(options), [pageDataUrl]),
    response_format: { type: 'json_schema', json_schema: OPENAI_FULL_PAGE_SCHEMA },
  }, '페이지 전체 번역');

  const cells = parseCells<FullPageWire>(contentOf(response)).map(fullPageToResult);
  return sortMangaBoxesByTier(cells, c => c.box_2d);
}

/** 원문 한 문장만 다시 번역합니다. */
export async function retranslateTextOpenAI(
  openAiVersion: OpenAiVersion, apiKey: string, originalText: string, options: PromptContextOptions = {},
): Promise<string> {
  const response = await createChatCompletion(apiKey, {
    model: modelFor(openAiVersion),
    messages: [{ role: 'user', content: buildRetranslatePrompt(originalText, options) }],
  }, '문장 재번역');

  const text = contentOf(response);
  return (typeof text === 'string' ? text.trim() : '') || '번역 실패';
}

/** 말풍선에 들어가도록 번역문을 짧게 다듬습니다. */
export async function shortenTranslationOpenAI(
  openAiVersion: OpenAiVersion, apiKey: string, originalText: string, currentTranslation: string, maxChars: number,
  options: PromptContextOptions = {},
): Promise<string> {
  const response = await createChatCompletion(apiKey, {
    model: modelFor(openAiVersion),
    messages: [{ role: 'user', content: buildShortenPrompt(originalText, currentTranslation, maxChars, options) }],
  }, '짧게 다시 번역');

  const content = contentOf(response);
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) throw new Error('No response from OpenAI API');
  return text;
}

/** 지금까지의 번역으로 작품 노트(말투·호칭 기억)를 정리합니다. */
export async function summarizeWorkNotesOpenAI(
  openAiVersion: OpenAiVersion,
  apiKey: string,
  pairs: { original: string; translated: string }[],
  previousNotes?: string,
  correctionSection?: string,
  existingGlossary: string[] = [],
): Promise<WorkNotesResult> {
  if (pairs.length === 0) return { notes: previousNotes?.trim() ?? '', glossary: [] };

  const response = await createChatCompletion(apiKey, {
    model: modelFor(openAiVersion),
    messages: [{ role: 'user', content: buildWorkNotesPrompt(pairs, previousNotes, correctionSection, existingGlossary) }],
    response_format: { type: 'json_schema', json_schema: OPENAI_WORK_NOTES_SCHEMA },
  }, '작품 노트 정리 (+단어장 후보)');

  const content = contentOf(response);
  return parseWorkNotesResponse(typeof content === 'string' ? content : '');
}

/** 번역이 끝난 대사들을 텍스트만으로 감수해, 고칠 줄만 돌려받습니다. (다듬기 패스) */
export async function polishTranslationsOpenAI(
  openAiVersion: OpenAiVersion, apiKey: string, lines: PolishLine[], options: PromptContextOptions = {},
): Promise<PolishChangeWire[]> {
  if (lines.length === 0) return [];
  const response = await createChatCompletion(apiKey, {
    model: modelFor(openAiVersion),
    messages: cachedPromptMessages(buildPolishPromptParts(lines, options)),
    response_format: { type: 'json_schema', json_schema: OPENAI_POLISH_SCHEMA },
  }, `다듬기 (${lines.length}줄)`);
  const content = contentOf(response);
  if (typeof content !== 'string' || !content) throw new Error('No response from OpenAI API');
  return parseJsonResponse<{ changes?: PolishChangeWire[] }>(content).changes ?? [];
}

/**
 * [진단] 캐시가 실제로 걸리는지 확인: 같은 고정 부분(캐시 지점 포함)으로 짧은 요청을 두 번 보내 사용량을 돌려줍니다.
 * 두 번째 요청의 cached_tokens가 0보다 크면 캐시 지점이 동작하는 것. 첫 요청의 prompt_tokens로 고정 부분의 실제 토큰 수도 알 수 있음
 * (브라우저 콘솔에서 __mangaCacheTest() — App.tsx)
 */
export async function runPromptCacheDiagnostic(
  openAiVersion: OpenAiVersion,
  apiKey: string,
  stableText: string,
  images: { small: string; large: string; scene: string },
) {
  const volatile = '연결 확인용 요청이야. 이미지는 무시하고 cells와 unsure를 모두 빈 배열로 답해.';
  const model = modelFor(openAiVersion);
  const schema = { response_format: { type: 'json_schema', json_schema: OPENAI_GRID_SCHEMA } };
  const request = (gridImages: string[], sceneImages: string[] = []) =>
    ({ model, messages: cachedPromptMessages({ stable: stableText, volatile }, gridImages, sceneImages), ...schema });
  // 1) 글만(캐시 준비와 같은 모양)으로 캐시를 쓰고, 2~5) 이미지 조건을 하나씩 바꿔 가며 그 캐시를 읽는지 봄
  const cases: [string, Record<string, unknown>][] = [
    ['1 준비 (글만)', request([])],
    ['2 작은 이미지', request([images.small])],
    ['3 큰 이미지 (실제 격자 크기)', request([images.large])],
    ['4 작은 이미지 + 장면(low)', request([images.small], [images.scene])],
    ['5 큰 이미지 + 장면(low) (실제와 같은 모양)', request([images.large], [images.scene])],
  ];
  const results: { name: string; usage: any }[] = [];
  for (const [name, body] of cases) results.push({ name, usage: (await createChatCompletion(apiKey, body, `캐시 진단 ${name}`)).usage });
  return results;
}
