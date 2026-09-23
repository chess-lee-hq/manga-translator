import { CORRECTIONS_PREFIX, loadCorrections, mergeCorrections, saveCorrections } from './corrections';
import { CANDIDATES_PREFIX, loadCandidates, saveCandidates, type GlossaryCandidate } from './glossaryCandidates';
import { hasStoredGlossary, loadGlossary, loadLegacyGlossary, saveGlossary } from './glossaryStore';
import { loadWorkNotes, NOTES_PREFIX, saveWorkNotes, type WorkNotes } from './workNotes';

/**
 * "지금 열린 파일이 어느 작품인가"를 정합니다.
 * 단어장·작품 노트·내가 고친 번역·단어장 후보는 모두 이 작품 단위(key)로 저장됩니다.
 *
 * ## 작품을 알아보는 규칙
 * 1. 사용자가 직접 지정한 작품 이름이 있으면 그것 (단어장 창의 "작품" 칸)
 * 2. 없으면 파일(ZIP·CBZ) 이름에서 **권·화 번호를 떼어 낸 제목**
 *    `陽だまりの樹 01.zip`, `陽だまりの樹 第2巻.cbz`, `陽だまりの樹 (下).zip` → 모두 `陽だまりの樹`
 *    → 같은 작품의 다른 권을 열어도 단어장·노트가 그대로 이어집니다.
 * 3. 저장 키는 표기 흔들림(전각/반각, 대소문자, 띄어쓰기, 문장부호)을 없앤 값이라
 *    `One Piece` 와 `ONE PIECE` 와 `One_Piece` 는 같은 작품으로 봅니다.
 * 4. 낱장 이미지(`001.jpg`)처럼 제목을 알 수 없으면 "이름 없는 작품" 하나로 모입니다.
 *    이때는 단어장 창에서 작품 이름을 붙여 주는 것을 권장합니다.
 */
export interface WorkIdentity {
  /** 판별에 쓴 원래 이름 (불러온 ZIP 이름, 없으면 첫 이미지 파일 이름) */
  rawName: string;
  /** 화면에 보여 줄 작품 이름 */
  title: string;
  /** 저장 키 */
  key: string;
  /** 사용자가 직접 지정한 이름인지 */
  manual: boolean;
  /** 파일 이름에서 자동으로 뽑은 제목 (직접 지정했을 때 "자동으로 되돌리기"용) */
  autoTitle: string;
}

export const UNTITLED_KEY = 'default';
export const UNTITLED_TITLE = '이름 없는 작품';

const ALIASES_KEY = 'manga-work-aliases';
const REGISTRY_KEY = 'manga-work-registry';

const FILE_EXTENSION = /\.(zip|cbz|rar|cbr|7z|pdf|jpe?g|png|webp|gif|avif|bmp|json)$/i;
/** 권·화 표시 (NFKC 정규화 뒤라 숫자·괄호는 반각) */
const VOLUME_MARKERS: RegExp[] = [
  /第\s*\d+(?:\.\d+)?\s*[巻卷話话集部回]/g,
  /제\s*\d+(?:\.\d+)?\s*[권화부]/g,
  /\d+(?:\.\d+)?\s*[巻卷권화話话]/g,
  /\b(?:vol(?:ume)?|v|ch(?:apter)?|ep(?:isode)?|no)\.?\s*\d+(?:\.\d+)?\b/gi,
  /#\s*\d+/g,
];
/** 괄호 안이 권 번호·연도·스캔 표시·상하권 표시뿐이면 통째로 뗌. (작가 이름 같은 괄호는 남김) */
const TAG_IN_BRACKETS = /[([【]\s*(?:\d+(?:\.\d+)?|digital|scans?|raw|jpn?|japanese|完結?|上|中|下|前編|中編|後編|前|後)\s*[)\]】]/gi;
const EMPTY_BRACKETS = /[([【]\s*[)\]】]/g;
const TRAILING_PART = /[\s\-.·]+(?:上|中|下|前編|中編|後編|完結?|end)$/i;
const TRAILING_NUMBER = /[\s\-.#]*\d+(?:\.\d+)?$/;
const EDGE_PUNCT = /^[\s\-.·:~,]+|[\s\-.·:~,]+$/g;
/** 낱장 이미지에 흔한 이름 — 작품 제목으로 볼 수 없음 */
const GENERIC_NAMES = new Set(['page', 'pages', 'img', 'image', 'images', 'scan', 'p', 'pic', 'untitled']);

/** 파일 이름에서 권·화 번호와 확장자를 떼어 낸 작품 제목. 제목으로 볼 수 없으면 빈 문자열 */
export function seriesTitleOf(name: string): string {
  let title = name.normalize('NFKC').trim().replace(FILE_EXTENSION, '').replace(/_+/g, ' ');
  for (const pattern of VOLUME_MARKERS) title = title.replace(pattern, ' ');
  title = title.replace(TAG_IN_BRACKETS, ' ').replace(EMPTY_BRACKETS, ' ');
  // "01-05"처럼 번호가 여러 겹이면 한 번에 안 떨어지므로 더 바뀌지 않을 때까지 반복
  for (let previous = ''; previous !== title;) {
    previous = title;
    title = title.replace(EDGE_PUNCT, '').replace(TRAILING_PART, '').replace(TRAILING_NUMBER, '');
  }
  title = title.replace(/\s+/g, ' ').trim();
  if (!/\p{L}/u.test(title) || GENERIC_NAMES.has(title.toLowerCase())) return '';
  return title;
}

/** 저장 키: 전각/반각·대소문자·띄어쓰기·문장부호 차이를 없앤 값 */
export function workKeyOf(title: string): string {
  const key = title.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  return key || UNTITLED_KEY;
}

function readJson<T extends object>(storageKey: string): T {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : {} as T;
  } catch {
    return {} as T;
  }
}

function writeJson(storageKey: string, value: object) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch (err) {
    console.warn('작품 정보 저장 실패:', err);
  }
}

/** 파일 이름 → 사용자가 직접 지정한 작품 이름 */
export function loadWorkAliases(): Record<string, string> {
  return readJson<Record<string, string>>(ALIASES_KEY);
}

export function resolveWork(rawName: string | null | undefined, aliases: Record<string, string> = loadWorkAliases()): WorkIdentity {
  const raw = (rawName ?? '').trim();
  const alias = raw ? aliases[raw]?.trim() : '';
  const autoTitle = raw ? seriesTitleOf(raw) : '';
  const title = alias || autoTitle;
  return {
    rawName: raw,
    title: title || UNTITLED_TITLE,
    key: title ? workKeyOf(title) : UNTITLED_KEY,
    manual: !!alias,
    autoTitle,
  };
}

/** 이 파일을 어느 작품으로 볼지 직접 지정합니다. 빈 값이면 자동 판별로 되돌립니다. 바뀐 전체 목록을 돌려줌 */
export function setWorkAlias(rawName: string, title: string | null): Record<string, string> {
  const aliases = loadWorkAliases();
  const raw = rawName.trim();
  if (!raw) return aliases;
  const trimmed = title?.trim() ?? '';
  if (!trimmed || trimmed === seriesTitleOf(raw)) delete aliases[raw];
  else aliases[raw] = trimmed;
  writeJson(ALIASES_KEY, aliases);
  return aliases;
}

/** 한 번이라도 열었던 작품 목록에 남겨 둡니다. (작품 이름을 고를 때 후보로 보여 줌) */
export function rememberWork(work: WorkIdentity) {
  if (work.key === UNTITLED_KEY) return;
  const registry = readJson<Record<string, string>>(REGISTRY_KEY);
  if (registry[work.key] === work.title) return;
  registry[work.key] = work.title;
  writeJson(REGISTRY_KEY, registry);
}

export function listKnownWorks(): { key: string; title: string }[] {
  return Object.entries(readJson<Record<string, string>>(REGISTRY_KEY))
    .map(([key, title]) => ({ key, title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

function storageKeysWithPrefix(prefix: string): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch {
    // 저장소를 못 쓰는 환경
  }
  return keys;
}

function mergeCandidateLists(lists: { candidates: GlossaryCandidate[]; dismissed: string[] }[]) {
  const candidates = new Map<string, GlossaryCandidate>();
  const dismissed = new Set<string>();
  for (const list of lists) {
    list.candidates.forEach(c => { if (!candidates.has(c.original)) candidates.set(c.original, c); });
    list.dismissed.forEach(d => dismissed.add(d));
  }
  return { candidates: [...candidates.values()].filter(c => !dismissed.has(c.original)), dismissed: [...dismissed] };
}

/**
 * 작품별로 나누기 전(파일 이름 그대로 저장하던 때)의 데이터를 이 작품으로 옮깁니다. 여러 번 불러도 안전합니다.
 *
 * - 작품 노트·내가 고친 번역·단어장 후보: 예전에 **같은 작품의 어느 권으로든** 저장해 둔 것을 모아 옴
 *   (노트는 가장 최근 것, 교정·후보는 합침). 이미 새 자리에 있으면 건드리지 않음
 * - 단어장: 예전에는 모든 작품이 한 단어장을 썼으므로, **예전에 작업하던 작품이면** 그 단어장을 그대로 이어 받음.
 *   처음 여는 작품은 빈 단어장으로 시작 (다른 작품의 단어가 섞여 들어오지 않게). 필요하면 단어장 창에서 골라 가져옴
 */
export function migrateLegacyWorkData(work: WorkIdentity) {
  const registered = new Set(Object.keys(readJson<Record<string, string>>(REGISTRY_KEY)));
  const aliases = loadWorkAliases();
  // 새 방식 키(다른 작품이 이미 쓰는 자리)는 건드리지 않고, 예전 파일 이름 키 중 이 작품으로 모이는 것만 고름
  const belongsHere = (name: string) =>
    name !== work.key && (name === work.rawName || (!registered.has(name) && resolveWork(name, aliases).key === work.key));
  const legacyNamesOf = (prefix: string) =>
    storageKeysWithPrefix(prefix).map(key => key.slice(prefix.length)).filter(belongsHere);

  const noteNames = legacyNamesOf(NOTES_PREFIX);
  const correctionNames = legacyNamesOf(CORRECTIONS_PREFIX);
  const candidateNames = legacyNamesOf(CANDIDATES_PREFIX);

  if (noteNames.length > 0 && !loadWorkNotes(work.key)) {
    const latest = noteNames
      .map(loadWorkNotes)
      .filter((n): n is WorkNotes => !!n)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
    if (latest) saveWorkNotes(work.key, latest);
  }

  if (correctionNames.length > 0 && loadCorrections(work.key).length === 0) {
    const merged = correctionNames.map(loadCorrections).reduce(mergeCorrections, []);
    if (merged.length > 0) saveCorrections(work.key, merged);
  }

  const currentCandidates = loadCandidates(work.key);
  if (candidateNames.length > 0 && currentCandidates.candidates.length === 0 && currentCandidates.dismissed.length === 0) {
    saveCandidates(work.key, mergeCandidateLists(candidateNames.map(loadCandidates)));
  }

  const workedOnBefore = noteNames.length + correctionNames.length + candidateNames.length > 0;
  if (workedOnBefore && !hasStoredGlossary(work.key)) {
    const legacy = loadLegacyGlossary();
    if (Object.keys(legacy).length > 0) saveGlossary(work.key, legacy);
  }
}

/**
 * 작품 이름을 바꿨을 때, 새 작품 쪽이 비어 있으면 지금까지의 데이터를 가져갑니다.
 * (이름만 바꾼 경우엔 그대로 이어지고, 이미 있는 다른 작품에 연결한 경우엔 그 작품의 데이터를 씀)
 */
export function carryOverWorkData(fromKey: string, toKey: string) {
  if (fromKey === toKey) return;

  const fromGlossary = loadGlossary(fromKey);
  if (Object.keys(loadGlossary(toKey)).length === 0 && Object.keys(fromGlossary).length > 0) saveGlossary(toKey, fromGlossary);

  const fromNotes = loadWorkNotes(fromKey);
  if (!loadWorkNotes(toKey) && fromNotes) saveWorkNotes(toKey, fromNotes);

  const fromCorrections = loadCorrections(fromKey);
  if (loadCorrections(toKey).length === 0 && fromCorrections.length > 0) saveCorrections(toKey, fromCorrections);

  const toCandidates = loadCandidates(toKey);
  const fromCandidates = loadCandidates(fromKey);
  if (toCandidates.candidates.length === 0 && toCandidates.dismissed.length === 0) saveCandidates(toKey, fromCandidates);
}
