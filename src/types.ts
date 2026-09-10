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

export type Provider = 'google' | 'openai';
export type GeminiVersion = '3.6' | '3.7';
export type OpenAiVersion = 'sol' | 'terra';
export type ViewMode = '1page' | '2page';
export type ScriptStyle = 'side' | 'overlay';
/** [ymin, xmin, ymax, xmax], 0~1000 정규화 좌표 */
export type Box2d = [number, number, number, number];
export type TranslationCache = Record<string, TranslationResult[]>;
export type Glossary = Record<string, string>;

export interface TranslationSettings {
  provider: Provider;
  googleKey: string;
  openaiKey: string;
  geminiVersion: GeminiVersion;
  openAiVersion: OpenAiVersion;
  glossary: Glossary;
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
