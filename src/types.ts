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
/** 1차 번역을 맡는 엔진. 나머지 한 쪽은 품질 검사 재요청(다시 읽기)만 담당 */
export type MainEngine = 'openai' | 'gemini';
export type ViewMode = '1page' | '2page';
export type ScriptStyle = 'side' | 'overlay';
/** [ymin, xmin, ymax, xmax], 0~1000 정규화 좌표 */
export type Box2d = [number, number, number, number];
export type TranslationCache = Record<string, TranslationResult[]>;
export type Glossary = Record<string, string>;

export interface TranslationSettings {
  /** 1차 번역(페이지·영역·재번역·작품 노트)을 맡는 엔진. 이 엔진의 키는 필수 */
  mainEngine: MainEngine;
  openaiKey: string;
  openAiVersion: OpenAiVersion;
  /** mainEngine이 openai면 선택 사항(재요청 보조), gemini면 1차 번역용(필수) */
  googleKey: string;
  geminiVersion: GeminiVersion;
  glossary: Glossary;
  /** (B) 작품 노트 — 작품 단위로만 바뀌므로 프롬프트 앞쪽(캐시 구간)에 들어감 */
  context?: string;
  /** (C) 직전 대사·내 교정 — 요청마다 바뀌므로 프롬프트 맨 뒤에 들어감 */
  recentContext?: string;
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
