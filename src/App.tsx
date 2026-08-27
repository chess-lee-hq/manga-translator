import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Upload, Key, Loader2, Image as ImageIcon, MessageSquareText, ZoomIn, ZoomOut, Maximize, ChevronLeft, ChevronRight, BookOpen, PanelRight, Layers, Save, Download, Cpu, AlertTriangle, Trash2, GripVertical, RefreshCw, Cloud, FolderDown, Bot } from 'lucide-react';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';
import { translateMangaImage, retranslateTextGemini } from './lib/gemini';
import { translateMangaImageOpenAI, retranslateTextOpenAI } from './lib/openai';
import { uploadToGoogleDrive, listMangaSaves, downloadFromGoogleDrive, createMangaZip, extractMangaZip } from './lib/drive';
import type { TranslationResult } from './lib/gemini';

interface UploadedImage {
  src: string;
  file: File;
  mimeType: string;
  width: number;
  height: number;
  isSpread: boolean;
}

// ... (renderFurigana omitted for brevity)
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
  const [googleKey, setGoogleKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  
  const [googleClientId] = useState(() => localStorage.getItem('googleClientId') || '499460859404-ub21a3onu2807hmeei71110c5d3b4ugo.apps.googleusercontent.com');
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [isDriveSyncing, setIsDriveSyncing] = useState(false);
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [driveSaves, setDriveSaves] = useState<any[]>([]);
  const [driveSearchQuery, setDriveSearchQuery] = useState('');

  const [allImages, setAllImages] = useState<UploadedImage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'1page' | '2page'>('2page');
  const [scriptStyle, setScriptStyle] = useState<'side' | 'overlay'>('side');
  const [aiModel, setAiModel] = useState<'flash' | 'pro'>('flash');
  const [showProWarning, setShowProWarning] = useState(false);
  const [draggedItem, setDraggedItem] = useState<{ imgIndex: number, itemIndex: number } | null>(null);
  
  // Cache key is now `${provider}-${model}-${imageIndex}`
  const [translationCache, setTranslationCache] = useState<Record<string, TranslationResult[]>>({});
  
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  const [hoveredBubble, setHoveredBubble] = useState<{ imageIndex: number, bubbleIndex: number } | null>(null);
  const [scale, setScale] = useState(0.9);
  
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scriptListRef = useRef<HTMLDivElement>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedGoogleKey = localStorage.getItem('manga-translator-google-key');
    if (savedGoogleKey) setGoogleKey(savedGoogleKey);
    const savedOpenaiKey = localStorage.getItem('manga-translator-openai-key');
    if (savedOpenaiKey) setOpenaiKey(savedOpenaiKey);

    // Load saved translation caches from LocalStorage
    const initialCache: Record<string, TranslationResult[]> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('manga-cache-')) {
        try {
          initialCache[k] = JSON.parse(localStorage.getItem(k) || '[]');
        } catch(e) {}
      }
    }
    setTranslationCache(initialCache);
  }, []);

  const getCacheKey = useCallback((p: string, m: string, file: File) => {
    return `manga-cache-${p}-${m}-${file.name}-${file.size}`;
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

  const currentKey = provider === 'google' ? googleKey : openaiKey;

  const loginToGoogleDrive = () => {
    return new Promise<string>((resolve, reject) => {
      try {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: googleClientId,
          scope: 'https://www.googleapis.com/auth/drive.file',
          callback: (response: any) => {
            if (response.error !== undefined) {
              reject(response);
            }
            resolve(response.access_token);
          },
        });
        client.requestAccessToken();
      } catch (err) {
        reject(err);
      }
    });
  };

  const handleSaveToDrive = async () => {
    if (allImages.length === 0) {
      alert("저장할 만화가 없습니다.");
      return;
    }
    
    const defaultName = `Manga_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    const filename = window.prompt("구글 드라이브에 저장할 파일 이름을 입력해주세요 (확장자 .zip 포함):", defaultName);
    if (!filename) return;

    setIsDriveSyncing(true);
    try {
      let token = driveToken;
      if (!token) {
        token = await loginToGoogleDrive();
        setDriveToken(token);
      }
      
      const zipBlob = await createMangaZip(allImages, translationCache, provider, aiModel, currentPageIndex);
      await uploadToGoogleDrive(token!, zipBlob, filename);
      alert("구글 드라이브에 성공적으로 저장되었습니다!");
    } catch (e: any) {
      console.error(e);
      alert("구글 드라이브 저장 실패: " + e.message);
    } finally {
      setIsDriveSyncing(false);
    }
  };

  const loadDriveFileList = async () => {
    try {
      let token = driveToken;
      if (!token) {
        token = await loginToGoogleDrive();
        setDriveToken(token);
      }
      const files = await listMangaSaves(token!);
      setDriveSaves(files);
      setShowDriveModal(true);
    } catch (e: any) {
      console.error(e);
      alert("구글 드라이브 파일 목록 불러오기 실패: " + e.message);
    }
  };

  const handleSelectDriveFile = async (fileId: string) => {
    setIsDriveSyncing(true);
    setShowDriveModal(false);
    try {
      const zipBlob = await downloadFromGoogleDrive(driveToken!, fileId);
      const { images, translations, lastReadPage } = await extractMangaZip(zipBlob);
      
      const loadedImages: UploadedImage[] = [];
      for (const img of images) {
        const imgProps = await new Promise<{width: number, height: number, isSpread: boolean}>((resolve) => {
          const imageObj = new Image();
          imageObj.onload = () => {
            resolve({
              width: imageObj.width,
              height: imageObj.height,
              isSpread: imageObj.width > imageObj.height
            });
          };
          imageObj.src = img.src;
        });
        
        loadedImages.push({
          ...img,
          ...imgProps
        });
      }
      
      setAllImages(loadedImages);
      setTranslationCache(prev => ({ ...prev, ...translations }));
      setCurrentPageIndex(lastReadPage || 0);
      
      Object.keys(translations).forEach(key => {
        try { localStorage.setItem(key, JSON.stringify(translations[key])); } catch(e) {}
      });
      alert("성공적으로 불러왔습니다!");
    } catch (e: any) {
      console.error(e);
      alert("파일 불러오기 실패: " + e.message);
    } finally {
      setIsDriveSyncing(false);
    }
  };


  const processFiles = async (files: FileList | File[]) => {
    let validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    const jsonFile = Array.from(files).find(f => f.name.endsWith('.json'));
    const zipFile = Array.from(files).find(f => f.name.endsWith('.zip') || f.name.endsWith('.cbz'));
    
    if (validFiles.length === 0 && !zipFile && !jsonFile) {
      setError('올바른 이미지 파일이나 압축 파일(.zip, .cbz)을 업로드해주세요.');
      return;
    }

    setError(null);
    
    if (zipFile && !jsonFile) { // jsonFile이 있으면 아마 구글 드라이브나 자체 백업 ZIP일 수 있음
      try {
        const zip = await JSZip.loadAsync(zipFile);
        const extractedFiles: File[] = [];
        
        // 정렬을 위해 파일 이름을 저장
        const fileNames = Object.keys(zip.files).sort();
        
        for (const filename of fileNames) {
          const file = zip.files[filename];
          if (!file.dir && (filename.endsWith('.jpg') || filename.endsWith('.jpeg') || filename.endsWith('.png') || filename.endsWith('.webp'))) {
            const blob = await file.async("blob");
            const ext = filename.split('.').pop()?.toLowerCase();
            const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'png' ? 'image/png' : 'image/webp');
            const newFile = new File([blob], filename.split('/').pop() || filename, { type: mimeType });
            extractedFiles.push(newFile);
          }
        }
        
        validFiles = [...validFiles, ...extractedFiles];
      } catch (err) {
        console.error("ZIP 파싱 에러:", err);
        setError("압축 파일을 푸는 중 오류가 발생했습니다.");
      }
    }
    
    if (jsonFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target?.result as string);
          setTranslationCache(prev => ({ ...prev, ...imported }));
          
          // 새로 추가된 기능: JSON으로 불러온 과거 데이터도 브라우저 자동저장소(LocalStorage)에 영구 등록합니다.
          Object.keys(imported).forEach(key => {
            if (key.startsWith('manga-cache-')) {
              try { localStorage.setItem(key, JSON.stringify(imported[key])); } catch(e) {}
            }
          });
        } catch (err) {
          console.error("JSON 파싱 에러:", err);
        }
      };
      reader.readAsText(jsonFile);
    }

    const loadedImages: UploadedImage[] = [];

    for (const file of validFiles) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(file);
      });
      
      const imgProps = await new Promise<{width: number, height: number, isSpread: boolean}>((resolve) => {
        const img = new Image();
        img.onload = () => {
          resolve({
            width: img.width,
            height: img.height,
            isSpread: img.width > img.height
          });
        };
        img.src = dataUrl;
      });

      loadedImages.push({ 
        src: dataUrl, 
        file, 
        mimeType: file.type,
        ...imgProps
      });
    }

    setAllImages(prev => {
      const combined = [...prev];
      for (const newImg of loadedImages) {
        if (!combined.some(existing => existing.file.name === newImg.file.name && existing.file.size === newImg.file.size)) {
          combined.push(newImg);
        }
      }
      combined.sort((a, b) => a.file.name.localeCompare(b.file.name));
      return combined;
    });
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
    
    if (aiModel === 'flash') {
      for (let i = 1; i <= 10; i++) {
        const nextIdx = visibleIndices[visibleIndices.length - 1] + i;
        if (nextIdx < allImages.length) {
          needed.push(nextIdx);
        }
      }
    }
    return needed;
  }, [visibleIndices, allImages.length, aiModel]);

  const executeTranslation = async (idx: number) => {
    const img = allImages[idx];
    const base64Data = img.src.split(',')[1];
    
    if (provider === 'google') {
      if (!googleKey) throw new Error("Google API 키를 먼저 입력해주세요.");
      return await translateMangaImage(googleKey, base64Data, img.mimeType, aiModel);
    } else {
      if (!googleKey) throw new Error("OpenAI 모드를 사용하려면 말풍선 위치 인식을 위한 Google API 키도 반드시 입력되어야 합니다.");
      if (!openaiKey) throw new Error("OpenAI API 키를 먼저 입력해주세요.");
      
      // Pass 1: Gemini를 통한 OCR 및 완벽한 위치(좌표) 추출 (가장 빠르고 싼 flash 모드로 고정)
      const geminiResults = await translateMangaImage(googleKey, base64Data, img.mimeType, 'flash');
      
      // Pass 2: OpenAI를 통한 텍스트 전용 고품질 번역
      return await translateMangaImageOpenAI(openaiKey, geminiResults, aiModel);
    }
  };

  const [isRetranslating, setIsRetranslating] = useState<{imgIndex: number, bubbleIndex: number} | null>(null);

  const handleRetranslate = async (imgIndex: number, bubbleIndex: number, originalText: string) => {
    setIsRetranslating({ imgIndex, bubbleIndex });
    try {
      const img = allImages[imgIndex];
      const key = getCacheKey(provider, aiModel, img.file);
      
      let newTranslation = "";
      if (provider === 'google') {
        if (!googleKey) throw new Error("Google API 키가 필요합니다.");
        newTranslation = await retranslateTextGemini(googleKey, originalText, aiModel);
      } else {
        if (!openaiKey) throw new Error("OpenAI API 키가 필요합니다.");
        newTranslation = await retranslateTextOpenAI(openaiKey, originalText, aiModel);
      }

      setTranslationCache(prev => {
        const updated = { ...prev };
        if (updated[key]) {
          updated[key] = [...updated[key]];
          updated[key][bubbleIndex] = {
            ...updated[key][bubbleIndex],
            translated_text: newTranslation
          };
          try { localStorage.setItem(key, JSON.stringify(updated[key])); } catch(e) {}
        }
        return updated;
      });
    } catch (e: any) {
      alert("재번역 실패: " + e.message);
    } finally {
      setIsRetranslating(null);
    }
  };

  useEffect(() => {
    if (allImages.length === 0 || !currentKey || translationQueue.length === 0) return;

    const missingIndices = translationQueue.filter(i => {
      const key = getCacheKey(provider, aiModel, allImages[i].file);
      return !translationCache[key];
    });
    
    if (missingIndices.length > 0) {
      const translateMissing = async () => {
        setIsTranslating(true);
        setError(null);
        try {
          const visibleMissing = missingIndices.filter(i => visibleIndices.includes(i));
          if (visibleMissing.length > 0) {
            const visiblePromises = visibleMissing.map(async (idx) => {
              const results = await executeTranslation(idx);
              return { idx, results };
            });
            
            const visibleResults = await Promise.all(visiblePromises);
            setTranslationCache(prev => {
              const updated = { ...prev };
              visibleResults.forEach(({idx, results}) => {
                const key = getCacheKey(provider, aiModel, allImages[idx].file);
                updated[key] = results;
                try { localStorage.setItem(key, JSON.stringify(results)); } catch(e) { console.warn("LocalStorage full"); }
              });
              return updated;
            });
          }

          const preloadMissing = missingIndices.filter(i => !visibleIndices.includes(i));
          if (preloadMissing.length > 0) {
            const preloadPromises = preloadMissing.map(async (idx) => {
              const results = await executeTranslation(idx);
              return { idx, results };
            });
            
            const preloadResults = await Promise.all(preloadPromises);
            setTranslationCache(prev => {
              const updated = { ...prev };
              preloadResults.forEach(({idx, results}) => {
                const key = getCacheKey(provider, aiModel, allImages[idx].file);
                updated[key] = results;
                try { localStorage.setItem(key, JSON.stringify(results)); } catch(e) { console.warn("LocalStorage full"); }
              });
              return updated;
            });
          }
        } catch (err: any) {
          setError(err.message || '번역 중 오류가 발생했습니다.');
        } finally {
          setIsTranslating(false);
        }
      };
      
      translateMissing();
    }
  }, [translationQueue.join(','), allImages, currentKey, aiModel, provider, getCacheKey]); 

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) processFiles(e.dataTransfer.files);
  }, [currentKey]);

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
  const handleZoomReset = () => setScale(1.0);

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.deltaY < 0) handleZoomIn();
      else handleZoomOut();
    }
  };

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

  const handlePrev = () => {
    setCurrentPageIndex(prev => {
      if (prev === 0) return 0;
      if (viewMode === '1page') return prev - 1;
      
      let i = 0;
      let lastIndex = 0;
      while (i < prev) {
        lastIndex = i;
        if (allImages[i].isSpread) {
          i += 1;
        } else if (i + 1 < allImages.length && !allImages[i + 1].isSpread) {
          i += 2;
        } else {
          i += 1;
        }
      }
      setHoveredBubble(null);
      return lastIndex;
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
    const data = JSON.stringify(translationCache, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'manga_translation_data.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClearCache = () => {
    if (confirm('브라우저에 자동 저장된 모든 번역 기록을 영구적으로 삭제하시겠습니까?')) {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('manga-cache-')) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      setTranslationCache({});
      alert('저장된 캐시가 모두 삭제되었습니다.');
    }
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
      const key = getCacheKey(provider, aiModel, img.file);
      const results = [...(prev[key] || [])];
      
      const [movedItem] = results.splice(draggedItem.itemIndex, 1);
      results.splice(targetItemIndex, 0, movedItem);
      
      try { localStorage.setItem(key, JSON.stringify(results)); } catch(e) {}
      
      return {
        ...prev,
        [key]: results
      };
    });
    setDraggedItem(null);
  };

  const handleDownloadImage = async (imgIndex: number) => {
    const element = document.getElementById(`manga-page-${imgIndex}`);
    if (!element) return;
    
    const oldScale = scale;
    setScale(1.0);
    
    setTimeout(async () => {
      try {
        const canvas = await html2canvas(element, { useCORS: true, allowTaint: true, scale: 2 });
        const link = document.createElement('a');
        link.download = `translated_page_${imgIndex + 1}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      } catch (err) {
        console.error("Failed to capture image:", err);
        setError("이미지 다운로드에 실패했습니다.");
      } finally {
        setScale(oldScale);
      }
    }, 100);
  };

  let globalScriptCounter = 0;

  return (
    <div className="min-h-screen flex flex-col bg-gray-100 font-sans h-screen overflow-hidden">
      <header className="bg-white shadow-sm border-b px-6 py-4 flex items-center justify-between z-10 shrink-0">
        <div className="flex items-center gap-2">
          <ImageIcon className="text-blue-600" size={28} />
          <h1 className="text-xl font-bold text-gray-800">Manga Translator</h1>
        </div>
        <div className="flex items-center gap-4">
          
          <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200 shadow-inner">
            <button 
              onClick={() => setProvider('google')}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-all font-medium ${
                provider === 'google' 
                  ? 'bg-white shadow text-blue-600 border border-blue-200' 
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Cpu size={15} /> Google
            </button>
            <button 
              onClick={() => setProvider('openai')}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-all font-medium ${
                provider === 'openai' 
                  ? 'bg-white shadow text-green-600 border border-green-200' 
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Bot size={15} /> OpenAI
            </button>
          </div>

          <div className="w-px h-6 bg-gray-300"></div>

          <div className="flex items-center gap-2">
            <Key size={18} className="text-gray-500" />
            <input
              type="password"
              placeholder={`${provider === 'google' ? 'Gemini' : 'OpenAI'} API Key`}
              value={currentKey}
              onChange={handleKeyChange}
              autoComplete="new-password"
              data-1p-ignore="true"
              data-lpignore="true"
              spellCheck="false"
              className={`border rounded-md px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 ${
                provider === 'google' ? 'focus:ring-blue-500' : 'focus:ring-green-500'
              }`}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col p-4 overflow-hidden relative">
        <input 
          type="file" 
          ref={fileInputRef}
          className="hidden" 
          multiple 
          accept="image/*,application/json"
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
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
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
            
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-2 flex justify-between items-center shrink-0 overflow-x-auto [&::-webkit-scrollbar]:hidden">
              <div className="flex items-center gap-2 px-2 shrink-0">
                <span className="font-semibold text-gray-700 flex items-center gap-2">
                  <ImageIcon size={18} /> 만화 뷰어 
                  <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full border">
                    총 {allImages.length}장
                  </span>
                </span>
                
                <div className="w-px h-5 bg-gray-300 mx-2"></div>
                
                <button 
                  onClick={() => setViewMode(prev => prev === '1page' ? '2page' : '1page')}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 rounded-md transition-colors text-sm font-medium border border-gray-200 whitespace-nowrap text-gray-700"
                >
                  <BookOpen size={16} />
                  {viewMode === '1page' ? '1장' : '2장'}
                </button>
                
                <div className="w-px h-5 bg-gray-300 mx-1"></div>

                <div className="flex items-center gap-1.5 px-2 py-1.5 bg-indigo-50/50 rounded-md border border-indigo-100 shrink-0">
                  <Cpu size={16} className="text-indigo-500" />
                  <span className="text-sm font-bold text-indigo-700">
                    {provider === 'google' ? 'Gemini 3.6 Flash' : 'OpenAI gpt-4o'}
                  </span>
                </div>

                <div className="w-px h-5 bg-gray-300 mx-1"></div>

                <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200 shrink-0">
                  <button
                    onClick={() => setScriptStyle('overlay')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-medium transition-all ${
                      scriptStyle === 'overlay' 
                        ? 'bg-white text-blue-600 shadow-sm' 
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Layers size={14} />
                    덮어쓰기
                  </button>
                  <button
                    onClick={() => setScriptStyle('side')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-medium transition-all ${
                      scriptStyle === 'side' 
                        ? 'bg-white text-blue-600 shadow-sm' 
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <PanelRight size={14} />
                    우측 대본
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">

                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 transition-colors text-sm font-medium border border-blue-200 shadow-sm"
                >
                  <Upload size={16} /> 이미지 추가
                </button>

                <button 
                  onClick={handleExportJSON}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-md hover:bg-green-100 transition-colors text-sm font-medium border border-green-200 shadow-sm"
                  title="브라우저에 JSON 파일로 다운로드"
                >
                  <Save size={16} /> JSON 저장
                </button>
                
                <button 
                  onClick={handleSaveToDrive}
                  disabled={isDriveSyncing}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 transition-colors text-sm font-medium border border-blue-200 shadow-sm disabled:opacity-50"
                  title="구글 드라이브에 클라우드 세이브"
                >
                  {isDriveSyncing ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />} 
                  드라이브 저장
                </button>
                
                <button 
                  onClick={handleClearCache}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 rounded-md hover:bg-red-100 transition-colors text-sm font-medium border border-red-200 shadow-sm"
                  title="브라우저에 자동 저장된 모든 번역 기록 삭제"
                >
                  <Trash2 size={16} /> 캐시 비우기
                </button>
              </div>

              <div className="flex items-center gap-2 bg-gray-50 px-2 py-1 rounded-md border border-gray-200">
                <button onClick={handleZoomOut} className="p-1 hover:bg-gray-200 rounded text-gray-600" title="축소">
                  <ZoomOut size={18} />
                </button>
                <span className="text-sm font-medium w-12 text-center text-gray-700">
                  {Math.round(scale * 100)}%
                </span>
                <button onClick={handleZoomIn} className="p-1 hover:bg-gray-200 rounded text-gray-600" title="확대">
                  <ZoomIn size={18} />
                </button>
                <div className="w-px h-4 bg-gray-300 mx-1"></div>
                <button onClick={handleZoomReset} className="p-1 hover:bg-gray-200 rounded text-gray-600" title="초기화">
                  <Maximize size={18} />
                </button>
              </div>

              <div className="px-2">
                <button
                  onClick={() => setAllImages([])}
                  className="text-sm text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-md transition border border-red-200"
                >
                  모두 지우기
                </button>
              </div>
            </div>

            <div className="flex-1 flex gap-4 min-h-0">
              
              <div className={`flex flex-col h-full bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden relative transition-all duration-300 ${scriptStyle === 'side' ? 'flex-1 min-w-0' : 'flex-1 w-full'}`}>
                <div 
                  ref={viewerContainerRef}
                  className={`flex-1 overflow-auto bg-gray-800 ${isPanning ? 'cursor-grabbing' : 'cursor-grab'} [&::-webkit-scrollbar]:hidden`}
                  style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  onWheel={handleWheel}
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
                      const key = getCacheKey(provider, aiModel, img.file);
                      const results = translationCache[key] || [];

                      return (
                        <div key={imgIndex} className="relative shadow-2xl bg-white select-none flex-shrink-0 group">
                          <div id={`manga-page-${imgIndex}`} className="relative bg-white">
                            <img
                              src={img.src}
                              alt={`Manga Page ${imgIndex + 1}`}
                              className="block transition-all duration-200"
                              style={{ height: `calc((100vh - 250px) * ${scale})`, width: 'auto', objectFit: 'contain' }}
                              draggable={false}
                            />
                            
                            {results.map((result, bubbleIndex) => {
                              const [ymin, xmin, ymax, xmax] = result.box_2d;
                              const boxWidth = xmax - xmin;
                              const boxHeight = ymax - ymin;
                              
                              const expandedWidth = boxWidth * 1.6;
                              const expandedHeight = boxHeight * 1.25;
                              const cx = xmin + boxWidth / 2;
                              const cy = ymin + boxHeight / 2;
                              const newXmin = cx - expandedWidth / 2;
                              const newYmin = cy - expandedHeight / 2;
                              
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

                                const maxCqi = (100 / charsPerLine) * 0.9;
                                const maxCqh = (100 / (lines * 1.15)) * 0.95;

                                return (
                                  <div
                                    key={bubbleIndex}
                                    className="absolute flex flex-col items-center justify-center pointer-events-auto"
                                    style={{
                                      top, left, height, width,
                                      containerType: 'size',
                                      zIndex: 20
                                    }}
                                  >
                                    <span 
                                      className="bg-white text-gray-900 rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.15)] flex flex-col items-center justify-center"
                                      style={{
                                        fontSize: `clamp(${10 * scale}px, min(${maxCqi}cqi, ${maxCqh}cqh), ${28 * scale}px)`,
                                        fontWeight: '800',
                                        lineHeight: '1.15', 
                                        wordBreak: 'break-all', 
                                        overflowWrap: 'anywhere',
                                        textAlign: 'center',
                                        letterSpacing: '-0.02em',
                                        width: '100%',
                                        minHeight: '100%',
                                        padding: '4%' 
                                      }}
                                    >
                                      {result.translated_text}
                                    </span>
                                  </div>
                                );
                              }

                              return (
                                <div
                                  key={bubbleIndex}
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
                          
                          {scriptStyle === 'overlay' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDownloadImage(imgIndex); }}
                              className="absolute top-4 right-4 bg-black bg-opacity-60 hover:bg-blue-600 text-white p-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50 flex items-center gap-2"
                              title="이 페이지를 이미지로 다운로드"
                            >
                              <Download size={20} />
                            </button>
                          )}
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
                    disabled={currentPageIndex + (viewMode === '2page' ? 2 : 1) >= allImages.length}
                    className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium text-gray-700"
                  >
                    <ChevronLeft size={20} /> 다음 페이지
                  </button>
                  
                  <div className="font-semibold text-gray-600 bg-white px-4 py-1.5 rounded-full border shadow-inner">
                    {viewMode === '2page' 
                      ? `${currentPageIndex + 1} - ${Math.min(currentPageIndex + 2, allImages.length)} / ${allImages.length}`
                      : `${currentPageIndex + 1} / ${allImages.length}`
                    }
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
                <div className="w-[580px] shrink-0 flex flex-col h-full bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden transition-all duration-300">
                  <div className="p-3 border-b border-gray-200 bg-gray-50 flex justify-between items-center shrink-0">
                    <span className="font-semibold text-gray-700 flex items-center gap-2">
                      <MessageSquareText size={18} /> 한국어 대본
                    </span>
                    {isTranslating && (
                      <div className="flex items-center text-sm text-blue-600 font-medium bg-blue-50 px-2 py-1 rounded-md border border-blue-100">
                        <Loader2 className="animate-spin mr-2" size={16} />
                        번역 중...
                      </div>
                    )}
                  </div>
                  
                  <div 
                    className="flex-1 overflow-y-auto p-4 bg-white space-y-4" 
                    ref={scriptListRef}
                  >
                    {visibleIndices.map((imgIndex) => {
                      const img = allImages[imgIndex];
                      const key = getCacheKey(provider, aiModel, img.file);
                      const results = translationCache[key];
                      if (!results) {
                        return (
                          <div key={`loading-${imgIndex}`} className="flex flex-col items-center justify-center py-10 text-gray-400">
                            <Loader2 className="animate-spin mb-2" size={24} />
                            <span className="text-sm">Page {imgIndex + 1} 번역을 불러오는 중...</span>
                          </div>
                        );
                      }
                      if (results.length === 0) {
                        return (
                          <div key={`empty-${imgIndex}`} className="py-4 text-center text-gray-400 text-sm">
                            Page {imgIndex + 1}: 번역된 텍스트가 없습니다.
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
                            globalScriptCounter++;
                            
                            return (
                              <div
                                id={`script-${imgIndex}-${bubbleIndex}`}
                                key={bubbleIndex}
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
                                  {globalScriptCounter}
                                </div>
                                <div className="flex flex-col flex-1">
                                  <p className="text-gray-800 font-medium leading-relaxed break-keep text-[15px]">
                                    {result.translated_text}
                                  </p>
                                  {result.original_text && (
                                    <p className="text-gray-400 text-[11px] mt-1.5 font-serif leading-snug tracking-wide">
                                      {renderFurigana(result.original_text)}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 text-gray-300">
                                  <button 
                                    onClick={() => handleRetranslate(imgIndex, bubbleIndex, result.original_text)}
                                    disabled={isRetranslating?.imgIndex === imgIndex && isRetranslating?.bubbleIndex === bubbleIndex}
                                    title="이 문장만 다시 번역하기"
                                    className="p-1 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors disabled:opacity-50"
                                  >
                                    <RefreshCw size={14} className={isRetranslating?.imgIndex === imgIndex && isRetranslating?.bubbleIndex === bubbleIndex ? 'animate-spin' : ''} />
                                  </button>
                                  <GripVertical size={16} className="cursor-grab hover:text-gray-500" />
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
        
        {/* Pro Warning Modal */}
        {showProWarning && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm transition-all">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
              <div className="flex items-center gap-3 text-red-600 mb-4">
                <AlertTriangle size={24} />
                <h3 className="text-lg font-bold text-gray-800">비용 경고</h3>
              </div>
              <p className="text-gray-600 mb-6 leading-relaxed">
                고품질(Pro) 모드는 쾌속(Flash) 모드에 비해 토큰 비용이 <strong>최대 20배 이상</strong> 비싸게 청구될 수 있습니다. 
                <br/><br/>
                정말 필요한 페이지(오역, 복잡한 대사 등)에서만 일시적으로 사용하시는 것을 권장합니다. 그래도 Pro 모드로 전환하시겠습니까?
              </p>
              <div className="flex justify-end gap-3">
                <button 
                  onClick={() => setShowProWarning(false)}
                  className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg transition-colors"
                >
                  취소 (쾌속 유지)
                </button>
                <button 
                  onClick={() => {
                    setAiModel('pro');
                    setShowProWarning(false);
                  }}
                  className="px-4 py-2 bg-red-600 text-white font-medium hover:bg-red-700 rounded-lg transition-colors shadow-sm"
                >
                  확인 (Pro 전환)
                </button>
              </div>
            </div>
          </div>
        )}

      </main>

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
                      onClick={() => handleSelectDriveFile(file.id)}
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
