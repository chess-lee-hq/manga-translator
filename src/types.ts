import type { TranslationResult } from './lib/gemini';

export type { TranslationResult };

export interface UploadedImage {
  src: string;
  file: File;
  mimeType: string;
  /** 정렬 기준: ZIP 내부 전체 경로 또는 파일 이름 */
  sortKey: string;
  width: number;
  height: number;
  isSpread: boolean;
}

export type GeminiVersion = '3.6' | '3.7';
export type OpenAiVersion = 'sol' | 'terra';
export type ViewMode = '1page' | '2page';
export type ScriptStyle = 'side' | 'overlay';
/** [ymin, xmin, ymax, xmax], 0~1000 정규화 좌표 */
export type Box2d = [number, number, number, number];
export type TranslationCache = Record<string, TranslationResult[]>;
export type Glossary = Record<string, string>;

export interface TranslationSettings {
  openaiKey: string;
  openAiVersion: OpenAiVersion;
  /** 선택: 있으면 품질 검사에 걸린 칸의 재요청을 Gemini로 보내 다른 눈으로 다시 읽음 */
  googleKey: string;
  geminiVersion: GeminiVersion;
  glossary: Glossary;
  /** 앞 페이지 번역·작품 노트로 만든 맥락 지시문 (프롬프트에 그대로 삽입) */
  context?: string;
}

export interface PageError {
  message: string;
  /** 실패 당시의 제공자·키. 키를 바꾸면 실패했던 페이지도 자동으로 다시 시도함 */
  credential: string;
}

export interface HoveredBubble {
  imageIndex: number;
  bubbleIndex: number;
}
