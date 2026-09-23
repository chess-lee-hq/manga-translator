import { ArrowLeftRight, BarChart3, BookOpen, Bot, Cloud, Cpu, Download, GripVertical, Image as ImageIcon, Key, Layers, Loader2, NotebookPen, PanelRight, Trash2, Upload, X, Zap, ZapOff, ZoomIn, ZoomOut } from 'lucide-react';
import type { GeminiVersion, MainEngine, OpenAiVersion, ScriptStyle, ViewMode } from '../types';
import { getUsageByModel, sumUsage } from '../lib/usageLog';
import { formatTokens, useUsageVersion } from './UsageModal';

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
  isDriveSyncing: boolean;
  /** 드라이브에 저장(덮어쓰기)할 파일 이름 */
  driveTargetName: string | null;
  onSaveToDrive: () => void;
  onOpenGlossary: () => void;
  /** 확인을 기다리는 단어장 후보 수 */
  glossaryCandidateCount: number;
  onOpenWorkNotes: () => void;
  onClearCache: () => void;
  onOpenUsage: () => void;
  onCloseSession: () => void;
  autoTranslate: boolean;
  onToggleAutoTranslate: () => void;
  /** 1차 번역을 맡는 엔진. 나머지 한 쪽은 재요청(다시 읽기) 보조로만 쓰임 */
  mainEngine: MainEngine;
  onSwapEngines: () => void;
  openAiVersion: OpenAiVersion;
  onOpenAiVersionChange: (version: OpenAiVersion) => void;
  openaiKey: string;
  onOpenaiKeyChange: (value: string) => void;
  /** 선택 사항: 품질 검사에 걸린 칸을 다시 읽는 보조 엔진 */
  geminiVersion: GeminiVersion;
  onGeminiVersionChange: (version: GeminiVersion) => void;
  googleKey: string;
  onGoogleKeyChange: (value: string) => void;
}

/** 화면이 넓을 때만 버튼 글자를 보여줍니다. 좁으면 아이콘만 남기고 마우스를 올리면 이름이 보입니다. */
const WIDE_LABEL = 'hidden min-[1900px]:inline';
const actionButton = 'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border whitespace-nowrap shrink-0 disabled:opacity-50';

const ENGINE_ACCENT = {
  green: { text: 'text-green-600', textDim: 'text-green-700/70', border: 'border-green-200', bg: 'bg-green-50/60', ring: 'focus-within:ring-green-500' },
  blue: { text: 'text-blue-600', textDim: 'text-blue-700/70', border: 'border-blue-200', bg: 'bg-blue-50/60', ring: 'focus-within:ring-blue-500' },
} as const;

interface EngineSlotProps<V extends string> {
  role: 'main' | 'secondary';
  icon: React.ReactNode;
  label: string;
  accent: keyof typeof ENGINE_ACCENT;
  version: V;
  onVersionChange: (value: V) => void;
  versionOptions: [V, string][];
  versionTitle: string;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  keyPlaceholder: string;
}

/**
 * 엔진 하나(모델 버전 선택 + 키 입력)를 보여줍니다. 메인은 진하게, 서브는 점선 테두리로 구분해
 * 지금 어느 쪽이 1차 번역을 맡고 있는지 한눈에 알 수 있게 합니다.
 */
function EngineSlot<V extends string>({
  role, icon, label, accent, version, onVersionChange, versionOptions, versionTitle, apiKey, onApiKeyChange, keyPlaceholder,
}: EngineSlotProps<V>) {
  const isMain = role === 'main';
  const c = ENGINE_ACCENT[accent];

  return (
    <div
      className={`flex items-center shrink-0 border rounded-md ${c.ring} ${isMain ? `${c.border} ${c.bg}` : 'border-dashed border-gray-300 bg-transparent'}`}
      title={isMain ? `메인: 1차 번역(원문 인식·번역)을 이 엔진이 처리합니다. ${keyPlaceholder}가 필요합니다.` : '서브: 품질 검사에 걸린 칸만 이 엔진이 고해상도로 다시 읽습니다. 키는 선택 사항입니다.'}
    >
      <span className={`flex items-center gap-1 pl-2 pr-1 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${isMain ? c.text : 'text-gray-400'}`}>
        {isMain ? '메인' : '서브'}
      </span>
      <span className={`flex items-center gap-1 pr-1 text-xs font-medium whitespace-nowrap ${isMain ? c.text : c.textDim}`}>
        {icon} <span className={WIDE_LABEL}>{label}</span>
      </span>
      <select
        value={version}
        onChange={(e) => onVersionChange(e.target.value as V)}
        title={versionTitle}
        className={`text-xs py-1 pr-1 bg-transparent outline-none cursor-pointer ${isMain ? c.text : 'text-gray-400'}`}
      >
        {versionOptions.map(([value, optionLabel]) => (
          <option key={value} value={value}>{optionLabel}</option>
        ))}
      </select>
      <div className="relative flex items-center border-l border-gray-200/70">
        {isMain && <Key size={12} className="text-gray-400 absolute left-2 pointer-events-none" />}
        <input
          type="password"
          placeholder={isMain ? keyPlaceholder : `${keyPlaceholder} (선택)`}
          title={isMain ? `${keyPlaceholder} (필수)` : `${keyPlaceholder} (선택)`}
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          autoComplete="new-password"
          data-1p-ignore="true"
          data-lpignore="true"
          spellCheck="false"
          className={`rounded-r-md py-1 text-xs w-24 focus:w-44 transition-all outline-none bg-transparent ${isMain ? 'pl-6 pr-2' : 'px-2'}`}
        />
      </div>
    </div>
  );
}

export function AppHeader(props: AppHeaderProps) {
  const {
    loadedFilename, imageCount, viewMode, onToggleViewMode, scriptStyle, onScriptStyleChange, isEditingBoxes, onToggleEditingBoxes,
    scale, onZoomIn, onZoomOut, onAddFiles, exportProgress, onExportAll, isDriveSyncing, driveTargetName, onSaveToDrive, onOpenGlossary, glossaryCandidateCount, onOpenWorkNotes,
    onClearCache, onOpenUsage, onCloseSession, autoTranslate, onToggleAutoTranslate, mainEngine, onSwapEngines,
    openAiVersion, onOpenAiVersionChange, openaiKey, onOpenaiKeyChange, geminiVersion, onGeminiVersionChange, googleKey, onGoogleKeyChange,
  } = props;
  const hasImages = imageCount > 0;
  useUsageVersion();
  const sessionUsage = sumUsage(getUsageByModel('session'));

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
            <button onClick={onSaveToDrive} disabled={isDriveSyncing} title={driveTargetName ? `구글 드라이브에 저장 — "${driveTargetName}" 덮어쓰기` : '구글 드라이브에 저장'} className={`${actionButton} bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100`}>
              {isDriveSyncing ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />} <span className={WIDE_LABEL}>드라이브</span>
            </button>
            <button
              onClick={onOpenGlossary}
              title={glossaryCandidateCount > 0 ? `단어장 — 번역 기록에서 찾은 추천 용어 ${glossaryCandidateCount}개가 확인을 기다립니다` : '단어장'}
              className={`${actionButton} relative bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100`}
            >
              <BookOpen size={14} /> <span className={WIDE_LABEL}>단어장</span>
              {glossaryCandidateCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-purple-600 text-white text-[10px] leading-4 text-center font-bold">
                  {glossaryCandidateCount}
                </span>
              )}
            </button>
            <button onClick={onOpenWorkNotes} title="작품 노트: 인물 말투·호칭을 기억해 다음 번역에 반영" className={`${actionButton} bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100`}>
              <NotebookPen size={14} /> <span className={WIDE_LABEL}>작품 노트</span>
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
          onClick={onOpenUsage}
          title={`토큰 사용량 — 이번 세션 ${sessionUsage.calls}회 요청, 입력 ${sessionUsage.inputTokens.toLocaleString()} / 출력 ${sessionUsage.outputTokens.toLocaleString()} 토큰`}
          className={`${actionButton} bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100`}
        >
          <BarChart3 size={12} /> {sessionUsage.calls > 0 ? formatTokens(sessionUsage.inputTokens + sessionUsage.outputTokens) : <span className={WIDE_LABEL}>사용량</span>}
        </button>

        <button
          onClick={onToggleAutoTranslate}
          title={autoTranslate ? '자동 번역 ON: 페이지를 넘기면 보이는 페이지와 다음 페이지들을 자동으로 번역합니다. 클릭하면 끕니다.' : '자동 번역 OFF: 대본 패널에서 페이지별로 번역할 수 있습니다.'}
          className={`${actionButton} ${autoTranslate ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200'}`}
        >
          {autoTranslate ? <Zap size={12} /> : <ZapOff size={12} />} <span className={WIDE_LABEL}>자동 번역</span> {autoTranslate ? 'ON' : 'OFF'}
        </button>

        {/* 번역 엔진: 메인이 1차 번역(원문 인식·번역)을 맡고, 서브는 품질 검사에 걸린 칸만 다시 읽음 */}
        <EngineSlot
          role={mainEngine === 'openai' ? 'main' : 'secondary'}
          icon={<Bot size={12} />}
          label="OpenAI"
          accent="green"
          version={openAiVersion}
          onVersionChange={onOpenAiVersionChange}
          versionOptions={[['terra', '5.6 Terra'], ['sol', '6 Sol'], ['luna', '6 Luna']]}
          versionTitle="5.6 Terra: 기본값(일본어 인식 안정적) / 6 Sol: 가장 강한 인식·번역 / 6 Luna: 시험용 — 고어체·붓글씨체를 잘못 읽는 경우가 있음"
          apiKey={openaiKey}
          onApiKeyChange={onOpenaiKeyChange}
          keyPlaceholder="OpenAI Key"
        />

        <button
          onClick={onSwapEngines}
          title={`메인·서브 역할 바꾸기 → ${mainEngine === 'openai' ? 'Gemini' : 'OpenAI'}가 메인이 됩니다`}
          className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
        >
          <ArrowLeftRight size={14} />
        </button>

        <EngineSlot
          role={mainEngine === 'gemini' ? 'main' : 'secondary'}
          icon={<Cpu size={12} />}
          label="Gemini"
          accent="blue"
          version={geminiVersion}
          onVersionChange={onGeminiVersionChange}
          versionOptions={[['3.6', '3.6 Flash'], ['3.7', '3.7 Flash']]}
          versionTitle="번역·다시 읽기에 쓸 Gemini 모델"
          apiKey={googleKey}
          onApiKeyChange={onGoogleKeyChange}
          keyPlaceholder="Gemini Key"
        />
      </div>
    </header>
  );
}
