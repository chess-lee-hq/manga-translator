import { BookOpen, Bot, Cloud, Cpu, Download, GripVertical, Image as ImageIcon, Key, Layers, Loader2, PanelRight, Save, Trash2, Upload, X, Zap, ZapOff, ZoomIn, ZoomOut } from 'lucide-react';
import type { GeminiVersion, OpenAiVersion, Provider, ScriptStyle, ViewMode } from '../types';

interface AppHeaderProps {
  loadedFilename: string | null;
  imageCount: number;
  viewMode: ViewMode;
  onToggleViewMode: () => void;
  scriptStyle: ScriptStyle;
  onScriptStyleChange: (style: ScriptStyle) => void;
  isEditingBoxes: boolean;
  onToggleEditingBoxes: () => void;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onAddFiles: () => void;
  exportProgress: { done: number; total: number } | null;
  onExportAll: () => void;
  onExportJSON: () => void;
  isDriveSyncing: boolean;
  onSaveToDrive: () => void;
  onOpenGlossary: () => void;
  onClearCache: () => void;
  onCloseSession: () => void;
  autoTranslate: boolean;
  onToggleAutoTranslate: () => void;
  provider: Provider;
  onProviderChange: (provider: Provider) => void;
  geminiVersion: GeminiVersion;
  onGeminiVersionChange: (version: GeminiVersion) => void;
  openAiVersion: OpenAiVersion;
  onOpenAiVersionChange: (version: OpenAiVersion) => void;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
}

/** 화면이 넓을 때만 버튼 글자를 보여줍니다. 좁으면 아이콘만 남기고 마우스를 올리면 이름이 보입니다. */
const WIDE_LABEL = 'hidden min-[1900px]:inline';
const actionButton = 'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border whitespace-nowrap shrink-0 disabled:opacity-50';

export function AppHeader(props: AppHeaderProps) {
  const {
    loadedFilename, imageCount, viewMode, onToggleViewMode, scriptStyle, onScriptStyleChange, isEditingBoxes, onToggleEditingBoxes,
    scale, onZoomIn, onZoomOut, onAddFiles, exportProgress, onExportAll, onExportJSON, isDriveSyncing, onSaveToDrive, onOpenGlossary,
    onClearCache, onCloseSession, autoTranslate, onToggleAutoTranslate, provider, onProviderChange, geminiVersion, onGeminiVersionChange,
    openAiVersion, onOpenAiVersionChange, apiKey, onApiKeyChange,
  } = props;
  const hasImages = imageCount > 0;

  return (
    // 한 줄에 다 들어가지 않으면 가로로 늘어나지 않고 오른쪽 묶음이 다음 줄로 내려감
    <header className="bg-white shadow-sm border-b px-4 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 z-10 shrink-0 w-full">
      <div className="flex items-center gap-2 min-w-0 flex-1 basis-[28rem]">
        <ImageIcon className="text-blue-600 shrink-0" size={24} />
        {/* 앱 제목보다 파일 이름이 더 중요하므로, 아주 넓은 화면에서만 제목을 보여줌 */}
        <h1 className="hidden min-[2200px]:block text-lg font-bold text-gray-800 mr-2 whitespace-nowrap shrink-0">Manga Translator</h1>
        {loadedFilename && (
          // 긴 파일 이름은 남는 공간만큼만 보여주고 말줄임표 처리 (마우스를 올리면 전체 이름)
          <span
            title={loadedFilename}
            className="min-w-[4rem] max-w-md truncate text-xs bg-indigo-100 text-indigo-700 font-medium px-2 py-0.5 rounded-full border border-indigo-200"
          >
            📂 {loadedFilename}
          </span>
        )}

        {hasImages && (
          <>
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0">
              총 {imageCount}장
            </span>

            <div className="w-px h-5 bg-gray-300 mx-1 shrink-0"></div>

            <button
              onClick={onToggleViewMode}
              title="1장 / 2장 보기 전환"
              className="flex items-center gap-1.5 px-3 py-1 bg-gray-50 hover:bg-gray-100 rounded-md transition-colors text-xs font-medium border border-gray-200 whitespace-nowrap text-gray-700 shrink-0"
            >
              <BookOpen size={14} />
              {viewMode === '1page' ? '1장' : '2장'}
            </button>

            <div className="flex bg-gray-100 p-0.5 rounded-md border border-gray-200 shrink-0">
              <button
                onClick={() => onScriptStyleChange('overlay')}
                title="덮어쓰기"
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium whitespace-nowrap transition-all ${
                  scriptStyle === 'overlay' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Layers size={14} /> <span className={WIDE_LABEL}>덮어쓰기</span>
              </button>
              <button
                onClick={() => onScriptStyleChange('side')}
                title="우측 대본"
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium whitespace-nowrap transition-all ${
                  scriptStyle === 'side' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <PanelRight size={14} /> <span className={WIDE_LABEL}>우측 대본</span>
              </button>
            </div>

            {scriptStyle === 'overlay' && (
              <button
                onClick={onToggleEditingBoxes}
                title="영역 수정"
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors text-xs font-medium border whitespace-nowrap shrink-0 ${
                  isEditingBoxes ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              >
                <GripVertical size={14} /> <span className={WIDE_LABEL}>영역 수정</span>
              </button>
            )}

            <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 rounded-md border border-gray-200 shrink-0">
              <button onClick={onZoomOut} title="축소" className="p-0.5 hover:bg-gray-200 rounded text-gray-600">
                <ZoomOut size={14} />
              </button>
              <span className="text-xs font-medium w-9 text-center text-gray-700">
                {Math.round(scale * 100)}%
              </span>
              <button onClick={onZoomIn} title="확대" className="p-0.5 hover:bg-gray-200 rounded text-gray-600">
                <ZoomIn size={14} />
              </button>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {hasImages && (
          <>
            <button onClick={onAddFiles} title="이미지 추가" className={`${actionButton} bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100`}>
              <Upload size={14} /> <span className={WIDE_LABEL}>추가</span>
            </button>
            <button onClick={onExportAll} disabled={!!exportProgress} title="번역이 입혀진 전체 페이지를 고해상도 이미지로 ZIP 저장" className={`${actionButton} bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100`}>
              {exportProgress
                ? <><Loader2 size={14} className="animate-spin" /> {exportProgress.done}/{exportProgress.total}</>
                : <><Download size={14} /> <span className={WIDE_LABEL}>ZIP</span></>}
            </button>
            <button onClick={onExportJSON} title="번역 데이터 JSON 저장" className={`${actionButton} bg-green-50 text-green-700 border-green-200 hover:bg-green-100`}>
              <Save size={14} /> <span className={WIDE_LABEL}>JSON</span>
            </button>
            <button onClick={onSaveToDrive} disabled={isDriveSyncing} title="구글 드라이브에 저장" className={`${actionButton} bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100`}>
              {isDriveSyncing ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />} <span className={WIDE_LABEL}>드라이브</span>
            </button>
            <button onClick={onOpenGlossary} title="단어장" className={`${actionButton} bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100`}>
              <BookOpen size={14} /> <span className={WIDE_LABEL}>단어장</span>
            </button>
            <button onClick={onClearCache} title="저장된 번역 기록 모두 삭제" className={`${actionButton} bg-red-50 text-red-700 border-red-200 hover:bg-red-100`}>
              <Trash2 size={14} /> <span className={WIDE_LABEL}>기록 삭제</span>
            </button>
            <button
              onClick={onCloseSession}
              title="작업 닫기: 첫 화면으로 돌아갑니다 (번역 기록·단어장은 유지)"
              className={`${actionButton} bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100`}
            >
              <X size={14} /> <span className={WIDE_LABEL}>작업 닫기</span>
            </button>

            <div className="w-px h-5 bg-gray-300 mx-1 shrink-0"></div>
          </>
        )}

        <button
          onClick={onToggleAutoTranslate}
          title={autoTranslate ? '자동 번역 ON: 페이지를 넘기면 보이는 페이지와 다음 페이지들을 자동으로 번역합니다. 클릭하면 끕니다.' : '자동 번역 OFF: 대본 패널에서 페이지별로 번역할 수 있습니다.'}
          className={`${actionButton} ${autoTranslate ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200'}`}
        >
          {autoTranslate ? <Zap size={12} /> : <ZapOff size={12} />} <span className={WIDE_LABEL}>자동 번역</span> {autoTranslate ? 'ON' : 'OFF'}
        </button>

        <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200 shadow-inner shrink-0 items-center">
          <button onClick={() => onProviderChange('google')} title="Gemini" className={`flex items-center gap-1 text-xs pl-2 pr-1 py-1 rounded-l transition-all font-medium whitespace-nowrap ${provider === 'google' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>
            <Cpu size={12} /> <span className={WIDE_LABEL}>Gemini</span>
          </button>
          <select
            value={geminiVersion}
            onChange={(e) => { onGeminiVersionChange(e.target.value as GeminiVersion); onProviderChange('google'); }}
            className={`text-xs py-1 pr-1 pl-0.5 rounded-r outline-none cursor-pointer border-l ${provider === 'google' ? 'bg-white shadow-sm text-blue-600 border-blue-100' : 'bg-transparent text-gray-500 border-gray-300'}`}
          >
            <option value="3.6">3.6 Flash</option>
            <option value="3.7">3.7 Flash</option>
          </select>

          <div className="w-px h-3 bg-gray-300 mx-1"></div>

          <button onClick={() => onProviderChange('openai')} title="OpenAI 5.6" className={`flex items-center gap-1 text-xs pl-2 pr-1 py-1 rounded-l transition-all font-medium whitespace-nowrap ${provider === 'openai' ? 'bg-white shadow-sm text-green-600' : 'text-gray-500'}`}>
            <Bot size={12} /> <span className={WIDE_LABEL}>OpenAI 5.6</span>
          </button>
          <select
            value={openAiVersion}
            onChange={(e) => { onOpenAiVersionChange(e.target.value as OpenAiVersion); onProviderChange('openai'); }}
            className={`text-xs py-1 pr-1 pl-0.5 rounded-r outline-none cursor-pointer border-l ${provider === 'openai' ? 'bg-white shadow-sm text-green-600 border-green-100' : 'bg-transparent text-gray-500 border-gray-300'}`}
          >
            <option value="sol">Sol</option>
            <option value="terra">Terra</option>
          </select>
        </div>

        <div className="relative flex items-center shrink-0">
          <Key size={14} className="text-gray-400 absolute left-2 pointer-events-none" />
          <input
            type="password"
            placeholder="API Key"
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            autoComplete="new-password"
            data-1p-ignore="true"
            data-lpignore="true"
            spellCheck="false"
            className={`border rounded-md pl-7 pr-2 py-1 text-xs w-28 focus:w-48 transition-all focus:outline-none focus:ring-1 ${provider === 'google' ? 'focus:ring-blue-500' : 'focus:ring-green-500'}`}
          />
        </div>
      </div>
    </header>
  );
}
