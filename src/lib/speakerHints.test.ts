import { describe, expect, it } from 'vitest';
import { assignSpeakers, buildSpeakerHint } from './speakerHints';
import type { BoundingBox } from './yoloPostprocess';

const b = (classId: number, xmin: number, ymin: number, xmax: number, ymax: number): BoundingBox => ({ classId, xmin, ymin, xmax, ymax, confidence: 0.9 });
const FACE = 1, BODY = 0, FRAME = 2, TEXT = 3;

describe('assignSpeakers', () => {
  // 1000×1000 페이지, 위쪽 컷(0~500)에 인물 둘, 아래 컷(500~1000)에 인물 하나
  const frames = [b(FRAME, 0, 0, 1000, 480), b(FRAME, 0, 520, 1000, 1000)];
  const faceLeft = b(FACE, 100, 250, 200, 350);
  const faceRight = b(FACE, 800, 250, 900, 350);
  const faceBottom = b(FACE, 450, 800, 550, 900);

  it('같은 컷 안에서 가장 가까운 얼굴을 화자로 고른다', () => {
    const texts = [b(TEXT, 100, 50, 200, 200), b(TEXT, 800, 50, 900, 200), b(TEXT, 120, 60, 180, 150)];
    const speakers = assignSpeakers(texts, [...frames, faceLeft, faceRight, faceBottom, ...texts], 1000, 1000);
    expect(speakers[0]).toBe(speakers[2]);          // 둘 다 왼쪽 인물
    expect(speakers[0]).not.toBe(speakers[1]);      // 오른쪽 인물은 다름
    expect(speakers[0]).toMatch(/^0:f/);
  });

  it('다른 컷의 얼굴이 더 가까워도 같은 컷의 인물만 본다', () => {
    // 위 컷 아래쪽 끝의 말풍선: 아래 컷 얼굴이 더 가깝지만 위 컷 인물로 판단
    const text = b(TEXT, 450, 400, 550, 470);
    const [speaker] = assignSpeakers([text], [...frames, faceBottom, b(FACE, 400, 200, 500, 300)], 1000, 1000);
    expect(speaker).toMatch(/^0:f/);
  });

  it('인물이 너무 멀거나 없으면 null', () => {
    const text = b(TEXT, 900, 900, 990, 990);
    expect(assignSpeakers([text], [b(FACE, 0, 0, 50, 50)], 1000, 1000)).toEqual([null]);
    expect(assignSpeakers([text], [], 1000, 1000)).toEqual([null]);
  });

  it('두 인물이 거의 같은 거리면 애매해서 null', () => {
    const text = b(TEXT, 480, 100, 520, 200);
    const speakers = assignSpeakers([text], [b(FACE, 380, 100, 440, 200), b(FACE, 560, 100, 620, 200)], 1000, 1000);
    expect(speakers).toEqual([null]);
  });

  it('얼굴이 없으면 몸(머리 쪽)을 쓴다', () => {
    const text = b(TEXT, 300, 50, 400, 150);
    const [speaker] = assignSpeakers([text], [b(BODY, 280, 150, 420, 600)], 1000, 1000);
    expect(speaker).toBe('-1:b0');
  });
});

describe('buildSpeakerHint', () => {
  it('같은 컷의 화자 묶음을 알려준다', () => {
    const hint = buildSpeakerHint([
      { id: 1, speaker: 'p|0:f0' }, { id: 2, speaker: 'p|0:f1' }, { id: 3, speaker: 'p|0:f0' }, { id: 4, speaker: null },
    ]);
    expect(hint).toContain('- 같은 컷: #1·#3 / #2 (묶음마다 다른 인물)');
    expect(hint).toContain('틀릴 수 있음');
  });

  it('컷을 모르면 다른 인물이라고 단정하지 않고 같은 인물 묶음만 알려준다', () => {
    const hint = buildSpeakerHint([
      { id: 1, speaker: 'p|-1:f0' }, { id: 2, speaker: 'p|-1:f1' }, { id: 3, speaker: 'p|-1:f0' },
    ]);
    expect(hint).toContain('- 같은 인물: #1·#3');
    expect(hint).not.toContain('다른 인물');
  });

  it('여러 페이지를 묶어도 페이지끼리 섞지 않는다', () => {
    const hint = buildSpeakerHint([
      { id: 1, speaker: 'A|0:f0' }, { id: 2, speaker: 'A|0:f1' },
      { id: 3, speaker: 'B|0:f0' }, { id: 4, speaker: 'B|0:f0' },
    ]);
    expect(hint).toContain('- 같은 컷: #1 / #2 (묶음마다 다른 인물)');
    expect(hint).toContain('- 같은 인물: #3·#4');
  });

  it('알려줄 정보가 없으면 빈 문자열 (화자가 한 칸뿐이거나 모두 모름)', () => {
    expect(buildSpeakerHint([{ id: 1, speaker: 'p|0:f0' }, { id: 2, speaker: null }])).toBe('');
    expect(buildSpeakerHint([])).toBe('');
  });
});

describe('격자 프롬프트에 화자 힌트 반영', () => {
  it('힌트가 있으면 프롬프트에 들어가고, 없으면 흔적이 남지 않는다', async () => {
    const { buildGridPrompt } = await import('./translationPrompt');
    const hint = buildSpeakerHint([{ id: 1, speaker: 'p|0:f0' }, { id: 2, speaker: 'p|0:f1' }]);
    expect(buildGridPrompt({ expectedCells: 2, speakerHint: hint })).toContain('- 같은 컷: #1 / #2');
    expect(buildGridPrompt({ expectedCells: 2 })).not.toContain('화자 힌트');
  });
});
