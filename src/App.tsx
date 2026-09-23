import JSZip from 'jszip';
import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { AppHeader } from './components/AppHeader';
import { DriveModal } from './components/DriveModal';
import { EmptyState } from './components/EmptyState';
import { GlossaryModal, type GlossaryDraft } from './components/GlossaryModal';
import { ImportChoiceModal } from './components/ImportChoiceModal';
import { MangaViewer } from './components/MangaViewer';
import { PageNavigator } from './components/PageNavigator';
import { ScriptPanel } from './components/ScriptPanel';
import { WorkNotesModal } from './components/WorkNotesModal';
import { useDriveSync } from './hooks/useDriveSync';
import { useGlossary } from './hooks/useGlossary';
import { useGlossaryCandidates } from './hooks/useGlossaryCandidates';
import { useCorrections } from './hooks/useCorrections';
import { useWorkNotes } from './hooks/useWorkNotes';
import { useSessionPersistence, type RestoredSession } from './hooks/useSessionPersistence';
import { getCacheKey, useTranslationCache } from './hooks/useTranslationCache';
import { useTranslationQueue } from './hooks/useTranslationQueue';
import { resolveDisplayMode, TAG_SCALE_MAX, TAG_SCALE_MIN } from './lib/bubbleDisplay';
import { downloadBlob } from './lib/download';
import { createMangaZip, defaultBackupFilename } from './lib/drive';
import { summarizeWorkNotes } from './lib/gemini';
import { summarizeWorkNotesOpenAI } from './lib/openai';
import { canvasToBlob, exportFormatFor, renderTranslatedPage } from './lib/exportCanvas';
import { VIEWER_CHROME_PX } from './lib/overlayLayout';
import { stripArchiveExtension } from './lib/fileImport';
import { appendImages, importBackupZip, importFiles, mergeImages, type ImportResult } from './lib/importFiles';
import { buildTranslationQueue, getSpreadStartIndex, getVisibleIndices } from './lib/pageLayout';
import { normalizeEllipsis } from './lib/ellipsis';
import { retranslateText, shortenTranslation, translateRegion } from './lib/translatePage';
import { buildCorrectionSection, loadCorrections, mergeCorrections, saveCorrections } from './lib/corrections';
import { filterCandidates } from './lib/glossaryCandidates';
import { buildContextInstruction, collectRecentPairs } from './lib/translationContext';
import { saveWorkNotes } from './lib/workNotes';
import { clearLegacyGlossary, loadLegacyGlossary, mergeIntoStoredGlossary } from './lib/glossaryStore';
import { carryOverWorkData, listKnownWorks, loadWorkAliases, migrateLegacyWorkData, rememberWork, resolveWork, setWorkAlias } from './lib/workIdentity';
import type { Box2d, GeminiVersion, HoveredBubble, MainEngine, OpenAiVersion, ScriptStyle, TranslationSettings, UploadedImage, ViewMode } from './types';

/** 보이는 페이지 뒤로 미리 번역해 둘 페이지 수 */
const PRELOAD_PAGE_COUNT = 10;
const AUTO_NOTES_STORAGE_KEY = 'manga-translator-auto-notes';
/** 작품 노트를 처음 만드는 시점(번역된 페이지 수)과 이후 갱신 주기 */
const NOTES_FIRST_PAGES = 3;
const NOTES_REFRESH_PAGES = 10;
/** 작품 노트를 만들 때 참고할 최대 대사 수 */
const NOTES_SOURCE_PAIRS = 60;
const GOOGLE_KEY_STORAGE = 'manga-translator-google-key';
const OPENAI_KEY_STORAGE = 'manga-translator-openai-key';
/** 고른 번역 엔진·모델을 다음 실행에도 유지 */
const GEMINI_VERSION_STORAGE_KEY = 'manga-translator-gemini-version';
/**
 * 고른 OpenAI 모델. 예전 키(openai-version)에는 한동안 기본값이던 6 Luna가 남아 있을 수 있어,
 * 새 키로 옮기면서 Luna는 기본값(5.6 Terra)으로 되돌린다. Sol을 골라 뒀던 사람은 그대로 Sol.
 */
const OPENAI_VERSION_STORAGE_KEY = 'manga-translator-openai-model';
const LEGACY_OPENAI_VERSION_STORAGE_KEY = 'manga-translator-openai-version';

function loadOpenAiVersion(): OpenAiVersion {
  const saved = localStorage.getItem(OPENAI_VERSION_STORAGE_KEY);
  if (saved === 'terra' || saved === 'sol' || saved === 'luna') return saved;
  return localStorage.getItem(LEGACY_OPENAI_VERSION_STORAGE_KEY) === 'sol' ? 'sol' : 'terra';
}
/** 1차 번역을 맡는 엔진(메인/서브 역할) — 기본은 OpenAI */
const MAIN_ENGINE_STORAGE_KEY = 'manga-translator-main-engine';

const hasDraggedFiles = (e: ReactDragEvent) => Array.from(e.dataTransfer.types).includes('Files');

function App() {
  // 메인은 기본 OpenAI(5.6 Terra), Gemini는 보조 — 헤더의 스위치 버튼으로 역할을 통째로 바꿀 수 있음
  const [googleKey, setGoogleKey] = useState(() => localStorage.getItem(GOOGLE_KEY_STORAGE) || '');
  const [openaiKey, setOpenaiKey] = useState(() => localStorage.getItem(OPENAI_KEY_STORAGE) || '');
  const [geminiVersion, setGeminiVersion] = useState<GeminiVersion>(() => (localStorage.getItem(GEMINI_VERSION_STORAGE_KEY) === '3.7' ? '3.7' : '3.6'));
  const [openAiVersion, setOpenAiVersion] = useState<OpenAiVersion>(loadOpenAiVersion);
  const [mainEngine, setMainEngine] = useState<MainEngine>(() => (localStorage.getItem(MAIN_ENGINE_STORAGE_KEY) === 'gemini' ? 'gemini' : 'openai'));

  const [allImages, setAllImages] = useState<UploadedImage[]>([]);
  const [loadedFilename, setLoadedFilename] = useState<string | null>(null);
  // 드라이브에 저장(덮어쓰기)할 파일 이름. 불러온 이름·마지막으로 저장한 이름을 기억함
  const [driveFileName, setDriveFileName] = useState<string | null>(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('2page');
  const [scriptStyle, setScriptStyle] = useState<ScriptStyle>('side');
  const [isEditingBoxes, setIsEditingBoxes] = useState(false);
  const [scale, setScale] = useState(1.0);
  const [hoveredBubble, setHoveredBubble] = useState<HoveredBubble | null>(null);
  // 비동기 번역이 진행 중인 말풍선 id (여러 개 동시 진행 가능)
  const [pendingBubbleIds, setPendingBubbleIds] = useState<Set<string>>(() => new Set());
  const [glossaryDraft, setGlossaryDraft] = useState<GlossaryDraft | null>(null);
  const [isWorkNotesOpen, setIsWorkNotesOpen] = useState(false);
  const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);
  const [autoNotes, setAutoNotes] = useState(() => localStorage.getItem(AUTO_NOTES_STORAGE_KEY) !== 'false');
  const notesBusyRef = useRef(false);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // 작업 중에 다른 압축 파일을 열었을 때, 새로 열지 이어 붙일지 고르기 전까지 들고 있는 가져오기 결과
  const [pendingImport, setPendingImport] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---------- 작품 판별 ----------
  // 단어장·작품 노트·내가 고친 번역·단어장 후보는 모두 "작품" 단위로 저장 (lib/workIdentity.ts의 규칙)
  // 파일 이름에서 권·화 번호를 떼어 같은 작품의 다른 권끼리 자동으로 이어지고, 단어장 창에서 직접 지정할 수도 있음
  const [workAliases, setWorkAliases] = useState(loadWorkAliases);
  const rawWorkName = loadedFilename ?? allImages[0]?.file.name ?? '';
  const work = useMemo(() => {
    const identity = resolveWork(rawWorkName, workAliases);
    // 작품별로 나누기 전 데이터를 옮겨 둔 뒤 아래 훅들이 읽도록, 같은 렌더에서 먼저 처리 (여러 번 불러도 안전)
    migrateLegacyWorkData(identity);
    rememberWork(identity);
    return identity;
  }, [rawWorkName, workAliases]);
  const workName = work.key;
  // 작품별로 나누기 전 모든 작품이 함께 쓰던 단어장 (단어장 창에서 골라 가져올 수 있게 남겨 둠)
  const [legacyGlossary, setLegacyGlossary] = useState(loadLegacyGlossary);

  const { glossary, mergeGlossary, removeGlossaryEntry } = useGlossary(workName);
  const { notes, saveNotes } = useWorkNotes(workName);
  // 대본에서 직접 고친 번역 — 다음 번역에 교정 예시로 반영
  const { corrections, recordCorrection, removeCorrection, clearCorrections, mergeImported: mergeImportedCorrections } = useCorrections(workName);
  // 작품 노트를 정리할 때 함께 받은 단어장 후보 (단어장에 이미 들어간 건 화면에서 숨김)
  const { candidates: storedCandidates, dismissed: dismissedCandidates, addCandidates, removeCandidate, dismissCandidate } = useGlossaryCandidates(workName);
  const glossaryCandidates = storedCandidates.filter(c => !(c.original in glossary));
  const { translationCache, updatePageResults, setPageResults, mergeTranslations, removePages, clearAll } = useTranslationCache(
    allImages,
    () => setError('저장 공간이 가득 찼습니다. 기록 삭제 후 다시 시도해주세요.'),
  );

  // 메인 엔진의 키. 작품 노트 정리도 이 엔진으로 처리
  const activeKey = mainEngine === 'gemini' ? googleKey : openaiKey;
  const settings: TranslationSettings = { mainEngine, openaiKey, openAiVersion, googleKey, geminiVersion, glossary };

  const visibleIndices = useMemo(() => getVisibleIndices(allImages, currentPageIndex, viewMode), [allImages, currentPageIndex, viewMode]);
  const translationQueue = useMemo(
    () => buildTranslationQueue(visibleIndices, allImages.length, PRELOAD_PAGE_COUNT),
    [visibleIndices, allImages.length],
  );

  const queue = useTranslationQueue({
    images: allImages,
    queue: translationQueue,
    visibleIndices,
    settings,
    translationCache,
    onPageTranslated: setPageResults,
    notes: notes?.text,
    corrections,
  });

  const applyRestoredSession = (session: RestoredSession) => {
    setAllImages(session.images);
    setLoadedFilename(session.loadedFilename);
    setDriveFileName(session.driveFileName);
    setCurrentPageIndex(session.currentPageIndex);
  };

  const { isRestoring } = useSessionPersistence({
    images: allImages,
    loadedFilename,
    driveFileName,
    currentPageIndex,
    onRestore: applyRestoredSession,
    isBusy: !!exportProgress,
  });

  // ---------- 작품 노트 (말투·호칭 기억) ----------

  const translatedPageCount = allImages.filter(img => translationCache[getCacheKey(img.file)]?.length).length;

  /** 지금까지 번역된 대사로 작품 노트를 다시 정리하고, 단어장 후보도 함께 받습니다. (메인 엔진에 요청 1회) */
  const regenerateWorkNotes = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (notesBusyRef.current || !activeKey || allImages.length === 0) return;
    const pairs = collectRecentPairs(allImages, translationCache, allImages.length, NOTES_SOURCE_PAIRS);
    if (pairs.length === 0) return;

    notesBusyRef.current = true;
    setIsGeneratingNotes(true);
    try {
      const known = Object.keys(glossary);
      const correctionSection = buildCorrectionSection(corrections);
      const result = mainEngine === 'gemini'
        ? await summarizeWorkNotes(googleKey, geminiVersion, pairs, notes?.text, correctionSection, known)
        : await summarizeWorkNotesOpenAI(openAiVersion, openaiKey, pairs, notes?.text, correctionSection, known);
      if (result.notes) saveNotes(result.notes, translatedPageCount);

      const found = filterCandidates(result.glossary, pairs.map(p => p.original), glossary, dismissedCandidates);
      if (found.length > 0) addCandidates(found, glossary);
      console.info(`[glossary] 모델 제안 ${result.glossary.length}개 중 후보 ${found.length}개 (대사에 2번 이상 나오고 단어장에 없는 것만)`);
    } catch (err: any) {
      console.warn('작품 노트 갱신 실패:', err);
      // 자동 갱신은 번역 품질을 돕는 부가 기능이라 실패해도 화면을 방해하지 않음
      if (!silent) setError(`작품 노트 갱신 실패: ${err?.message ?? err}`);
    } finally {
      notesBusyRef.current = false;
      setIsGeneratingNotes(false);
    }
  };

  // 번역이 쌓이면 노트를 자동으로 갱신 (처음 3장, 이후 10장마다)
  useEffect(() => {
    if (!autoNotes || !activeKey || allImages.length === 0) return;
    const due = notes ? translatedPageCount - notes.pageCount >= NOTES_REFRESH_PAGES : translatedPageCount >= NOTES_FIRST_PAGES;
    if (due) regenerateWorkNotes({ silent: true });
  }, [translatedPageCount, autoNotes, activeKey, notes?.pageCount]);

  const updateAutoNotes = (enabled: boolean) => {
    setAutoNotes(enabled);
    try {
      localStorage.setItem(AUTO_NOTES_STORAGE_KEY, String(enabled));
    } catch (err) {
      console.warn('설정 저장 실패:', err);
    }
  };

  // ---------- 파일 가져오기 ----------

  /**
   * 가져온 결과를 상태에 반영합니다. warnings는 문제, info는 참고 안내입니다.
   * placement: merge = 낱장 이미지 추가·첫 파일 열기(파일 이름순 정렬) / replace = 새로 열기 / append = 지금 작업 뒤에 이어 붙이기
   */
  const applyImport = (result: ImportResult, placement: 'merge' | 'replace' | 'append' = 'merge') => {
    const warnings: string[] = [];
    const info: string[] = [];
    mergeTranslations(result.translations);

    if (result.mode === 'backup') {
      setAllImages(result.images);
      setLoadedFilename(result.loadedFilename ?? null);
      setCurrentPageIndex(Math.min(result.lastReadPage || 0, Math.max(0, result.images.length - 1)));
      // 드라이브에 저장할 때는 이 백업 이름을 기본값으로 써서 같은 파일을 계속 덮어쓰게 함
      if (result.archiveFileName) setDriveFileName(result.archiveFileName);
      // 복원 후의 작품으로 저장해야 함 (지금 훅들의 작품은 아직 복원 전 작품)
      const targetIdentity = resolveWork(result.loadedFilename ?? result.images[0]?.file.name);
      const targetWork = targetIdentity.key;
      // 백업의 단어장은 그 작품의 단어장에 합침 (통째로 덮어쓰면 기존 단어장이 사라짐)
      const glossaryCount = Object.keys(result.glossary ?? {}).length;
      if (result.glossary && glossaryCount > 0) {
        if (targetWork === workName) mergeGlossary(result.glossary);
        else mergeIntoStoredGlossary(targetWork, result.glossary);
        info.push(`단어장 ${glossaryCount}개 항목을 「${targetIdentity.title}」 단어장에 합쳤습니다.`);
      }
      if (result.notes?.trim()) {
        if (targetWork === workName) saveNotes(result.notes.trim(), 0);
        else saveWorkNotes(targetWork, { text: result.notes.trim(), pageCount: 0, updatedAt: new Date().toISOString() });
        info.push('작품 노트도 함께 불러왔습니다.');
      }
      if (result.corrections?.length) {
        if (targetWork === workName) mergeImportedCorrections(result.corrections);
        else saveCorrections(targetWork, mergeCorrections(loadCorrections(targetWork), result.corrections));
        info.push(`내가 고친 번역 ${result.corrections.length}개를 불러왔습니다.`);
      }
    } else if (placement === 'replace') {
      setAllImages(result.images);
      setLoadedFilename(result.loadedFilename ?? null);
      setDriveFileName(null);
      setCurrentPageIndex(0);
      setHoveredBubble(null);
      setIsEditingBoxes(false);
    } else if (placement === 'append') {
      // 작품(단어장·노트)은 지금 작품을 그대로 쓰도록 파일 이름은 바꾸지 않음
      setAllImages(prev => appendImages(prev, result.images));
    } else {
      if (result.loadedFilename) setLoadedFilename(result.loadedFilename);
      setAllImages(prev => mergeImages(prev, result.images));
    }

    if (result.failedImages > 0) warnings.push(`이미지 ${result.failedImages}장은 읽을 수 없어 건너뛰었습니다.`);
    if (result.jsonFailed) warnings.push('번역 데이터(.json) 파일을 읽지 못했습니다.');
    return { warnings, info };
  };

  const processFiles = async (fileList: FileList | File[]) => {
    setError(null);
    try {
      const result = await importFiles(fileList);
      if (!result) {
        setError('올바른 이미지 파일이나 압축 파일(.zip, .cbz)을 업로드해주세요.');
        return;
      }
      // 이미 작업 중인데 다른 압축 파일을 열면 섞지 않고 어떻게 할지 먼저 물어봄
      if (result.mode === 'append' && result.loadedFilename && allImages.length > 0) {
        setPendingImport(result);
        return;
      }
      const { warnings } = applyImport(result);
      if (warnings.length > 0) setError(warnings.join(' '));
    } catch (err: any) {
      console.error('파일 처리 에러:', err);
      setError(`파일을 불러오는 중 오류가 발생했습니다: ${err?.message ?? err}`);
    }
  };

  const resolvePendingImport = (placement: 'replace' | 'append' | null) => {
    const result = pendingImport;
    setPendingImport(null);
    if (!result || !placement) return;
    const { warnings } = applyImport(result, placement);
    if (warnings.length > 0) setError(warnings.join(' '));
  };

  const drive = useDriveSync({
    buildBackupZip: () => createMangaZip(allImages, translationCache, currentPageIndex, glossary, notes?.text, corrections),
    defaultFilename: () => defaultBackupFilename(driveFileName, loadedFilename),
    onSaved: filename => setDriveFileName(filename),
    restoreBackup: async (zipBlob, filename) => {
      const restored = await importBackupZip(zipBlob, stripArchiveExtension(filename));
      const { warnings, info } = applyImport({ ...restored, archiveFileName: filename });
      return [warnings.length > 0 ? '불러왔지만 일부 문제가 있습니다.' : '성공적으로 불러왔습니다!', ...warnings, ...info].join('\n');
    },
  });

  // 이미지가 로드된 뒤에도 파일을 끌어다 놓으면 추가되도록 main 전체를 드롭 영역으로 사용
  const onDragOver = (e: ReactDragEvent) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragging) setIsDragging(true);
  };

  const onDragLeave = (e: ReactDragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragging(false);
  };

  const onDrop = (e: ReactDragEvent) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files);
  };

  // 드롭 영역 밖(헤더 등)에 파일을 떨어뜨려도 브라우저가 파일을 열며 페이지를 떠나지 않게 막음
  useEffect(() => {
    const preventFileNavigation = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
    };
  }, []);

  // ---------- 말풍선 편집 (모두 배열 위치가 아닌 id 기준) ----------

  const keyOf = (imgIndex: number) => getCacheKey(allImages[imgIndex].file);

  const setBubblePending = (id: string, pending: boolean) => {
    setPendingBubbleIds(prev => {
      const next = new Set(prev);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleDeleteBubble = (imgIndex: number, id: string) => {
    if (!confirm('이 번역을 삭제하시겠습니까? (오버레이 화면에서도 삭제됩니다)')) return;
    updatePageResults(keyOf(imgIndex), results => results.filter(r => r.id !== id));
  };

  const handleBoxChange = (imgIndex: number, id: string, box: Box2d) => {
    updatePageResults(keyOf(imgIndex), results => results.map(r => (r.id === id ? { ...r, box_2d: box, is_edited_box: true } : r)));
  };

  /** 덮기 ↔ 작은 딱지 전환. 자동 판별 결과와 반대로 직접 지정해 저장합니다. */
  const handleToggleDisplayMode = (imgIndex: number, id: string) => {
    updatePageResults(keyOf(imgIndex), results =>
      results.map(r => (r.id === id ? { ...r, display_mode: resolveDisplayMode(r) === 'tag' ? 'cover' : 'tag' } : r)),
    );
  };

  /** 가로쓰기 ↔ 세로쓰기 직접 지정 (자동 판별보다 우선) */
  const handleSetTextDirection = (imgIndex: number, id: string, direction: 'horizontal' | 'vertical') => {
    updatePageResults(keyOf(imgIndex), results => results.map(r => (r.id === id ? { ...r, text_direction: direction } : r)));
  };

  /** 원본 말풍선 모양에 맞춰 넣기 켜기/끄기 (자동 판별보다 우선) */
  const handleSetBubbleFit = (imgIndex: number, id: string, enabled: boolean) => {
    updatePageResults(keyOf(imgIndex), results => results.map(r => (r.id === id ? { ...r, fit_bubble: enabled } : r)));
  };

  /** 작은 딱지 위치를 직접 옮김. null이면 자동 배치로 되돌림 */
  const handleSetTagPosition = (imgIndex: number, id: string, pos: [number, number] | null) => {
    updatePageResults(keyOf(imgIndex), results => results.map(r => (r.id === id ? { ...r, tag_pos: pos ?? undefined } : r)));
  };

  /** 작은 딱지 크기를 직접 조절. null이면 기본 크기로 되돌림 */
  const handleSetTagScale = (imgIndex: number, id: string, scale: number | null) => {
    const clamped = scale === null ? undefined : Math.min(TAG_SCALE_MAX, Math.max(TAG_SCALE_MIN, scale));
    updatePageResults(keyOf(imgIndex), results => results.map(r => (r.id === id ? { ...r, tag_scale: clamped } : r)));
  };

  /** 딱지 위치·크기를 모두 자동으로 되돌림 */
  const handleResetTag = (imgIndex: number, id: string) => {
    updatePageResults(keyOf(imgIndex), results => results.map(r => (r.id === id ? { ...r, tag_pos: undefined, tag_scale: undefined } : r)));
  };

  const handleReorder = (imgIndex: number, fromIndex: number, toIndex: number) => {
    updatePageResults(keyOf(imgIndex), results => {
      const next = [...results];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleSaveEdit = (key: string, id: string, rawText: string) => {
    // 직접 고친 번역도 말줄임표 규칙을 똑같이 적용 (저장했다 다시 열었을 때 모양이 바뀌지 않도록)
    const text = normalizeEllipsis(rawText);
    const edited = translationCache[key]?.find(r => r.id === id);
    if (edited) recordCorrection(edited.original_text, edited.translated_text, text);
    updatePageResults(key, results => results.map(r => (r.id === id ? { ...r, translated_text: text } : r)));
  };

  /** 재번역·새 영역 번역에도 자동 번역과 같은 맥락(작품 노트·앞 대사·내 교정)을 넣음 */
  const settingsWithContext = (imgIndex: number): TranslationSettings => ({
    ...settings,
    ...buildContextInstruction(notes?.text, collectRecentPairs(allImages, translationCache, imgIndex), corrections),
  });

  const handleCreateBox = async (imgIndex: number, box: Box2d) => {
    const img = allImages[imgIndex];
    const key = getCacheKey(img.file);
    const hadCache = !!translationCache[key];
    const id = crypto.randomUUID();

    updatePageResults(
      key,
      results => [...results, { id, box_2d: box, original_text: '...', translated_text: '번역 중...', is_edited_box: true }],
      { persist: false, createIfMissing: true },
    );
    setBubblePending(id, true);

    try {
      const { originalText, translatedText } = await translateRegion(img, box, settingsWithContext(imgIndex));
      updatePageResults(key, results =>
        results.map(r => (r.id === id ? { ...r, original_text: originalText, translated_text: translatedText } : r)),
      );
    } catch (err: any) {
      alert('새 영역 번역 실패: ' + err.message);
      // 원래 번역이 없던 페이지면 캐시를 지워 자동 번역 대상으로 되돌림
      updatePageResults(key, results => {
        const next = results.filter(r => r.id !== id);
        return next.length === 0 && !hadCache ? null : next;
      });
    } finally {
      setBubblePending(id, false);
    }
  };

  const handleRetranslate = async (imgIndex: number, id: string, originalText: string) => {
    const key = keyOf(imgIndex);
    setBubblePending(id, true);
    try {
      const translated = await retranslateText(originalText, settingsWithContext(imgIndex));
      updatePageResults(key, results => results.map(r => (r.id === id ? { ...r, translated_text: translated } : r)));
    } catch (err: any) {
      alert('재번역 실패: ' + err.message);
    } finally {
      setBubblePending(id, false);
    }
  };

  /** 말풍선에 넘치는 번역문을 짧게 다시 번역. 결과가 오히려 길면 바꾸지 않음 */
  const handleShorten = async (imgIndex: number, id: string, maxChars: number) => {
    const key = keyOf(imgIndex);
    const target = translationCache[key]?.find(r => r.id === id);
    if (!target) return;
    setBubblePending(id, true);
    try {
      const shortened = await shortenTranslation(target.original_text, target.translated_text, maxChars, settingsWithContext(imgIndex));
      const length = (t: string) => Array.from(t.trim()).length;
      console.info(`[bubble] 짧게 다시 번역: ${length(target.translated_text)}자 → ${length(shortened)}자 (목표 ${maxChars}자)`);
      if (length(shortened) >= length(target.translated_text)) {
        alert('더 짧은 번역을 받지 못해 원래 번역을 유지합니다.');
        return;
      }
      updatePageResults(key, results => results.map(r => (r.id === id ? { ...r, translated_text: shortened } : r)));
    } catch (err: any) {
      alert('짧게 다시 번역 실패: ' + err.message);
    } finally {
      setBubblePending(id, false);
    }
  };

  const handleResumeFromEmpty = (imgIndex: number) => {
    // 현재 페이지부터 끝까지 빈 배열([])로 저장된 캐시를 지워 자동 번역을 재개
    removePages(
      allImages
        .slice(imgIndex)
        .map(img => getCacheKey(img.file))
        .filter(key => translationCache[key]?.length === 0),
    );
    queue.resumeAutoTranslate();
  };

  // ---------- 탐색 ----------

  const goToPage = (index: number) => {
    setHoveredBubble(null);
    setCurrentPageIndex(index);
  };

  const handlePrev = () => {
    if (currentPageIndex > 0) goToPage(getSpreadStartIndex(allImages, currentPageIndex - 1, viewMode));
  };

  const handleNext = () => {
    goToPage(Math.min(currentPageIndex + visibleIndices.length, allImages.length - 1));
  };

  const handleHoverBubble = (bubble: HoveredBubble | null) => {
    setHoveredBubble(bubble);
    if (bubble && scriptStyle === 'side') {
      document.getElementById(`script-${bubble.imageIndex}-${bubble.bubbleIndex}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  // ---------- 작품 이름 ----------

  /**
   * 이 파일을 어느 작품으로 볼지 직접 지정합니다. 빈 값이면 파일 이름으로 자동 판별.
   * 새 작품 쪽이 비어 있으면 지금까지의 단어장·노트·교정을 가져가고, 이미 있는 작품에 연결하면 그 작품 것을 씀.
   */
  const handleRenameWork = (title: string) => {
    const trimmed = title.trim();
    if (loadedFilename) {
      const aliases = setWorkAlias(loadedFilename, trimmed || null);
      carryOverWorkData(work.key, resolveWork(loadedFilename, aliases).key);
      setWorkAliases(aliases);
    } else {
      // 낱장 이미지는 알아볼 파일 이름이 없으므로 작품 이름을 그대로 붙여 둠 (세션 복원 때도 유지됨)
      carryOverWorkData(work.key, resolveWork(trimmed || allImages[0]?.file.name, workAliases).key);
      setLoadedFilename(trimmed || null);
    }
  };

  const handleImportLegacyGlossary = (entries: Record<string, string>) => {
    mergeGlossary(entries);
  };

  const handleClearLegacyGlossary = () => {
    if (!confirm('작품별로 나누기 전의 공통 단어장을 지울까요?\n(이미 각 작품 단어장으로 가져온 항목은 그대로 남습니다)')) return;
    clearLegacyGlossary();
    setLegacyGlossary({});
  };

  // ---------- 헤더 동작 ----------

  /** 고른 엔진·모델은 다음 실행에도 유지 */
  const remember = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      console.warn('설정 저장 실패:', err);
    }
  };

  /** 메인/서브 엔진 역할을 통째로 뒤집습니다. (예: OpenAI가 메인이었으면 Gemini가 메인으로) */
  const handleSwapEngines = () => {
    setMainEngine(prev => {
      const next = prev === 'openai' ? 'gemini' : 'openai';
      remember(MAIN_ENGINE_STORAGE_KEY, next);
      return next;
    });
  };

  const handleGeminiVersionChange = (next: GeminiVersion) => {
    setGeminiVersion(next);
    remember(GEMINI_VERSION_STORAGE_KEY, next);
  };

  const handleOpenAiVersionChange = (next: OpenAiVersion) => {
    setOpenAiVersion(next);
    remember(OPENAI_VERSION_STORAGE_KEY, next);
  };

  // 복사·붙여넣기로 앞뒤 공백·줄바꿈이 섞여 들어오는 경우가 많아 헤더 전송 전에 미리 제거
  const handleOpenaiKeyChange = (rawValue: string) => {
    const value = rawValue.trim();
    setOpenaiKey(value);
    localStorage.setItem(OPENAI_KEY_STORAGE, value);
  };

  const handleGoogleKeyChange = (rawValue: string) => {
    const value = rawValue.trim();
    setGoogleKey(value);
    localStorage.setItem(GOOGLE_KEY_STORAGE, value);
  };

  /** 지금 화면의 덮어쓰기와 같은 글자 크기로 저장하기 위한 기준 (뷰어 페이지 높이·배율·글꼴) */
  const getRenderOptions = () => ({
    displayPageHeight: Math.max(1, (window.innerHeight - VIEWER_CHROME_PX) * scale),
    viewScale: scale,
    fontFamily: getComputedStyle(document.documentElement).fontFamily,
  });

  const handleDownloadPage = async (imgIndex: number) => {
    const img = allImages[imgIndex];
    try {
      const canvas = await renderTranslatedPage(img.src, translationCache[getCacheKey(img.file)] ?? [], getRenderOptions());
      const format = exportFormatFor(img.mimeType);
      downloadBlob(await canvasToBlob(canvas, format.type, format.quality), `translated_page_${imgIndex + 1}.${format.ext}`);
    } catch (err) {
      console.error('Failed to render image:', err);
      setError('이미지 다운로드에 실패했습니다.');
    }
  };

  /**
   * 전체 페이지를 원본 해상도로 합성해 ZIP으로 내보냅니다.
   * 화면을 넘기며 캡처하지 않으므로 자동 번역(과금)을 유발하지 않고, 보기 모드와 무관하게 번역이 입혀집니다.
   */
  const handleExportAll = async () => {
    if (allImages.length === 0 || exportProgress) return;

    const images = allImages;
    const cache = translationCache;
    const untranslatedCount = images.filter(img => !cache[getCacheKey(img.file)]?.length).length;
    const confirmMsg = `총 ${images.length}장을 번역이 입혀진 고해상도 이미지로 ZIP 저장합니다.`
      + (untranslatedCount > 0 ? `\n\n⚠️ 아직 번역이 없는 ${untranslatedCount}장은 원본 그대로 들어갑니다. (추가 번역 요청은 하지 않습니다)` : '')
      + '\n\n진행하시겠습니까?';
    if (!window.confirm(confirmMsg)) return;

    setExportProgress({ done: 0, total: images.length });
    const renderOptions = getRenderOptions();
    try {
      const zip = new JSZip();
      const padLength = Math.max(3, String(images.length).length);
      let failed = 0;

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        try {
          const canvas = await renderTranslatedPage(img.src, cache[getCacheKey(img.file)] ?? [], renderOptions);
          const format = exportFormatFor(img.mimeType);
          const blob = await canvasToBlob(canvas, format.type, format.quality);
          canvas.width = 0; // 큰 캔버스 메모리를 바로 반환
          zip.file(`page_${String(i + 1).padStart(padLength, '0')}.${format.ext}`, blob);
        } catch (err) {
          console.error('Export page failed:', i + 1, err);
          failed++;
        }
        setExportProgress({ done: i + 1, total: images.length });
      }

      const content = await zip.generateAsync({ type: 'blob' });
      downloadBlob(content, loadedFilename ? `${loadedFilename}_translated.zip` : 'manga_translated.zip');
      if (failed > 0) setError(`${failed}장은 변환에 실패해 ZIP에서 제외되었습니다.`);
    } catch (err: any) {
      console.error(err);
      setError(`ZIP 내보내기 실패: ${err?.message ?? err}`);
    } finally {
      setExportProgress(null);
    }
  };

  const handleClearCache = () => {
    if (!confirm('브라우저에 자동 저장된 모든 번역 기록을 영구적으로 삭제하시겠습니까?\n\n삭제 직후 보이는 페이지가 다시 번역되며 요금이 나가는 것을 막기 위해 자동 번역이 꺼집니다.')) return;
    clearAll();
    queue.clearPageErrors();
    queue.setAutoTranslate(false);
    alert('저장된 번역 기록을 삭제했습니다.\n다시 번역하려면 상단의 [자동 번역] 버튼을 켜거나, 대본 패널에서 페이지별로 번역하세요.');
  };

  const handleCloseSession = () => {
    if (!confirm('현재 작업을 닫고 첫 화면으로 돌아갈까요?\n(번역 기록과 단어장은 남아 있어 같은 파일을 다시 열면 이어집니다)')) return;
    setAllImages([]);
    setLoadedFilename(null);
    setDriveFileName(null);
    setCurrentPageIndex(0);
    setHoveredBubble(null);
    setIsEditingBoxes(false);
  };

  // 하단 바 번역 상태 (덮어쓰기 모드에는 대본 패널이 없으므로 여기서도 보여줌)
  const visibleKeys = visibleIndices.map(i => getCacheKey(allImages[i].file));
  const visibleFailedIndex = visibleIndices.find((_, n) => {
    const key = visibleKeys[n];
    return !translationCache[key] && !!queue.pageErrors[key] && !queue.translatingKeys.has(key);
  });

  return (
    <div className="min-h-screen flex flex-col bg-gray-100 font-sans h-screen overflow-hidden">
      <AppHeader
        loadedFilename={loadedFilename}
        imageCount={allImages.length}
        viewMode={viewMode}
        onToggleViewMode={() => setViewMode(prev => (prev === '1page' ? '2page' : '1page'))}
        scriptStyle={scriptStyle}
        onScriptStyleChange={(style) => {
          setScriptStyle(style);
          if (style === 'side') setIsEditingBoxes(false);
        }}
        isEditingBoxes={isEditingBoxes}
        onToggleEditingBoxes={() => setIsEditingBoxes(prev => !prev)}
        scale={scale}
        onZoomIn={() => setScale(s => Math.min(s + 0.1, 3.0))}
        onZoomOut={() => setScale(s => Math.max(s - 0.1, 0.5))}
        onAddFiles={() => fileInputRef.current?.click()}
        exportProgress={exportProgress}
        onExportAll={handleExportAll}
        isDriveSyncing={drive.isDriveSyncing}
        driveTargetName={driveFileName}
        onSaveToDrive={drive.saveToDrive}
        onOpenGlossary={() => setGlossaryDraft({ original: '', translated: '' })}
        glossaryCandidateCount={glossaryCandidates.length}
        onOpenWorkNotes={() => setIsWorkNotesOpen(true)}
        onClearCache={handleClearCache}
        onCloseSession={handleCloseSession}
        autoTranslate={queue.autoTranslate}
        onToggleAutoTranslate={() => queue.setAutoTranslate(!queue.autoTranslate)}
        mainEngine={mainEngine}
        onSwapEngines={handleSwapEngines}
        openAiVersion={openAiVersion}
        onOpenAiVersionChange={handleOpenAiVersionChange}
        openaiKey={openaiKey}
        onOpenaiKeyChange={handleOpenaiKeyChange}
        geminiVersion={geminiVersion}
        onGeminiVersionChange={handleGeminiVersionChange}
        googleKey={googleKey}
        onGoogleKeyChange={handleGoogleKeyChange}
      />

      <main className="flex-1 flex flex-col p-4 overflow-hidden relative" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        {isDragging && allImages.length > 0 && (
          <div className="absolute inset-4 z-[60] rounded-xl border-4 border-dashed border-blue-500 bg-blue-500/10 flex items-center justify-center pointer-events-none">
            <span className="px-4 py-2 bg-white rounded-lg shadow text-blue-700 font-medium">놓으면 이미지를 추가합니다</span>
          </div>
        )}

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          multiple
          accept="image/*,application/json,.zip,.cbz"
          onChange={(e) => {
            if (e.target.files) processFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {error && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 p-3 bg-red-100 border border-red-400 text-red-700 rounded-md shadow-lg flex items-center gap-2">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 font-bold text-red-900">&times;</button>
          </div>
        )}

        {allImages.length === 0 ? (
          <EmptyState
            isDragging={isDragging}
            isRestoring={isRestoring}
            isDriveSyncing={drive.isDriveSyncing}
            onPickFiles={() => fileInputRef.current?.click()}
            onLoadFromDrive={drive.openDriveFiles}
          />
        ) : (
          <div className="flex-1 flex flex-col gap-4 h-full rounded-xl overflow-hidden">
            <div className="flex-1 flex gap-4 min-h-0">
              <MangaViewer
                images={allImages}
                visibleIndices={visibleIndices}
                viewMode={viewMode}
                scriptStyle={scriptStyle}
                scale={scale}
                onScaleChange={setScale}
                isEditingBoxes={isEditingBoxes}
                translationCache={translationCache}
                hoveredBubble={hoveredBubble}
                onHoverBubble={handleHoverBubble}
                onBoxChange={handleBoxChange}
                onToggleDisplayMode={handleToggleDisplayMode}
                onSetTextDirection={handleSetTextDirection}
                onSetTagPosition={handleSetTagPosition}
                onSetTagScale={handleSetTagScale}
                onResetTag={handleResetTag}
                onDelete={handleDeleteBubble}
                onSetBubbleFit={handleSetBubbleFit}
                onShorten={handleShorten}
                onCreateBox={handleCreateBox}
                onDownloadPage={handleDownloadPage}
                footer={
                  <PageNavigator
                    currentPageIndex={currentPageIndex}
                    totalPages={allImages.length}
                    visibleCount={visibleIndices.length}
                    onPrev={handlePrev}
                    onNext={handleNext}
                    onJumpToPage={(pageNumber) => goToPage(getSpreadStartIndex(allImages, pageNumber - 1, viewMode))}
                    isTranslating={visibleKeys.some(key => queue.translatingKeys.has(key))}
                    failedMessage={visibleFailedIndex !== undefined ? queue.pageErrors[keyOf(visibleFailedIndex)]?.message : undefined}
                    onRetryFailed={visibleFailedIndex !== undefined ? () => queue.retryPage(visibleFailedIndex) : undefined}
                  />
                }
              />

              {scriptStyle === 'side' && (
                <ScriptPanel
                  images={allImages}
                  visibleIndices={visibleIndices}
                  viewMode={viewMode}
                  translationCache={translationCache}
                  translatingKeys={queue.translatingKeys}
                  pageErrors={queue.pageErrors}
                  hasApiKey={queue.hasApiKey}
                  mainEngineLabel={mainEngine === 'gemini' ? 'Gemini' : 'OpenAI'}
                  autoTranslate={queue.autoTranslate}
                  hoveredBubble={hoveredBubble}
                  onHoverBubble={setHoveredBubble}
                  pendingBubbleIds={pendingBubbleIds}
                  onSaveEdit={handleSaveEdit}
                  onDelete={handleDeleteBubble}
                  onRetranslate={handleRetranslate}
                  onAddToGlossary={(original, translated) => setGlossaryDraft({ original, translated })}
                  onReorder={handleReorder}
                  onToggleDisplayMode={handleToggleDisplayMode}
                  onRetryPage={queue.retryPage}
                  onTranslatePage={(imgIndex) => queue.translatePages([imgIndex])}
                  onResumeFromEmpty={handleResumeFromEmpty}
                />
              )}
            </div>
          </div>
        )}
      </main>

      {glossaryDraft && (
        <GlossaryModal
          glossary={glossary}
          initialDraft={glossaryDraft}
          work={work}
          knownWorks={listKnownWorks()}
          onRenameWork={handleRenameWork}
          legacyGlossary={Object.fromEntries(Object.entries(legacyGlossary).filter(([original]) => !(original in glossary)))}
          onImportLegacy={handleImportLegacyGlossary}
          onClearLegacy={handleClearLegacyGlossary}
          onMerge={mergeGlossary}
          onRemove={removeGlossaryEntry}
          candidates={glossaryCandidates}
          onAcceptCandidate={(original, translated) => { mergeGlossary({ [original]: translated }); removeCandidate(original); }}
          onDismissCandidate={dismissCandidate}
          onClose={() => setGlossaryDraft(null)}
        />
      )}

      {isWorkNotesOpen && (
        <WorkNotesModal
          workName={work.title}
          notes={notes}
          recentPairCount={collectRecentPairs(allImages, translationCache, allImages.length, NOTES_SOURCE_PAIRS).length}
          isRegenerating={isGeneratingNotes}
          canRegenerate={!!activeKey && translatedPageCount > 0}
          autoUpdate={autoNotes}
          onSave={text => saveNotes(text)}
          onRegenerate={() => regenerateWorkNotes()}
          onToggleAutoUpdate={() => updateAutoNotes(!autoNotes)}
          corrections={corrections}
          onRemoveCorrection={removeCorrection}
          onClearCorrections={clearCorrections}
          onClose={() => setIsWorkNotesOpen(false)}
        />
      )}

      {pendingImport && (
        <ImportChoiceModal
          currentTitle={work.title}
          currentPageCount={allImages.length}
          incomingName={pendingImport.loadedFilename ?? ''}
          incomingPageCount={pendingImport.images.length}
          sameWork={resolveWork(pendingImport.loadedFilename, workAliases).key === work.key}
          onReplace={() => resolvePendingImport('replace')}
          onAppend={() => resolvePendingImport('append')}
          onCancel={() => resolvePendingImport(null)}
        />
      )}

      {drive.driveFiles && (
        <DriveModal files={drive.driveFiles} onSelect={drive.loadDriveFile} onClose={drive.closeDriveFiles} />
      )}
    </div>
  );
}

export default App;
