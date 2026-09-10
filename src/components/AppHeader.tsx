import { BookOpen, Bot, Cloud, Cpu, Download, GripVertical, Image as ImageIcon, Key, Layers, Loader2, PanelRight, Save, Upload, X, Zap, ZapOff, ZoomIn, ZoomOut } from 'lucide-react';
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

export function AppHeader(props: AppHeaderProps) {
  const {
    loadedFilename, imageCount, viewMode, onToggleViewMode, scriptStyle, onScriptStyleChange, isEditingBoxes, onToggleEditingBoxes,
    scale, onZoomIn, onZoomOut, onAddFiles, exportProgress, onExportAll, onExportJSON, isDriveSyncing, onSaveToDrive, onOpenGlossary,
    onClearCache, onCloseSession, autoTranslate, onToggleAutoTranslate, provider, onProviderChange, geminiVersion, onGeminiVersionChange,
    openAiVersion, onOpenAiVersionChange, apiKey, onApiKeyChange,
  } = props;
  const hasImages = imageCount > 0;

  return (
    <header className="bg-white shadow-sm border-b px-4 py-2 flex items-center justify-between z-10 shrink-0 w-full overflow-x-auto [&::-webkit-scrollbar]:hidden">
      <div className="flex items-center gap-2 shrink-0">
        <ImageIcon className="text-blue-600 shrink-0" size={24} />
        <h1 className="text-lg font-bold text-gray-800 mr-2 whitespace-nowrap shrink-0">Manga Translator</h1>
        {loadedFilename && (
          <span className="text-xs bg-indigo-100 text-indigo-700 font-medium px-2 py-0.5 rounded-full border border-indigo-200 mr-2 whitespace-nowrap shrink-0">
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
              className="flex items-center gap-1.5 px-3 py-1 bg-gray-50 hover:bg-gray-100 rounded-md transition-colors text-xs font-medium border border-gray-200 whitespace-nowrap text-gray-700 shrink-0"
            >
              <BookOpen size={14} />
              {viewMode === '1page' ? '1장' : '2장'}
            </button>

            <div className="flex bg-gray-100 p-0.5 rounded-md border border-gray-200 shrink-0">
              <button
                onClick={() => onScriptStyleChange('overlay')}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-all ${
                  scriptStyle === 'overlay' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Layers size={14} /> 덮어쓰기
              </button>
              <button
                onClick={() => onScriptStyleChange('side')}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-all ${
                  scriptStyle === 'side' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <PanelRight size={14} /> 우측 대본
              </button>
            </div>

            {scriptStyle === 'overlay' && (
              <button
                onClick={onToggleEditingBoxes}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors text-xs font-medium border whitespace-nowrap shrink-0 ${
                  isEditingBoxes ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              >
                <GripVertical size={14} /> 영역 수정
              </button>
            )}

            <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 rounded-md border border-gray-200 shrink-0 ml-1">
              <button onClick={onZoomOut} className="p-0.5 hover:bg-gray-200 rounded text-gray-600">
                <ZoomOut size={14} />
              </button>
              <span className="text-xs font-medium w-9 text-center text-gray-700">
                {Math.round(scale * 100)}%
              </span>
              <button onClick={onZoomIn} className="p-0.5 hover:bg-gray-200 rounded text-gray-600">
                <ZoomIn size={14} />
              </button>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 pl-4">
        {hasImages && (
          <>
            <button onClick={onAddFiles} className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium border border-blue-200 hover:bg-blue-100 shrink-0">
              <Upload size={14} /> 추가
            </button>
            <button onClick={onExportAll} disabled={!!exportProgress} title="번역이 입혀진 전체 페이지를 원본 해상도로 ZIP 저장" className="flex items-center gap-1 px-2 py-1 bg-orange-50 text-orange-700 rounded text-xs font-medium border border-orange-200 hover:bg-orange-100 disabled:opacity-50 shrink-0">
              {exportProgress ? <><Loader2 size={14} className="animate-spin" /> {exportProgress.done}/{exportProgress.total}</> : <><Download size={14} /> ZIP</>}
            </button>
            <button onClick={onExportJSON} className="flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-medium border border-green-200 hover:bg-green-100 shrink-0">
              <Save size={14} /> JSON
            </button>
            <button onClick={onSaveToDrive} disabled={isDriveSyncing} className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium border border-blue-200 hover:bg-blue-100 disabled:opacity-50 shrink-0">
              {isDriveSyncing ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />} 드라이브
            </button>
            <button onClick={onOpenGlossary} className="flex items-center gap-1 px-2 py-1 bg-purple-50 text-purple-700 rounded text-xs font-medium border border-purple-200 hover:bg-purple-100 shrink-0">
              <BookOpen size={14} /> 단어장
            </button>
            <button onClick={onClearCache} className="px-3 py-1.5 text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 rounded-md transition-colors shrink-0">
              기록 삭제
            </button>
            <button
              onClick={onCloseSession}
              title="현재 작업을 닫고 첫 화면으로 돌아갑니다 (번역 기록·단어장은 유지)"
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 rounded shrink-0"
            >
              <X size={14} /> 작업 닫기
            </button>

            <div className="w-px h-5 bg-gray-300 mx-1 shrink-0"></div>
          </>
        )}

        <button
          onClick={onToggleAutoTranslate}
          title={autoTranslate ? '페이지를 넘기면 보이는 페이지와 다음 페이지들을 자동으로 번역합니다. 클릭하면 끕니다.' : '자동 번역이 꺼져 있습니다. 대본 패널에서 페이지별로 번역할 수 있습니다.'}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border whitespace-nowrap shrink-0 ${autoTranslate ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200'}`}
        >
          {autoTranslate ? <Zap size={12} /> : <ZapOff size={12} />} 자동 번역 {autoTranslate ? 'ON' : 'OFF'}
        </button>

        <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200 shadow-inner shrink-0 items-center">
          <button onClick={() => onProviderChange('google')} className={`flex items-center gap-1 text-xs pl-2 pr-1 py-1 rounded-l transition-all font-medium ${provider === 'google' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}>
            <Cpu size={12} /> Gemini
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

          <button onClick={() => onProviderChange('openai')} className={`flex items-center gap-1 text-xs pl-2 pr-1 py-1 rounded-l transition-all font-medium ${provider === 'openai' ? 'bg-white shadow-sm text-green-600' : 'text-gray-500'}`}>
            <Bot size={12} /> OpenAI 5.6
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

        <div className="flex items-center shrink-0">
          <Key size={14} className="text-gray-400 absolute ml-2 pointer-events-none" />
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
