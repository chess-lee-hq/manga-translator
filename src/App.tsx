import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Upload, Key, Loader2, Image as ImageIcon, MessageSquareText, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, BookOpen, PanelRight, Layers, Save, Download, Cpu, AlertTriangle, Trash2, GripVertical, RefreshCw, Cloud, FolderDown, Bot, Edit2, Check, X, Zap, ZapOff } from 'lucide-react';
import JSZip from 'jszip';
import { buildCacheKey } from './lib/cacheKey';
import { translateMangaImage, retranslateTextGemini, translateGridImage } from './lib/gemini';
import { translateMangaImageOpenAI, retranslateTextOpenAI } from './lib/openai';
import { detectSpeechBubbles } from './lib/yolo';
import { createGridImageFromBoxes, loadImage, readFileAsDataURL } from './lib/imageUtils';
import { sortTextByReadingOrder } from './lib/readingOrder';
import { uploadToGoogleDrive, listMangaSaves, downloadFromGoogleDrive, createMangaZip, extractMangaZip } from './lib/drive';
import type { TranslationResult, RawTranslationResult, GridTranslationResult } from './lib/gemini';
import { basename, isImageEntryPath, mimeTypeFromPath, naturalCompare, stripArchiveExtension } from './lib/fileImport';
import { sanitizeResults } from './lib/results';
import { canvasToBlob, exportFormatFor, getDisplayBox, renderTranslatedPage } from './lib/exportCanvas';
import { downloadBlob } from './lib/download';
import { BoxEditor } from './BoxEditor';

interface UploadedImage {
  src: string;
  file: File;
  mimeType: string;
  /** 정렬 기준: ZIP 내부 전체 경로 또는 파일 이름 */
  sortKey: string;
  width: number;
  height: number;
  isSpread: boolean;
}

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTO_TRANSLATE_STORAGE_KEY = 'manga-translator-auto-translate';
/** 동시에 번역을 요청하는 페이지 수 */
const TRANSLATION_CONCURRENCY = 3;
/** 보이는 페이지 뒤로 미리 번역해 둘 페이지 수 */
const PRELOAD_PAGE_COUNT = 10;
/** API 키 입력이 멈춘 뒤 이 시간이 지나야 번역을 시작 */
const API_KEY_DEBOUNCE_MS = 800;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const hasDraggedFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

function renderFurigana(text: string) {
  if (!text) return null;
  const parts = text.split(/([一-龯]+)\(([ぁ-んァ-ヶ]+)\)/g);
  if (parts.length === 1) return text;
  
  const result = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0) {
      result.push(parts[i]);
    } else if (i % 3 === 1) {
      result.push(<ruby key={i}>{parts[i]}<rt className="text-[8px] opacity-75">{parts[i + 1]}</rt></ruby>);
      i++;
    }
  }
  return result;
}

declare global {
  interface Window {
    google: any;
  }
}

function App() {
  const [provider, setProvider] = useState<'google' | 'openai'>('google');
  // 저장된 키를 첫 렌더부터 읽어, 새로고침 직후 키 디바운스 때문에 번역이 늦게 시작되지 않게 함
  const [googleKey, setGoogleKey] = useState(() => localStorage.getItem('manga-translator-google-key') || '');
  const [openaiKey, setOpenaiKey] = useState(() => localStorage.getItem('manga-translator-openai-key') || '');
  
  const [googleClientId] = useState(() => localStorage.getItem('googleClientId') || '499460859404-ub21a3onu2807hmeei71110c5d3b4ugo.apps.googleusercontent.com');
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [isDriveSyncing, setIsDriveSyncing] = useState(false);
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [loadedFilename, setLoadedFilename] = useState<string | null>(null);
  const [driveSaves, setDriveSaves] = useState<any[]>([]);
  const [driveSearchQuery, setDriveSearchQuery] = useState('');

  const [allImages, setAllImages] = useState<UploadedImage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'1page' | '2page'>('2page');
  const [scriptStyle, setScriptStyle] = useState<'side' | 'overlay'>('side');
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [geminiVersion, setGeminiVersion] = useState<'3.6' | '3.7'>('3.6');
  const [openAiVersion, setOpenAiVersion] = useState<'sol' | 'terra'>('terra');
  const [editingBubble, setEditingBubble] = useState<{ key: string, id: string } | null>(null);
  const [editingText, setEditingText] = useState('');
  const [isEditingBoxes, setIsEditingBoxes] = useState(false);
  const [drawingBox, setDrawingBox] = useState<{imgIndex: number, startX: number, startY: number, currentX: number, currentY: number} | null>(null);
  const [draggedItem, setDraggedItem] = useState<{ imgIndex: number, itemIndex: number } | null>(null);
  
  const [glossary, setGlossary] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('manga-glossary-current');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [isGlossaryOpen, setIsGlossaryOpen] = useState(false);
  const [glossaryForm, setGlossaryForm] = useState({ original: '', translated: '' });
  // Cache key is now `${provider}-${model}-${imageIndex}`
  const [translationCache, setTranslationCache] = useState<Record<string, TranslationResult[]>>({});
  
  const updateGlossary = (newGlossary: Record<string, string>) => {
    setGlossary(newGlossary);
    try {
      localStorage.setItem('manga-glossary-current', JSON.stringify(newGlossary));
    } catch {}
  };
  /** 항목을 현재 단어장에 합칩니다. 같은 원문은 새 값으로 바뀌고 나머지 기존 항목은 유지됩니다. */
  const mergeGlossary = (entries: Record<string, string>) => {
    setGlossary(prev => {
      const next = { ...prev, ...entries };
      try {
        localStorage.setItem('manga-glossary-current', JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  // 번역 진행 상태는 페이지 번호가 아니라 캐시 키(파일) 기준으로 추적 → 이미지 추가·재정렬 중에도 중복 호출·누락 없음
  const inFlightRef = useRef<Set<string>>(new Set());
  const [translatingKeys, setTranslatingKeys] = useState<Set<string>>(() => new Set());
  // credential: 실패 당시의 제공자·키. 키를 바꾸면 실패했던 페이지도 자동으로 다시 시도함
  const [pageErrors, setPageErrors] = useState<Record<string, { message: string; credential: string }>>({});
  const [autoTranslate, setAutoTranslate] = useState(() => localStorage.getItem(AUTO_TRANSLATE_STORAGE_KEY) !== 'false');
  const [retryTrigger, setRetryTrigger] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  const [hoveredBubble, setHoveredBubble] = useState<{ imageIndex: number, bubbleIndex: number } | null>(null);
  const [scale, setScale] = useState(1.0);
  
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scriptListRef = useRef<HTMLDivElement>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load saved translation caches from LocalStorage (좌표가 깨진 항목은 걸러냄)
    const initialCache: Record<string, TranslationResult[]> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('manga-cache-')) {
        try {
          const sanitized = sanitizeResults(JSON.parse(localStorage.getItem(k) || '[]'));
          if (sanitized) initialCache[k] = sanitized;
        } catch {
          console.warn('손상된 번역 캐시를 건너뜁니다:', k);
        }
      }
    }
    setTranslationCache(initialCache);
  }, []);

  const safeSetCache = (key: string, data: any) => {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.error(e);
      setError('저장 공간이 가득 찼습니다. 기록 삭제 후 다시 시도해주세요.');
    }
  };

  /** 한 페이지의 번역 배열을 갱신하고 localStorage에도 저장합니다. 해당 페이지 캐시가 없으면 무시합니다. */
  const updatePageResults = (key: string, updater: (results: TranslationResult[]) => TranslationResult[]) => {
    setTranslationCache(prev => {
      const current = prev[key];
      if (!current) return prev;
      const next = updater(current);
      safeSetCache(key, next);
      return { ...prev, [key]: next };
    });
  };

  // 비동기 번역이 진행 중인 말풍선 id (여러 개 동시 진행 가능)
  const [pendingBubbleIds, setPendingBubbleIds] = useState<Set<string>>(() => new Set());
  const setBubblePending = (id: string, pending: boolean) => {
    setPendingBubbleIds(prev => {
      const next = new Set(prev);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const getCacheKey = useCallback((file: File) => {
    return buildCacheKey(file.name, file.size);
  }, []);

  const handleKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (provider === 'google') {
      setGoogleKey(val);
      localStorage.setItem('manga-translator-google-key', val);
    } else {
      setOpenaiKey(val);
      localStorage.setItem('manga-translator-openai-key', val);
    }
  };

  // 기존 분할 캐시들을 새로운 통합 캐시(Unified Cache)로 자동 마이그레이션
  useEffect(() => {
    if (allImages.length === 0) return;
    
    setTranslationCache(prev => {
      const next = { ...prev };
      let changed = false;
      
      allImages.forEach(img => {
        const unifiedKey = getCacheKey(img.file);

        // 마이그레이션
        if (!next[unifiedKey] || next[unifiedKey].length === 0) {
          const suffix = `-${img.file.name}-${img.file.size}`;
          const oldKeys = Object.keys(next).filter(k => k.endsWith(suffix) && k !== unifiedKey);
          
          if (oldKeys.length > 0) {
            let bestOldKey = oldKeys[0];
            for (const k of oldKeys) {
              if ((next[k] || []).length > (next[bestOldKey] || []).length) bestOldKey = k;
            }
            if (next[bestOldKey] && next[bestOldKey].length > 0) {
              next[unifiedKey] = [...next[bestOldKey]];
              changed = true;
            }
          }
        }
        
        // ID 백필
        if (next[unifiedKey]) {
          let needsUpdate = false;
          next[unifiedKey] = next[unifiedKey].map(tr => {
            if (!tr.id) {
              needsUpdate = true;
              return { ...tr, id: crypto.randomUUID() };
            }
            return tr;
          });
          
          if (needsUpdate || changed) {
            safeSetCache(unifiedKey, next[unifiedKey]);
            changed = true;
          }
        }
      });
      
      return changed ? next : prev;
    });
  }, [allImages, getCacheKey]);

  const currentKey = provider === 'google' ? googleKey : openaiKey;
  // API 키를 한 글자씩 입력하는 도중에는 번역을 시작하지 않도록, 입력이 멈춘 뒤의 값만 사용
  const liveCredential = `${provider}|${googleKey}|${openaiKey}`;
  const credential = useDebouncedValue(liveCredential, API_KEY_DEBOUNCE_MS);
  const isCredentialSettled = credential === liveCredential;

  const updateAutoTranslate = (enabled: boolean) => {
    setAutoTranslate(enabled);
    try {
      localStorage.setItem(AUTO_TRANSLATE_STORAGE_KEY, String(enabled));
    } catch {}
  };

  const loginToGoogleDrive = () => {
    return new Promise<string>((resolve, reject) => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (!oauth2) {
        reject(new Error('구글 로그인 스크립트를 아직 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'));
        return;
      }
      try {
        const client = oauth2.initTokenClient({
          client_id: googleClientId,
          scope: DRIVE_SCOPE,
          callback: (response: any) => {
            if (response.error !== undefined) {
              reject(new Error(response.error_description || response.error));
              return;
            }
            resolve(response.access_token);
          },
          // 팝업을 닫거나 열지 못한 경우. 이 콜백이 없으면 Promise가 끝나지 않아 버튼이 로딩 상태로 고정됨
          error_callback: (err: any) => {
            reject(new Error(err?.type === 'popup_closed' ? 'POPUP_CLOSED' : `구글 로그인 실패 (${err?.type ?? 'unknown'})`));
          },
        });
        client.requestAccessToken();
      } catch (err) {
        reject(err);
      }
    });
  };

  const getDriveToken = async () => {
    if (driveToken) return driveToken;
    const token = await loginToGoogleDrive();
    setDriveToken(token);
    return token;
  };

  const handleDriveError = (e: any, action: string) => {
    if (e?.message === 'POPUP_CLOSED') return; // 사용자가 팝업을 닫은 경우는 조용히 종료
    console.error(e);
    if (e?.message === 'AUTH_EXPIRED') {
      setDriveToken(null);
      alert('구글 로그인 인증이 만료되었습니다. 다시 시도해주세요.');
    } else {
      alert(`${action} 실패: ${e?.message ?? e}`);
    }
  };

  const toUploadedImage = async (file: File, src: string, sortKey: string, mimeType: string): Promise<UploadedImage> => {
    const imageObj = await loadImage(src);
    return {
      src,
      file,
      mimeType,
      sortKey,
      width: imageObj.width,
      height: imageObj.height,
      isSpread: imageObj.width > imageObj.height,
    };
  };

  /** 백업 ZIP(manga_data.json 포함)을 복원합니다. 읽지 못한 이미지 수와 합친 단어장 항목 수를 반환합니다. */
  const restoreBackupZip = async (zipBlob: Blob, name: string) => {
    const { images, translations, lastReadPage, glossary: loadedGlossary } = await extractMangaZip(zipBlob);

    const loadedImages: UploadedImage[] = [];
    let failed = 0;
    for (const img of images) {
      try {
        loadedImages.push(await toUploadedImage(img.file, img.src, img.file.name, img.mimeType));
      } catch (err) {
        console.warn('백업 이미지 로드 실패:', img.file.name, err);
        failed++;
      }
    }

    // 백업의 단어장은 현재 단어장에 합칩니다. (예전에는 통째로 덮어써서 기존 단어장이 사라졌음)
    const glossaryEntries = loadedGlossary || {};
    if (Object.keys(glossaryEntries).length > 0) mergeGlossary(glossaryEntries);
    setLoadedFilename(name);
    setAllImages(loadedImages);
    setTranslationCache(prev => ({ ...prev, ...translations }));
    Object.keys(translations).forEach(key => safeSetCache(key, translations[key]));
    setCurrentPageIndex(Math.min(lastReadPage || 0, Math.max(0, loadedImages.length - 1)));
    return { failed, mergedGlossaryCount: Object.keys(glossaryEntries).length };
  };

  const handleSaveToDrive = async () => {
    if (allImages.length === 0) {
      alert("저장할 만화가 없습니다.");
      return;
    }

    const defaultName = loadedFilename ? `${loadedFilename}.zip` : `Manga_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    const filename = window.prompt("구글 드라이브에 저장할 파일 이름을 입력해주세요 (확장자 .zip 포함):", defaultName);
    if (!filename) return;

    setIsDriveSyncing(true);
    try {
      const token = await getDriveToken();
      const zipBlob = await createMangaZip(allImages, translationCache, currentPageIndex, glossary);
      await uploadToGoogleDrive(token, zipBlob, filename);
      alert("구글 드라이브에 성공적으로 저장되었습니다!");
    } catch (e: any) {
      handleDriveError(e, '구글 드라이브 저장');
    } finally {
      setIsDriveSyncing(false);
    }
  };

  const loadDriveFileList = async () => {
    setIsDriveSyncing(true);
    try {
      const token = await getDriveToken();
      const files = await listMangaSaves(token);
      setDriveSaves(files);
      setShowDriveModal(true);
    } catch (e: any) {
      handleDriveError(e, '구글 드라이브 파일 목록 불러오기');
    } finally {
      setIsDriveSyncing(false);
    }
  };

  const handleSelectDriveFile = async (fileId: string, filename: string) => {
    setIsDriveSyncing(true);
    setShowDriveModal(false);
    try {
      const token = await getDriveToken();
      const zipBlob = await downloadFromGoogleDrive(token, fileId);
      const { failed, mergedGlossaryCount } = await restoreBackupZip(zipBlob, stripArchiveExtension(filename));
      alert(
        (failed > 0 ? `불러왔지만 이미지 ${failed}장을 읽지 못했습니다.` : "성공적으로 불러왔습니다!")
        + (mergedGlossaryCount > 0 ? `\n단어장 ${mergedGlossaryCount}개 항목을 현재 단어장에 합쳤습니다.` : ''),
      );
    } catch (e: any) {
      handleDriveError(e, '파일 불러오기');
    } finally {
      setIsDriveSyncing(false);
    }
  };


  const processFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const looseImages = files.filter(f => f.type.startsWith('image/') || isImageEntryPath(f.name));
    const jsonFile = files.find(f => f.name.toLowerCase().endsWith('.json'));
    const archiveFile = files.find(f => /\.(zip|cbz)$/i.test(f.name));

    if (looseImages.length === 0 && !archiveFile && !jsonFile) {
      setError('올바른 이미지 파일이나 압축 파일(.zip, .cbz)을 업로드해주세요.');
      return;
    }

    setError(null);

    try {
      const candidates = looseImages.map(file => ({ file, sortKey: file.webkitRelativePath || file.name }));

      if (archiveFile) {
        const zip = await JSZip.loadAsync(archiveFile);
        if (zip.file("manga_data.json")) {
          // 백업 복구용
          const { failed } = await restoreBackupZip(archiveFile, stripArchiveExtension(archiveFile.name));
          if (failed > 0) setError(`백업에서 이미지 ${failed}장을 읽지 못했습니다.`);
          return;
        }

        setLoadedFilename(stripArchiveExtension(archiveFile.name));
        // __MACOSX 메타데이터·숨김 파일은 제외하고, 확장자는 대소문자 구분 없이 판별
        const entries = Object.values(zip.files).filter(entry => !entry.dir && isImageEntryPath(entry.name));
        for (const entry of entries) {
          const blob = await entry.async("blob");
          const mimeType = mimeTypeFromPath(entry.name);
          candidates.push({
            file: new File([blob], basename(entry.name), { type: mimeType }),
            // 폴더 경로까지 정렬 기준으로 써서 ch1/001, ch2/001이 섞이지 않게 함
            sortKey: entry.name,
          });
        }
      }

      if (jsonFile) {
        try {
          const imported = JSON.parse(await jsonFile.text());
          const validEntries: Record<string, TranslationResult[]> = {};
          for (const key of Object.keys(imported)) {
            if (!key.startsWith('manga-cache-')) continue;
            const sanitized = sanitizeResults(imported[key]);
            if (sanitized) validEntries[key] = sanitized;
          }
          setTranslationCache(prev => ({ ...prev, ...validEntries }));
          Object.keys(validEntries).forEach(key => safeSetCache(key, validEntries[key]));
        } catch (err) {
          console.error("JSON 파싱 에러:", err);
          setError('번역 데이터(.json) 파일을 읽지 못했습니다.');
        }
      }

      const loadedImages: UploadedImage[] = [];
      let failed = 0;
      for (const { file, sortKey } of candidates) {
        try {
          const dataUrl = await readFileAsDataURL(file);
          loadedImages.push(await toUploadedImage(file, dataUrl, sortKey, file.type || mimeTypeFromPath(file.name)));
        } catch (err) {
          // 한 장이 깨져도 나머지는 계속 불러옴
          console.warn('이미지 로드 실패:', file.name, err);
          failed++;
        }
      }

      setAllImages(prev => {
        const combined = [...prev];
        for (const newImg of loadedImages) {
          if (!combined.some(existing => existing.file.name === newImg.file.name && existing.file.size === newImg.file.size)) {
            combined.push(newImg);
          }
        }
        combined.sort((a, b) => naturalCompare(a.sortKey, b.sortKey));
        return combined;
      });

      if (failed > 0) {
        setError(`${failed}개 파일은 이미지로 읽을 수 없어 건너뛰었습니다.`);
      }
    } catch (err: any) {
      console.error("파일 처리 에러:", err);
      setError(`파일을 불러오는 중 오류가 발생했습니다: ${err?.message ?? err}`);
    }
  };

  const visibleIndices = useMemo(() => {
    if (allImages.length === 0) return [];
    if (viewMode === '1page') return [currentPageIndex];
    if (currentPageIndex >= allImages.length) return [];
    
    // 2-page mode
    const currentImg = allImages[currentPageIndex];
    if (currentImg.isSpread) {
      return [currentPageIndex]; // 혼자 꽉 차게 렌더링
    }

    const indices = [currentPageIndex];
    if (currentPageIndex + 1 < allImages.length) {
      const nextImg = allImages[currentPageIndex + 1];
      if (!nextImg.isSpread) {
        indices.push(currentPageIndex + 1);
      }
    }
    return indices;
  }, [currentPageIndex, viewMode, allImages]);

  const translationQueue = useMemo(() => {
    if (visibleIndices.length === 0) return [];
    const needed = [...visibleIndices];
    
    for (let i = 1; i <= PRELOAD_PAGE_COUNT; i++) {
      const nextIdx = visibleIndices[visibleIndices.length - 1] + i;
      if (nextIdx < allImages.length) {
        needed.push(nextIdx);
      }
    }
    return needed;
  }, [visibleIndices, allImages.length]);

  const executeTranslation = async (img: UploadedImage): Promise<TranslationResult[]> => {
    const base64Data = img.src.split(',')[1];
    
    let rawResults: RawTranslationResult[] = [];

    // Step 1: Create an HTMLImageElement to process with YOLO and Canvas
    const imgElement = await loadImage(img.src);

    // Step 2: YOLO Detection for Panels and Speech Bubbles
    const allBoxes = await detectSpeechBubbles(imgElement);
    
    // Step 2.5: Sort text boxes using reading order algorithm
    const textBoxes = sortTextByReadingOrder(allBoxes);
    
    // If no text bubbles found, fallback to the old full-page OCR method
    if (textBoxes.length === 0) {
      console.warn("No text bubbles detected by YOLO, falling back to full page OCR.");
      if (provider === 'google') {
        if (!googleKey) throw new Error("Google API 키를 먼저 입력해주세요.");
        rawResults = await translateMangaImage(googleKey, base64Data, img.mimeType, geminiVersion, glossary);
      } else {
        if (!googleKey) throw new Error("OpenAI 모드를 사용하려면 말풍선 위치 인식을 위한 Google API 키도 반드시 입력되어야 합니다.");
        if (!openaiKey) throw new Error("OpenAI API 키를 먼저 입력해주세요.");
        const geminiResults = await translateMangaImage(googleKey, base64Data, img.mimeType, geminiVersion);
        rawResults = await translateMangaImageOpenAI(openAiVersion, openaiKey, geminiResults, geminiVersion, glossary);
      }
    } else {
      // Step 3: Create Grid Image
      const gridResult = await createGridImageFromBoxes(imgElement, textBoxes);
      if (!gridResult) return []; // Should not happen

      const gridBase64 = gridResult.dataUrl.split(',')[1];
      let gridTranslations: GridTranslationResult[] = [];

      // Step 4: Translate Grid Image with LLM
      if (provider === 'google') {
        if (!googleKey) throw new Error("Google API 키를 먼저 입력해주세요.");
        gridTranslations = await translateGridImage(googleKey, base64Data, gridBase64, img.mimeType, gridResult.cells.length, geminiVersion, glossary);
      } else {
        if (!googleKey) throw new Error("OpenAI 모드를 사용하려면 말풍선 위치 인식을 위한 Google API 키도 반드시 입력되어야 합니다.");
        if (!openaiKey) throw new Error("OpenAI API 키를 먼저 입력해주세요.");
        const geminiTranslations = await translateGridImage(googleKey, base64Data, gridBase64, img.mimeType, gridResult.cells.length, geminiVersion);
        
        // Convert to intermediate format for OpenAI pass
        let geminiResults: RawTranslationResult[] = [];
        for (const t of geminiTranslations) {
          const cell = gridResult.cells.find(c => c.id === t.id);
          if (cell) {
            geminiResults.push({
              original_text: t.original_text,
              translated_text: t.translated_text,
              box_2d: [
                (cell.box.ymin / imgElement.height) * 1000,
                (cell.box.xmin / imgElement.width) * 1000,
                (cell.box.ymax / imgElement.height) * 1000,
                (cell.box.xmax / imgElement.width) * 1000,
              ]
            });
          }
        }
        
        rawResults = await translateMangaImageOpenAI(openAiVersion, openaiKey, geminiResults, geminiVersion, glossary);
      }
      
      if (provider === 'google') {
        // Step 5: Map Grid translations back to original coordinates
        for (const t of gridTranslations) {
          const cell = gridResult.cells.find(c => c.id === t.id);
          if (cell) {
            rawResults.push({
              original_text: t.original_text,
              translated_text: t.translated_text,
              box_2d: [
                (cell.box.ymin / imgElement.height) * 1000,
                (cell.box.xmin / imgElement.width) * 1000,
                (cell.box.ymax / imgElement.height) * 1000,
                (cell.box.xmax / imgElement.width) * 1000,
              ]
            });
          }
        }
      }
    }

    const finalResults = sanitizeResults(rawResults) ?? []; // 좌표가 깨진 응답 제거 + id 부여

    // 2페이지 양면(스프레드)인 경우, 절반(x축 500)을 기준으로 우측 텍스트 배열을 전부 먼저 출력하도록 재정렬합니다.
    if (img.isSpread && finalResults.length > 0) {
      const rightPage = finalResults.filter(r => ((r.box_2d[1] + r.box_2d[3]) / 2) >= 500);
      const leftPage = finalResults.filter(r => ((r.box_2d[1] + r.box_2d[3]) / 2) < 500);
      return [...rightPage, ...leftPage];
    }
    
    return finalResults;
  };

  const handleDeleteTranslation = (imgIndex: number, id: string) => {
    if (!confirm('이 번역을 삭제하시겠습니까? (오버레이 화면에서도 삭제됩니다)')) return;
    const key = getCacheKey(allImages[imgIndex].file);
    updatePageResults(key, results => results.filter(r => r.id !== id));
  };

  const handleBoxChange = (imgIndex: number, id: string, newBox: [number, number, number, number]) => {
    const key = getCacheKey(allImages[imgIndex].file);
    updatePageResults(key, results => results.map(r => (r.id === id ? { ...r, box_2d: newBox, is_edited_box: true } : r)));
  };

  const handleToggleKeepAll = (imgIndex: number, id: string) => {
    const key = getCacheKey(allImages[imgIndex].file);
    updatePageResults(key, results => results.map(r => (r.id === id ? { ...r, disable_keep_all: !r.disable_keep_all } : r)));
  };

  const handleCreateAndTranslateBox = async (imgIndex: number, newBox2d: [number, number, number, number]) => {
    const img = allImages[imgIndex];
    const key = getCacheKey(img.file);
    // 결과는 배열 위치가 아니라 id로 찾아 갱신합니다. (대기 중 삭제·재정렬해도 다른 말풍선을 덮어쓰지 않음)
    const id = crypto.randomUUID();

    setTranslationCache(prev => ({
      ...prev,
      [key]: [
        ...(prev[key] || []),
        { id, box_2d: newBox2d, original_text: "...", translated_text: "번역 중...", is_edited_box: true },
      ],
    }));
    setBubblePending(id, true);

    try {
      // 1. Create a single-box grid image
      const imgElement = await loadImage(img.src);

      const w = img.width;
      const h = img.height;
      const ymin = (newBox2d[0] / 1000) * h;
      const xmin = (newBox2d[1] / 1000) * w;
      const ymax = (newBox2d[2] / 1000) * h;
      const xmax = (newBox2d[3] / 1000) * w;

      const singleBox = [{ xmin, ymin, xmax, ymax, classId: 3, confidence: 1 }];
      const gridResult = await createGridImageFromBoxes(imgElement, singleBox);
      if (!gridResult) throw new Error("크롭 실패");

      const gridBase64 = gridResult.dataUrl.split(',')[1];
      const fullBase64 = img.src.split(',')[1];

      let newTranslation = "";
      let newOriginalText = "...";

      if (provider === 'google') {
        if (!googleKey) throw new Error("Google API 키가 필요합니다.");
        const results = await translateGridImage(googleKey, fullBase64, gridBase64, img.mimeType, 1, geminiVersion, glossary);
        if (results && results[0]) {
          newTranslation = results[0].translated_text;
          newOriginalText = results[0].original_text || "...";
        }
      } else {
        // OpenAI fallback: Use Gemini to extract text, then OpenAI to translate
        if (!googleKey) throw new Error("새 박스 인식을 위해 Google API 키가 반드시 필요합니다.");
        if (!openaiKey) throw new Error("번역을 위해 OpenAI API 키가 필요합니다.");

        const results = await translateGridImage(googleKey, fullBase64, gridBase64, img.mimeType, 1, geminiVersion, glossary);
        if (results && results[0]) {
          newOriginalText = results[0].original_text || "...";
          if (newOriginalText !== "..." && newOriginalText.trim() !== "") {
            newTranslation = await retranslateTextOpenAI(openAiVersion, openaiKey, newOriginalText, geminiVersion, glossary);
          } else {
            newTranslation = "인식된 텍스트가 없습니다.";
          }
        }
      }

      updatePageResults(key, results =>
        results.map(r => (r.id === id ? { ...r, original_text: newOriginalText, translated_text: newTranslation } : r)),
      );
    } catch (error: any) {
      alert("새 영역 번역 실패: " + error.message);
      updatePageResults(key, results => results.filter(r => r.id !== id));
    } finally {
      setBubblePending(id, false);
    }
  };

  const handleRetranslate = async (imgIndex: number, id: string, originalText: string) => {
    const key = getCacheKey(allImages[imgIndex].file);
    setBubblePending(id, true);
    try {
      let newTranslation = "";
      if (provider === 'google') {
        if (!googleKey) throw new Error("Google API 키가 필요합니다.");
        newTranslation = await retranslateTextGemini(googleKey, originalText, geminiVersion, glossary);
      } else {
        if (!openaiKey) throw new Error("OpenAI API 키가 필요합니다.");
        newTranslation = await retranslateTextOpenAI(openAiVersion, openaiKey, originalText, geminiVersion, glossary);
      }

      updatePageResults(key, results => results.map(r => (r.id === id ? { ...r, translated_text: newTranslation } : r)));
    } catch (e: any) {
      alert("재번역 실패: " + e.message);
    } finally {
      setBubblePending(id, false);
    }
  };

  const handleSaveEdit = () => {
    if (!editingBubble) return;
    const { key, id } = editingBubble;
    const text = editingText;
    updatePageResults(key, results => results.map(r => (r.id === id ? { ...r, translated_text: text } : r)));
    setEditingBubble(null);
  };

  /**
   * 지정한 페이지들을 번역합니다. 호출 시점에 파일(캐시 키)로 고정하므로 도중에 이미지가 추가·재정렬돼도 안전합니다.
   * 동시에 TRANSLATION_CONCURRENCY장씩 처리하고, 끝난 페이지부터 바로 화면에 반영합니다.
   */
  const translatePages = async (indices: number[]) => {
    const jobs = indices
      .filter(idx => allImages[idx])
      .map(idx => ({ idx, img: allImages[idx], key: getCacheKey(allImages[idx].file) }))
      .filter(job => !inFlightRef.current.has(job.key));
    if (jobs.length === 0) return;

    const attemptCredential = credential;
    jobs.forEach(job => inFlightRef.current.add(job.key));
    setTranslatingKeys(new Set(inFlightRef.current));
    setPageErrors(prev => {
      const next = { ...prev };
      jobs.forEach(job => delete next[job.key]);
      return next;
    });

    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        try {
          const results = await executeTranslation(job.img);
          safeSetCache(job.key, results);
          setTranslationCache(prev => ({ ...prev, [job.key]: results }));
        } catch (err: any) {
          console.error(`Page ${job.idx + 1} 번역 실패:`, err);
          setPageErrors(prev => ({
            ...prev,
            [job.key]: { message: err?.message || '번역 중 오류가 발생했습니다.', credential: attemptCredential },
          }));
        } finally {
          inFlightRef.current.delete(job.key);
          setTranslatingKeys(new Set(inFlightRef.current));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(TRANSLATION_CONCURRENCY, jobs.length) }, () => worker()));
  };

  const retryPage = (imgIndex: number) => {
    translatePages([imgIndex]);
  };

  useEffect(() => {
    if (!autoTranslate || !isCredentialSettled || !currentKey || allImages.length === 0 || translationQueue.length === 0) return;

    // translationQueue는 보이는 페이지가 앞에 오므로 그 순서대로 처리됨
    const missingIndices = translationQueue.filter(i => {
      const key = getCacheKey(allImages[i].file);
      const failure = pageErrors[key];
      // 같은 키로 이미 실패한 페이지는 자동으로 다시 부르지 않음 (반복 실패·과금 방지). 키를 바꾸거나 '다시 시도'로 재요청
      return !translationCache[key] && !inFlightRef.current.has(key) && !(failure && failure.credential === credential);
    });

    if (missingIndices.length > 0) translatePages(missingIndices);
  }, [translationQueue.join(','), allImages, credential, isCredentialSettled, autoTranslate, retryTrigger]);

  // 이미지가 로드된 뒤에도 파일을 끌어다 놓으면 추가되도록 main 전체를 드롭 영역으로 사용
  const onDragOver = (e: React.DragEvent) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragging) setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
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

  // 이미지는 새로고침하면 사라지므로 작업 중 페이지 이탈 시 경고
  const hasImages = allImages.length > 0;
  useEffect(() => {
    if (!hasImages) return;
    const warnBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasImages]);

  const scrollToScript = (imgIdx: number, bubbleIdx: number) => {
    if (scriptListRef.current && scriptStyle === 'side') {
      const id = `script-${imgIdx}-${bubbleIdx}`;
      const element = document.getElementById(id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  };

  const handleZoomIn = () => setScale(s => Math.min(s + 0.1, 3.0));
  const handleZoomOut = () => setScale(s => Math.max(s - 0.1, 0.5));

  // Ctrl/⌘ + 휠(트랙패드 핀치) 확대. React의 onWheel은 passive라 preventDefault가 안 돼 브라우저 화면까지 같이 확대됐음
  useEffect(() => {
    const el = viewerContainerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setScale(s => (e.deltaY < 0 ? Math.min(s + 0.1, 3.0) : Math.max(s - 0.1, 0.5)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasImages]);

  const handlePanStart = (e: React.MouseEvent) => {
    if (!viewerContainerRef.current) return;
    setIsPanning(true);
    panStart.current = {
      x: e.pageX - viewerContainerRef.current.offsetLeft,
      y: e.pageY - viewerContainerRef.current.offsetTop,
      scrollLeft: viewerContainerRef.current.scrollLeft,
      scrollTop: viewerContainerRef.current.scrollTop
    };
  };

  const handlePanMove = (e: React.MouseEvent) => {
    if (!isPanning || !viewerContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - viewerContainerRef.current.offsetLeft;
    const y = e.pageY - viewerContainerRef.current.offsetTop;
    const walkX = (x - panStart.current.x) * 1.5;
    const walkY = (y - panStart.current.y) * 1.5;
    viewerContainerRef.current.scrollLeft = panStart.current.scrollLeft - walkX;
    viewerContainerRef.current.scrollTop = panStart.current.scrollTop - walkY;
  };

  const handlePanEnd = () => {
    setIsPanning(false);
  };

    const getSpreadStartIndex = (targetIndex: number) => {
    if (viewMode === '1page') return targetIndex;
    let i = 0;
    let lastStart = 0;
    while (i <= targetIndex) {
      lastStart = i;
      if (allImages[i].isSpread) {
        if (i === targetIndex) break;
        i += 1;
      } else if (i + 1 < allImages.length && !allImages[i + 1].isSpread) {
        if (i === targetIndex || i + 1 === targetIndex) break;
        i += 2;
      } else {
        if (i === targetIndex) break;
        i += 1;
      }
    }
    return lastStart;
  };

  const handlePrev = () => {
    setCurrentPageIndex(prev => {
      if (prev === 0) return 0;
      setHoveredBubble(null);
      return getSpreadStartIndex(prev - 1);
    });
  };

  const handleNext = () => {
    setCurrentPageIndex(prev => {
      const advance = visibleIndices.length;
      setHoveredBubble(null);
      return Math.min(prev + advance, allImages.length - 1);
    });
  };



  const handleExportJSON = () => {
    const currentKeys = new Set(allImages.map(img => getCacheKey(img.file)));
    const exportData: Record<string, any> = {};
    for (const key of Object.keys(translationCache)) {
      if (currentKeys.has(key)) {
        exportData[key] = translationCache[key];
      }
    }
    const data = JSON.stringify(exportData, null, 2);
    downloadBlob(new Blob([data], { type: 'application/json' }), 'manga_translation_data.json');
  };

  const handleClearCache = () => {
    if (!confirm('브라우저에 자동 저장된 모든 번역 기록을 영구적으로 삭제하시겠습니까?\n\n삭제 직후 보이는 페이지가 다시 번역되며 요금이 나가는 것을 막기 위해 자동 번역이 꺼집니다.')) return;
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('manga-cache-')) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    setTranslationCache({});
    setPageErrors({});
    updateAutoTranslate(false);
    alert('저장된 번역 기록을 삭제했습니다.\n다시 번역하려면 상단의 [자동 번역] 버튼을 켜거나, 대본 패널에서 페이지별로 번역하세요.');
  };

  const handleScriptDragStart = (e: React.DragEvent, imgIndex: number, itemIndex: number) => {
    setDraggedItem({ imgIndex, itemIndex });
    if (e.target instanceof HTMLElement) {
      e.target.style.opacity = '0.5';
    }
  };

  const handleScriptDragEnd = (e: React.DragEvent) => {
    if (e.target instanceof HTMLElement) {
      e.target.style.opacity = '1';
    }
    setDraggedItem(null);
  };

  const handleScriptDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleScriptDrop = (e: React.DragEvent, targetImgIndex: number, targetItemIndex: number) => {
    e.preventDefault();
    if (!draggedItem) return;
    if (draggedItem.imgIndex !== targetImgIndex) return; 
    if (draggedItem.itemIndex === targetItemIndex) return; 

    setTranslationCache(prev => {
      const img = allImages[targetImgIndex];
      const key = getCacheKey(img.file);
      const results = [...(prev[key] || [])];
      
      const [movedItem] = results.splice(draggedItem.itemIndex, 1);
      results.splice(targetItemIndex, 0, movedItem);
      
      safeSetCache(key, results);
      
      return {
        ...prev,
        [key]: results
      };
    });
    setDraggedItem(null);
  };

  const handleDownloadImage = async (imgIndex: number) => {
    const img = allImages[imgIndex];
    try {
      const canvas = await renderTranslatedPage(img.src, translationCache[getCacheKey(img.file)] ?? []);
      const format = exportFormatFor(img.mimeType);
      const blob = await canvasToBlob(canvas, format.type, format.quality);
      downloadBlob(blob, `translated_page_${imgIndex + 1}.${format.ext}`);
    } catch (err) {
      console.error("Failed to render image:", err);
      setError("이미지 다운로드에 실패했습니다.");
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
    const confirmMsg = `총 ${images.length}장을 번역이 입혀진 원본 해상도 이미지로 ZIP 저장합니다.`
      + (untranslatedCount > 0 ? `\n\n⚠️ 아직 번역이 없는 ${untranslatedCount}장은 원본 그대로 들어갑니다. (추가 번역 요청은 하지 않습니다)` : '')
      + '\n\n진행하시겠습니까?';
    if (!window.confirm(confirmMsg)) return;

    setExportProgress({ done: 0, total: images.length });
    try {
      const zip = new JSZip();
      const padLength = Math.max(3, String(images.length).length);
      let failed = 0;

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        try {
          const canvas = await renderTranslatedPage(img.src, cache[getCacheKey(img.file)] ?? []);
          const format = exportFormatFor(img.mimeType);
          const blob = await canvasToBlob(canvas, format.type, format.quality);
          canvas.width = 0; // 큰 캔버스 메모리를 바로 반환
          zip.file(`page_${String(i + 1).padStart(padLength, '0')}.${format.ext}`, blob);
        } catch (err) {
          console.error("Export page failed:", i + 1, err);
          failed++;
        }
        setExportProgress({ done: i + 1, total: images.length });
      }

      const content = await zip.generateAsync({ type: "blob" });
      downloadBlob(content, loadedFilename ? `${loadedFilename}_translated.zip` : `manga_translated.zip`);
      if (failed > 0) setError(`${failed}장은 변환에 실패해 ZIP에서 제외되었습니다.`);
    } catch (err: any) {
      console.error(err);
      setError(`ZIP 내보내기 실패: ${err?.message ?? err}`);
    } finally {
      setExportProgress(null);
    }
  };

  // 하단 바 번역 상태 (덮어쓰기 모드에는 대본 패널이 없으므로 여기서도 보여줌)
  const visibleKeys = visibleIndices.filter(i => allImages[i]).map(i => getCacheKey(allImages[i].file));
  const visibleIsTranslating = visibleKeys.some(k => translatingKeys.has(k));
  const visibleFailedIndex = visibleIndices.find(i => {
    const k = allImages[i] ? getCacheKey(allImages[i].file) : '';
    return !!k && !translationCache[k] && !!pageErrors[k] && !translatingKeys.has(k);
  });
  const visibleFailedMessage = visibleFailedIndex !== undefined ? pageErrors[getCacheKey(allImages[visibleFailedIndex].file)]?.message : undefined;

  return (
    <div className="min-h-screen flex flex-col bg-gray-100 font-sans h-screen overflow-hidden">
        <header className="bg-white shadow-sm border-b px-4 py-2 flex items-center justify-between z-10 shrink-0 w-full overflow-x-auto [&::-webkit-scrollbar]:hidden">
        <div className="flex items-center gap-2 shrink-0">
          <ImageIcon className="text-blue-600 shrink-0" size={24} />
          <h1 className="text-lg font-bold text-gray-800 mr-2 whitespace-nowrap shrink-0">Manga Translator</h1>
          {loadedFilename && (
            <span className="text-xs bg-indigo-100 text-indigo-700 font-medium px-2 py-0.5 rounded-full border border-indigo-200 mr-2 whitespace-nowrap shrink-0">
              📂 {loadedFilename}
            </span>
          )}
          
          {allImages.length > 0 && (
            <>
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0">
                총 {allImages.length}장
              </span>
              
              <div className="w-px h-5 bg-gray-300 mx-1 shrink-0"></div>
              
              <button 
                onClick={() => setViewMode(prev => prev === '1page' ? '2page' : '1page')}
                className="flex items-center gap-1.5 px-3 py-1 bg-gray-50 hover:bg-gray-100 rounded-md transition-colors text-xs font-medium border border-gray-200 whitespace-nowrap text-gray-700 shrink-0"
              >
                <BookOpen size={14} />
                {viewMode === '1page' ? '1장' : '2장'}
              </button>
              
              <div className="flex bg-gray-100 p-0.5 rounded-md border border-gray-200 shrink-0">
                <button
                  onClick={() => setScriptStyle('overlay')}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-all ${
                    scriptStyle === 'overlay' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Layers size={14} /> 덮어쓰기
                </button>
                <button
                  onClick={() => { setScriptStyle('side'); setIsEditingBoxes(false); }}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-all ${
                    scriptStyle === 'side' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <PanelRight size={14} /> 우측 대본
                </button>
              </div>

              {scriptStyle === 'overlay' && (
                <button
                  onClick={() => setIsEditingBoxes(prev => !prev)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors text-xs font-medium border whitespace-nowrap shrink-0 ${
                    isEditingBoxes ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <GripVertical size={14} /> 영역 수정
                </button>
              )}

              <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 rounded-md border border-gray-200 shrink-0 ml-1">
                <button onClick={handleZoomOut} className="p-0.5 hover:bg-gray-200 rounded text-gray-600">
                  <ZoomOut size={14} />
                </button>
                <span className="text-xs font-medium w-9 text-center text-gray-700">
                  {Math.round(scale * 100)}%
                </span>
                <button onClick={handleZoomIn} className="p-0.5 hover:bg-gray-200 rounded text-gray-600">
                  <ZoomIn size={14} />
                </button>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 pl-4">
          {allImages.length > 0 && (
            <>
              <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium border border-blue-200 hover:bg-blue-100 shrink-0">
                <Upload size={14} /> 추가
              </button>
              <button onClick={handleExportAll} disabled={!!exportProgress} title="번역이 입혀진 전체 페이지를 원본 해상도로 ZIP 저장" className="flex items-center gap-1 px-2 py-1 bg-orange-50 text-orange-700 rounded text-xs font-medium border border-orange-200 hover:bg-orange-100 disabled:opacity-50 shrink-0">
                {exportProgress ? <><Loader2 size={14} className="animate-spin" /> {exportProgress.done}/{exportProgress.total}</> : <><Download size={14} /> ZIP</>}
              </button>
              <button onClick={handleExportJSON} className="flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-medium border border-green-200 hover:bg-green-100 shrink-0">
                <Save size={14} /> JSON
              </button>
              <button onClick={handleSaveToDrive} disabled={isDriveSyncing} className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium border border-blue-200 hover:bg-blue-100 disabled:opacity-50 shrink-0">
                {isDriveSyncing ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />} 드라이브
              </button>
              <button onClick={() => setIsGlossaryOpen(true)} className="flex items-center gap-1 px-2 py-1 bg-purple-50 text-purple-700 rounded text-xs font-medium border border-purple-200 hover:bg-purple-100 shrink-0">
                <BookOpen size={14} /> 단어장
              </button>
              <button onClick={handleClearCache}
              className="px-3 py-1.5 text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 rounded-md transition-colors"
            >
              기록 삭제
              </button>
              
              <div className="w-px h-5 bg-gray-300 mx-1 shrink-0"></div>
            </>
          )}

          <button
            onClick={() => updateAutoTranslate(!autoTranslate)}
            title={autoTranslate ? '페이지를 넘기면 보이는 페이지와 다음 페이지들을 자동으로 번역합니다. 클릭하면 끕니다.' : '자동 번역이 꺼져 있습니다. 대본 패널에서 페이지별로 번역할 수 있습니다.'}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border whitespace-nowrap shrink-0 ${autoTranslate ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200'}`}
          >
            {autoTranslate ? <Zap size={12} /> : <ZapOff size={12} />} 자동 번역 {autoTranslate ? 'ON' : 'OFF'}
          </button>

          <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200 shadow-inner shrink-0 items-center">
            <button onClick={() => setProvider('google')} className={`flex items-center gap-1 text-xs pl-2 pr-1 py-1 rounded-l transition-all font-medium ${provider === 'google' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>
              <Cpu size={12} /> Gemini
            </button>
            <select 
              value={geminiVersion}
              onChange={(e) => { setGeminiVersion(e.target.value as '3.6' | '3.7'); setProvider('google'); }}
              className={`text-xs py-1 pr-1 pl-0.5 rounded-r outline-none cursor-pointer border-l ${provider === 'google' ? 'bg-white shadow-sm text-blue-600 border-blue-100' : 'bg-transparent text-gray-500 border-gray-300'}`}
            >
              <option value="3.6">3.6 Flash</option>
              <option value="3.7">3.7 Flash</option>
            </select>
            
            <div className="w-px h-3 bg-gray-300 mx-1"></div>
            
            <button onClick={() => setProvider('openai')} className={`flex items-center gap-1 text-xs pl-2 pr-1 py-1 rounded-l transition-all font-medium ${provider === 'openai' ? 'bg-white shadow-sm text-green-600' : 'text-gray-500'}`}>
              <Bot size={12} /> OpenAI 5.6
            </button>
            <select 
              value={openAiVersion}
              onChange={(e) => { setOpenAiVersion(e.target.value as 'sol' | 'terra'); setProvider('openai'); }}
              className={`text-xs py-1 pr-1 pl-0.5 rounded-r outline-none cursor-pointer border-l ${provider === 'openai' ? 'bg-white shadow-sm text-green-600 border-green-100' : 'bg-transparent text-gray-500 border-gray-300'}`}
            >
              <option value="sol">Sol</option>
              <option value="terra">Terra</option>
            </select>
          </div>

          <div className="flex items-center shrink-0">
            <Key size={14} className="text-gray-400 absolute ml-2 pointer-events-none" />
            <input
              type="password"
              placeholder="API Key"
              value={currentKey}
              onChange={handleKeyChange}
              autoComplete="new-password"
              data-1p-ignore="true"
              data-lpignore="true"
              spellCheck="false"
              className={`border rounded-md pl-7 pr-2 py-1 text-xs w-28 focus:w-48 transition-all focus:outline-none focus:ring-1 ${provider === 'google' ? 'focus:ring-blue-500' : 'focus:ring-green-500'}`}
            />
          </div>
        </div>
      </header>

      <main
        className="flex-1 flex flex-col p-4 overflow-hidden relative"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
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
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />

        {error && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 p-3 bg-red-100 border border-red-400 text-red-700 rounded-md shadow-lg flex items-center gap-2">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 font-bold text-red-900">&times;</button>
          </div>
        )}

        {allImages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6">
            <div
              className={`w-full max-w-2xl h-80 border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-colors ${
                isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:bg-gray-50'
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={48} className="text-gray-400 mb-4" />
              <p className="text-lg font-medium text-gray-600">여러 장의 이미지를 드래그하여 업로드하세요</p>
              <p className="text-sm text-gray-400 mt-1">이전에 다운받은 .json 데이터 파일을 같이 올리면 즉시 복원됩니다.</p>
            </div>
            
            <div className="flex items-center gap-4 mt-4">
              <span className="text-gray-400 text-sm">또는</span>
              <button
                onClick={loadDriveFileList}
                disabled={isDriveSyncing}
                className="flex items-center gap-2 px-6 py-3 bg-white border-2 border-blue-200 text-blue-600 rounded-xl hover:bg-blue-50 transition-colors font-medium shadow-sm disabled:opacity-50"
              >
                {isDriveSyncing ? <Loader2 size={20} className="animate-spin" /> : <FolderDown size={20} />}
                구글 드라이브에서 세이브 불러오기
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col gap-4 h-full rounded-xl overflow-hidden">

            <div className="flex-1 flex gap-4 min-h-0">
              
              <div className={`flex flex-col h-full bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden relative transition-all duration-300 ${scriptStyle === 'side' ? 'flex-1 min-w-0' : 'flex-1 w-full'}`}>
                <div 
                  ref={viewerContainerRef}
                  className={`flex-1 overflow-auto bg-gray-800 ${isPanning ? 'cursor-grabbing' : 'cursor-grab'} [&::-webkit-scrollbar]:hidden`}
                  style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  onMouseDown={handlePanStart}
                  onMouseMove={handlePanMove}
                  onMouseUp={handlePanEnd}
                  onMouseLeave={handlePanEnd}
                >
                  <div className="min-w-full min-h-full flex flex-col" style={{ width: 'max-content', height: 'max-content' }}>
                    <div className="flex-1 min-h-[3rem]"></div>
                    <div className="flex flex-row">
                      <div className="flex-1 min-w-[3rem]"></div>
                      <div 
                        className={`flex ${viewMode === '2page' ? 'flex-row-reverse' : 'flex-row'} gap-4 transition-all duration-200`}
                      >
                    {visibleIndices.map((imgIndex) => {
                      const img = allImages[imgIndex];
                      const key = getCacheKey(img.file);
                      const results = translationCache[key] || [];

                      return (
                        <div key={imgIndex} className="relative shadow-2xl bg-white select-none flex-shrink-0 group">
                          <div id={`manga-page-${imgIndex}`} className="relative bg-white">
                            {isEditingBoxes && (
                              <div
                                className="absolute inset-0 z-40 cursor-crosshair"
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const x = ((e.clientX - rect.left) / rect.width) * 1000;
                                  const y = ((e.clientY - rect.top) / rect.height) * 1000;
                                  setDrawingBox({ imgIndex, startX: x, startY: y, currentX: x, currentY: y });
                                }}
                                onPointerMove={(e) => {
                                  if (!drawingBox || drawingBox.imgIndex !== imgIndex) return;
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const x = ((e.clientX - rect.left) / rect.width) * 1000;
                                  const y = ((e.clientY - rect.top) / rect.height) * 1000;
                                  setDrawingBox(prev => prev ? { ...prev, currentX: x, currentY: y } : null);
                                }}
                                onPointerUp={(e) => {
                                  if (!drawingBox || drawingBox.imgIndex !== imgIndex) return;
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const endX = ((e.clientX - rect.left) / rect.width) * 1000;
                                  const endY = ((e.clientY - rect.top) / rect.height) * 1000;
                                  
                                  const xmin = Math.min(drawingBox.startX, endX);
                                  const xmax = Math.max(drawingBox.startX, endX);
                                  const ymin = Math.min(drawingBox.startY, endY);
                                  const ymax = Math.max(drawingBox.startY, endY);
                                  
                                  setDrawingBox(null);
                                  
                                  // 너무 작은 박스는 무시
                                  if (xmax - xmin < 20 || ymax - ymin < 20) return;
                                  
                                  handleCreateAndTranslateBox(imgIndex, [ymin, xmin, ymax, xmax]);
                                }}
                                onPointerLeave={() => {
                                  if (drawingBox && drawingBox.imgIndex === imgIndex) {
                                    setDrawingBox(null);
                                  }
                                }}
                              />
                            )}
                            
                            {drawingBox && drawingBox.imgIndex === imgIndex && (
                              <div
                                className="absolute border-2 border-blue-500 bg-blue-500/20 z-50 pointer-events-none"
                                style={{
                                  left: `${Math.min(drawingBox.startX, drawingBox.currentX) / 10}%`,
                                  top: `${Math.min(drawingBox.startY, drawingBox.currentY) / 10}%`,
                                  width: `${Math.abs(drawingBox.currentX - drawingBox.startX) / 10}%`,
                                  height: `${Math.abs(drawingBox.currentY - drawingBox.startY) / 10}%`,
                                }}
                              />
                            )}

                            <img
                              src={img.src}
                              alt={`Manga Page ${imgIndex + 1}`}
                              className="block transition-all duration-200"
                              style={{ height: `calc((100vh - 250px) * ${scale})`, width: 'auto', objectFit: 'contain' }}
                              draggable={false}
                            />
                            
                            {results.map((result, bubbleIndex) => {
                              const [newYmin, newXmin, displayYmax, displayXmax] = getDisplayBox(result);
                              const expandedWidth = displayXmax - newXmin;
                              const expandedHeight = displayYmax - newYmin;

                              const top = `${(newYmin / 1000) * 100}%`;
                              const left = `${(newXmin / 1000) * 100}%`;
                              const height = `${(expandedHeight / 1000) * 100}%`;
                              const width = `${(expandedWidth / 1000) * 100}%`;

                              const isHovered = hoveredBubble?.imageIndex === imgIndex && hoveredBubble?.bubbleIndex === bubbleIndex;

                              if (scriptStyle === 'overlay') {
                                const aspect = expandedWidth / expandedHeight;
                                const textLen = Math.max(1, result.translated_text.length);
                                
                                const charsPerLine = Math.max(1, Math.sqrt(textLen * aspect));
                                const lines = Math.max(1, textLen / charsPerLine);

                                const maxCqi = (100 / charsPerLine) * 0.85;
                                const maxCqh = (100 / (lines * 1.15)) * 0.9;

                                const textContent = (
                                  <span 
                                    className="bg-white text-gray-900 rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.15)] flex flex-col items-center justify-center"
                                    style={{
                                      fontSize: `clamp(${13 * scale}px, min(${maxCqi}cqi, ${maxCqh}cqh), ${28 * scale}px)`,
                                      fontWeight: '800',
                                      lineHeight: '1.15', 
                                      wordBreak: result.disable_keep_all ? 'break-all' : 'keep-all', 
                                      lineBreak: result.disable_keep_all ? 'anywhere' : 'auto',
                                      whiteSpace: 'pre-wrap',
                                      overflowWrap: 'break-word',
                                      textAlign: 'center',
                                      letterSpacing: '-0.02em',
                                      minWidth: '100%',
                                      maxWidth: '200%',
                                      minHeight: '100%',
                                      padding: '4px 8px' 
                                    }}
                                  >
                                    {result.translated_text}
                                  </span>
                                );

                                if (isEditingBoxes) {
                                  return (
                                    <BoxEditor
                                      key={result.id}
                                      initialBox={[newYmin, newXmin, newYmin + expandedHeight, newXmin + expandedWidth]}
                                      onChange={(newBox: [number, number, number, number]) => handleBoxChange(imgIndex, result.id, newBox)}
                                      isKeepAll={!result.disable_keep_all}
                                      onToggleKeepAll={() => handleToggleKeepAll(imgIndex, result.id)}
                                    >
                                      {textContent}
                                    </BoxEditor>
                                  );
                                }

                                return (
                                  <div
                                    key={result.id}
                                    className="absolute flex flex-col items-center justify-center pointer-events-auto"
                                    style={{
                                      top, left, height, width,
                                      containerType: 'size',
                                      zIndex: 20
                                    }}
                                  >
                                    {textContent}
                                  </div>
                                );
                              }

                              return (
                                <div
                                  key={result.id}
                                  onMouseEnter={() => {
                                    setHoveredBubble({ imageIndex: imgIndex, bubbleIndex });
                                    scrollToScript(imgIndex, bubbleIndex);
                                  }}
                                  onMouseLeave={() => setHoveredBubble(null)}
                                  className={`absolute border-2 cursor-crosshair transition-all duration-200 rounded-sm pointer-events-auto ${
                                    isHovered 
                                      ? 'border-yellow-400 bg-yellow-400/30 z-30 shadow-[0_0_20px_rgba(250,204,21,0.8)]' 
                                      : 'border-transparent bg-white/1 hover:border-blue-300 hover:bg-blue-300/20 z-20'
                                  }`}
                                  style={{ top, left, height, width }}
                                />
                              );
                            })}
                          </div>
                          
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownloadImage(imgIndex); }}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="absolute top-4 right-4 bg-black bg-opacity-60 hover:bg-blue-600 text-white p-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50 flex items-center gap-2"
                            title="이 페이지를 번역이 입혀진 이미지로 다운로드"
                          >
                            <Download size={20} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex-1 min-w-[3rem]"></div>
                </div>
                <div className="flex-1 min-h-[3rem]"></div>
              </div>
            </div>

            <div className="bg-gray-100 border-t p-3 flex justify-between items-center shrink-0">
                  <button 
                    onClick={handleNext} 
                    disabled={currentPageIndex + visibleIndices.length >= allImages.length}
                    className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium text-gray-700"
                  >
                    <ChevronLeft size={20} /> 다음 페이지
                  </button>
                  
                  <div className="font-semibold text-gray-600 bg-white px-3 py-1.5 rounded-full border shadow-inner flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={allImages.length}
                      value={currentPageIndex + 1}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val) && val >= 1 && val <= allImages.length) {
                          setCurrentPageIndex(getSpreadStartIndex(val - 1));
                        }
                      }}
                      className="w-16 text-center border border-gray-300 rounded py-0.5 px-1 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm font-medium"
                    />
                    {visibleIndices.length > 1 ? (
                      <span>- {currentPageIndex + 2} / {allImages.length}</span>
                    ) : (
                      <span>/ {allImages.length}</span>
                    )}
                    {visibleIsTranslating && (
                      <span className="flex items-center gap-1 text-xs text-blue-600 font-medium">
                        <Loader2 size={12} className="animate-spin" /> 번역 중
                      </span>
                    )}
                    {visibleFailedIndex !== undefined && (
                      <button
                        onClick={() => retryPage(visibleFailedIndex)}
                        title={visibleFailedMessage}
                        className="flex items-center gap-1 text-xs text-red-600 font-medium hover:underline"
                      >
                        <AlertTriangle size={12} /> 번역 실패 · 다시 시도
                      </button>
                    )}
                  </div>

                  <button 
                    onClick={handlePrev} 
                    disabled={currentPageIndex === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium text-gray-700"
                  >
                    이전 페이지 <ChevronRight size={20} />
                  </button>
                </div>
              </div>

              {scriptStyle === 'side' && (
                <div className="w-[450px] shrink-0 flex flex-col h-full bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden transition-all duration-300">
                  <div className="p-3 border-b border-gray-200 bg-gray-50 flex justify-between items-center shrink-0">
                    <span className="font-semibold text-gray-700 flex items-center gap-2">
                      <MessageSquareText size={18} /> 한국어 대본
                    </span>
                    {translatingKeys.size > 0 && (
                      <div className="flex items-center text-sm text-blue-600 font-medium bg-blue-50 px-2 py-1 rounded-md border border-blue-100">
                        <Loader2 className="animate-spin mr-2" size={16} />
                        번역 중 ({translatingKeys.size}장)
                      </div>
                    )}
                  </div>
                  
                  <div 
                    className="flex-1 overflow-y-auto p-4 bg-white space-y-4" 
                    ref={scriptListRef}
                  >
                    {visibleIndices.map((imgIndex, idxInVisible) => {
                      let bubbleOffset = 0;
                      for (let i = 0; i < idxInVisible; i++) {
                        const prevKey = getCacheKey(allImages[visibleIndices[i]].file);
                        bubbleOffset += (translationCache[prevKey] || []).length;
                      }
                      const img = allImages[imgIndex];
                      const key = getCacheKey(img.file);
                      const results = translationCache[key];
                      if (!results) {
                        const pageError = pageErrors[key];
                        return (
                          <div key={`loading-${imgIndex}`} className="flex flex-col items-center justify-center py-10 px-4 text-center text-gray-400">
                            {translatingKeys.has(key) ? (
                              <>
                                <Loader2 className="animate-spin mb-2" size={24} />
                                <span className="text-sm">Page {imgIndex + 1} 번역 중...</span>
                              </>
                            ) : pageError ? (
                              <>
                                <AlertTriangle className="text-red-400 mb-2" size={24} />
                                <span className="text-sm text-red-500 font-medium">Page {imgIndex + 1} 번역 실패</span>
                                <span className="text-xs text-red-400 mt-1 break-all">{pageError.message}</span>
                                <button onClick={() => retryPage(imgIndex)} className="mt-3 px-3 py-1 bg-gray-100 rounded text-xs text-gray-600 hover:bg-gray-200">
                                  다시 시도
                                </button>
                              </>
                            ) : !currentKey ? (
                              <>
                                <Key className="mb-2" size={24} />
                                <span className="text-sm">상단에 {provider === 'google' ? 'Gemini' : 'OpenAI'} API 키를 입력하면 번역이 시작됩니다.</span>
                              </>
                            ) : !autoTranslate ? (
                              <>
                                <ZapOff className="mb-2" size={24} />
                                <span className="text-sm">자동 번역이 꺼져 있습니다.</span>
                                <button onClick={() => translatePages([imgIndex])} className="mt-3 px-3 py-1 bg-blue-50 text-blue-600 rounded text-xs font-medium hover:bg-blue-100">
                                  이 페이지만 번역
                                </button>
                              </>
                            ) : (
                              <>
                                <Loader2 className="animate-spin mb-2" size={24} />
                                <span className="text-sm">Page {imgIndex + 1} 번역 대기 중...</span>
                              </>
                            )}
                          </div>
                        );
                      }
                      if (results.length === 0) {
                        return (
                          <div key={`empty-${imgIndex}`} className="py-8 flex flex-col items-center justify-center text-gray-400">
                            <span className="text-sm mb-3">Page {imgIndex + 1}: 번역된 텍스트가 없습니다.</span>
                            <button 
                              onClick={() => {
                                // 현재 페이지부터 마지막 페이지까지 빈 배열([])로 저장된 캐시를 지워 자동 번역을 재개합니다.
                                const emptyKeys = allImages
                                  .slice(imgIndex)
                                  .map(im => getCacheKey(im.file))
                                  .filter(k => translationCache[k]?.length === 0);
                                emptyKeys.forEach(k => localStorage.removeItem(k));
                                setTranslationCache(prev => {
                                  const updated = { ...prev };
                                  emptyKeys.forEach(k => delete updated[k]);
                                  return updated;
                                });
                                updateAutoTranslate(true);
                                setRetryTrigger(r => r + 1);
                              }}
                              className="px-4 py-2 bg-blue-50 text-blue-600 rounded-md text-sm font-medium hover:bg-blue-100 transition-colors flex items-center gap-2"
                            >
                              <RefreshCw size={14} /> 이어서 자동 번역 재개하기
                            </button>
                          </div>
                        );
                      }
                      
                      return (
                        <div key={`script-group-${imgIndex}`} className="space-y-3">
                          {visibleIndices.length > 1 && (
                            <div className="pb-1 pt-1">
                              <span className="text-[11px] font-bold text-gray-400 px-1 uppercase tracking-wide">
                                Page {imgIndex + 1} 
                                {viewMode === '2page' && imgIndex === visibleIndices[0] && ' (우측 먼저)'}
                              </span>
                            </div>
                          )}
                          
                          {results.map((result, bubbleIndex) => {
                            const isHovered = hoveredBubble?.imageIndex === imgIndex && hoveredBubble?.bubbleIndex === bubbleIndex;
                            const displayNum = bubbleOffset + bubbleIndex + 1;
                            return (
                              <div
                                id={`script-${imgIndex}-${bubbleIndex}`}
                                key={result.id}
                                draggable
                                onDragStart={(e) => handleScriptDragStart(e, imgIndex, bubbleIndex)}
                                onDragEnd={handleScriptDragEnd}
                                onDragOver={handleScriptDragOver}
                                onDrop={(e) => handleScriptDrop(e, imgIndex, bubbleIndex)}
                                onMouseEnter={() => setHoveredBubble({ imageIndex: imgIndex, bubbleIndex })}
                                onMouseLeave={() => setHoveredBubble(null)}
                                className={`p-3 rounded-lg border transition-all duration-200 cursor-grab active:cursor-grabbing flex gap-3 ${
                                  isHovered 
                                    ? 'border-yellow-400 bg-yellow-50 shadow-md transform -translate-x-1' 
                                    : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                                } ${
                                  draggedItem?.imgIndex === imgIndex && draggedItem?.itemIndex === bubbleIndex
                                    ? 'opacity-50 scale-95 border-dashed border-gray-400'
                                    : ''
                                }`}
                              >
                                <div className={`flex items-center justify-center w-6 h-6 rounded-full shrink-0 text-xs font-bold mt-0.5 transition-colors ${
                                  isHovered ? 'bg-yellow-400 text-yellow-900 shadow-sm' : 'bg-gray-200 text-gray-600'
                                }`}>
                                  {displayNum}
                                </div>
                                <div className="flex flex-col flex-1">
                                  {editingBubble?.id === result.id ? (
                                    <div className="flex flex-col gap-2">
                                      <textarea
                                        value={editingText}
                                        onChange={(e) => setEditingText(e.target.value)}
                                        className="w-full p-2 text-[15px] text-gray-800 border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none bg-blue-50/30"
                                        rows={3}
                                        autoFocus
                                        onKeyDown={(e) => {
                                          // 한글 IME 조합 중 Enter는 글자 확정용이므로 저장하지 않음
                                          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                                          if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSaveEdit();
                                          } else if (e.key === 'Escape') {
                                            setEditingBubble(null);
                                          }
                                        }}
                                      />
                                      <div className="flex justify-end gap-1 mt-1">
                                        <button onClick={() => setEditingBubble(null)} className="p-1.5 hover:bg-gray-200 rounded-md text-gray-500 transition-colors" title="취소 (Esc)">
                                          <X size={14} />
                                        </button>
                                        <button onClick={handleSaveEdit} className="p-1.5 hover:bg-green-100 bg-green-50 text-green-600 rounded-md transition-colors" title="저장 (Enter)">
                                          <Check size={14} />
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <p className="text-gray-800 font-medium leading-relaxed break-keep text-[15px]">
                                        {result.translated_text}
                                      </p>
                                      {result.original_text && (
                                        <p className="text-gray-400 text-[11px] mt-1.5 font-serif leading-snug tracking-wide">
                                          {renderFurigana(result.original_text)}
                                        </p>
                                      )}
                                    </>
                                  )}

                                  <div 
                                    className="flex items-center gap-1 text-gray-300 justify-end mt-2 opacity-50 hover:opacity-100 transition-opacity"
                                    onPointerDown={(e) => { e.stopPropagation(); }}
                                  >
                                    <button 
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setEditingBubble({ key, id: result.id });
                                        setEditingText(result.translated_text);
                                      }}
                                      title="직접 번역 텍스트 수정하기"
                                      className="p-1 hover:text-green-500 hover:bg-green-50 rounded transition-colors relative z-10"
                                    >
                                      <Edit2 size={14} />
                                    </button>
                                    <button 
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        handleDeleteTranslation(imgIndex, result.id);
                                      }}
                                      title="번역 삭제하기"
                                      className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors relative z-10"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                    <button 
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        handleRetranslate(imgIndex, result.id, result.original_text);
                                      }}
                                      disabled={pendingBubbleIds.has(result.id)}
                                      title="이 문장만 다시 AI 재번역"
                                      className="p-1 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors disabled:opacity-50 relative z-10"
                                    >
                                      <RefreshCw size={14} className={pendingBubbleIds.has(result.id) ? 'animate-spin' : ''} />
                                    </button>
                                    <button 
                                      onClick={() => {
                                        setGlossaryForm({ original: result.original_text, translated: result.translated_text });
                                        setIsGlossaryOpen(true);
                                      }}
                                      title="단어장에 추가 (부분 추출)"
                                      className="p-1 hover:text-purple-500 hover:bg-purple-50 rounded transition-colors"
                                    >
                                      <BookOpen size={14} />
                                    </button>
                                    <div className="w-px h-3 bg-gray-200 mx-1"></div>
                                    <GripVertical size={16} className="cursor-grab hover:text-gray-500" />
                                  </div>

                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              
            </div>
          </div>
        )}
        


      </main>

      {/* Glossary Modal */}
      {isGlossaryOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm transition-all">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 animate-in fade-in zoom-in duration-200 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 text-purple-600">
                <BookOpen size={24} />
                <h3 className="text-lg font-bold text-gray-800">단어장 (Translation Memory)</h3>
              </div>
              <button onClick={() => setIsGlossaryOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={24} />
              </button>
            </div>
            
            <div className="flex gap-2 mb-6">
              <input 
                type="text" 
                placeholder="원문 (예: センゴク)" 
                className="flex-1 px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
                value={glossaryForm.original}
                onChange={e => setGlossaryForm({...glossaryForm, original: e.target.value})}
              />
              <input 
                type="text" 
                placeholder="번역 (예: 전국)" 
                className="flex-1 px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
                value={glossaryForm.translated}
                onChange={e => setGlossaryForm({...glossaryForm, translated: e.target.value})}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return; // 한글 조합 중 Enter는 무시
                  if (e.key === 'Enter' && glossaryForm.original.trim() && glossaryForm.translated.trim()) {
                    mergeGlossary({ [glossaryForm.original.trim()]: glossaryForm.translated.trim() });
                    setGlossaryForm({ original: '', translated: '' });
                  }
                }}
              />
              <button
                onClick={() => {
                  if (glossaryForm.original.trim() && glossaryForm.translated.trim()) {
                    mergeGlossary({ [glossaryForm.original.trim()]: glossaryForm.translated.trim() });
                    setGlossaryForm({ original: '', translated: '' });
                  }
                }}
                disabled={!glossaryForm.original || !glossaryForm.translated}
                className="px-4 py-2 bg-purple-600 text-white rounded font-medium hover:bg-purple-700 disabled:opacity-50"
              >
                추가
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-[200px]">
              {Object.keys(glossary).length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400">
                  <BookOpen size={32} className="mb-2 opacity-50" />
                  <p>등록된 단어가 없습니다.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {Object.entries(glossary).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between p-3 bg-gray-50 rounded border border-gray-100 hover:border-gray-200">
                      <div className="flex flex-col">
                        <span className="text-xs text-gray-500 font-mono">원문</span>
                        <span className="font-medium text-gray-800">{k}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col items-end">
                          <span className="text-xs text-gray-500 font-mono">번역</span>
                          <span className="font-bold text-purple-600">{v}</span>
                        </div>
                        <button 
                          onClick={() => {
                            const newGlossary = { ...glossary };
                            delete newGlossary[k];
                            updateGlossary(newGlossary);
                          }}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                          title="삭제"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500 flex justify-between items-center">
              <span>현재: {loadedFilename || "새 문서"}</span>
              <button onClick={() => setIsGlossaryOpen(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded font-medium hover:bg-gray-200">닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* Drive Load Modal */}
      {showDriveModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm transition-all">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center gap-3 text-blue-600 mb-4">
              <Cloud size={24} />
              <h3 className="text-lg font-bold text-gray-800">드라이브에서 불러오기</h3>
            </div>
            
            <div className="mb-4">
              <input
                type="text"
                placeholder="파일 이름 검색..."
                value={driveSearchQuery}
                onChange={(e) => setDriveSearchQuery(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div className="max-h-60 overflow-y-auto mb-6 pr-2 border rounded-lg divide-y">
              {driveSaves.filter(f => f.name.toLowerCase().includes(driveSearchQuery.toLowerCase())).length === 0 ? (
                <div className="p-4 text-center text-gray-500">
                  {driveSaves.length === 0 ? "저장된 파일이 없습니다." : "검색 결과가 없습니다."}
                </div>
              ) : (
                driveSaves
                  .filter(f => f.name.toLowerCase().includes(driveSearchQuery.toLowerCase()))
                  .map((file) => (
                    <button
                      key={file.id}
                      onClick={() => handleSelectDriveFile(file.id, file.name)}
                      className="w-full text-left p-3 hover:bg-blue-50 transition-colors flex flex-col gap-1"
                    >
                      <span className="font-medium text-gray-800">{file.name.replace('.zip', '')}</span>
                      <span className="text-xs text-gray-500">
                        {new Date(file.createdTime).toLocaleString('ko-KR')} · {(Number(file.size) / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </button>
                  ))
              )}
            </div>
            
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowDriveModal(false)}
                className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg transition-colors"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
