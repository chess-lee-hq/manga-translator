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
  /** 앞 페이지 번역·작품 노트로 만든 맥락 지시문 (프롬프트에 그대로 삽입) */
  context?: string;
  /**
   * [실험] true면 Gemini를 전혀 쓰지 않고 OpenAI가 이미지를 직접 읽어 원문 인식·번역까지 처리합니다.
   * 실제 품질을 비교해보기 위한 임시 토글이며, 비교가 끝나면 이 옵션과 관련 분기를 함께 제거할 예정입니다.
   */
  openAiVisionOnly?: boolean;
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
