import type { GridTranslationResult, RawTranslationResult } from './gemini';

/**
 * 응답 JSON의 필드 이름과, 그것을 앱 내부 타입으로 바꾸는 규칙.
 *
 * 필드 이름을 `original_text`/`translated_text` 대신 짧은 `jp`/`ko`로 받습니다.
 * 출력 토큰은 입력보다 단가가 몇 배 비싼데, 이 key가 **칸마다 반복**되기 때문입니다.
 * (칸 30개면 key만으로 300토큰 이상)
 *
 * 짧은 이름은 모델이 두 필드를 헷갈릴 위험이 있어서, 반드시 **API 스키마로 형태를 강제**한 상태에서만 씁니다.
 * (OpenAI: response_format json_schema strict / Gemini: responseSchema)
 * 뜻이 남는 이름(jp·ko)을 쓰는 것도 같은 이유입니다. o·t처럼 한 글자로 줄이지 않습니다.
 */

/** 격자 응답 한 칸 */
export interface GridCellWire {
  id: number;
  jp: string;
  ko: string;
}

/** 페이지 전체 응답 한 건 (좌표는 모델이 찍음) */
export interface FullPageWire {
  box: number[];
  jp: string;
  ko: string;
}

export const gridCellToResult = (cell: GridCellWire): GridTranslationResult => ({
  id: cell.id,
  original_text: cell.jp ?? '',
  translated_text: cell.ko ?? '',
});

export const fullPageToResult = (item: FullPageWire): RawTranslationResult => ({
  original_text: item.jp ?? '',
  translated_text: item.ko ?? '',
  box_2d: (item.box ?? []) as RawTranslationResult['box_2d'],
});

/**
 * OpenAI structured outputs(json_schema, strict)용 스키마.
 * strict 모드는 모든 속성이 required이고 additionalProperties:false여야 하며, 최상위는 객체여야 합니다.
 */
export const OPENAI_GRID_SCHEMA = {
  name: 'manga_grid_translation',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      cells: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: '칸에 적힌 빨간 번호' },
            jp: { type: 'string', description: '일본어 원문' },
            ko: { type: 'string', description: '한국어 번역' },
          },
          required: ['id', 'jp', 'ko'],
          additionalProperties: false,
        },
      },
    },
    required: ['cells'],
    additionalProperties: false,
  },
} as const;

export const OPENAI_FULL_PAGE_SCHEMA = {
  name: 'manga_full_page_translation',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      cells: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            box: {
              type: 'array',
              description: '[ymin, xmin, ymax, xmax] (0~1000 정규화 정수)',
              items: { type: 'integer' },
            },
            jp: { type: 'string', description: '일본어 원문' },
            ko: { type: 'string', description: '한국어 번역' },
          },
          required: ['box', 'jp', 'ko'],
          additionalProperties: false,
        },
      },
    },
    required: ['cells'],
    additionalProperties: false,
  },
} as const;

export const OPENAI_WORK_NOTES_SCHEMA = {
  name: 'manga_work_notes',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      notes: { type: 'string' },
      glossary: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            original: { type: 'string' },
            translated: { type: 'string' },
          },
          required: ['original', 'translated'],
          additionalProperties: false,
        },
      },
    },
    required: ['notes', 'glossary'],
    additionalProperties: false,
  },
} as const;
