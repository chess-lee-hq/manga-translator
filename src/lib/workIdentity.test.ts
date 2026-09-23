import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCorrections, saveCorrections } from './corrections';
import { hasStoredGlossary, LEGACY_GLOSSARY_KEY, loadGlossary, saveGlossary } from './glossaryStore';
import {
  carryOverWorkData, listKnownWorks, migrateLegacyWorkData, rememberWork, resolveWork, seriesTitleOf, setWorkAlias,
  UNTITLED_KEY, UNTITLED_TITLE, workKeyOf,
} from './workIdentity';
import { loadWorkNotes, saveWorkNotes } from './workNotes';

/** 테스트용 localStorage (Node에는 없음) */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('seriesTitleOf — 파일 이름에서 권·화 번호를 뗀 작품 제목', () => {
  it.each([
    ['陽だまりの樹 01', '陽だまりの樹'],
    ['陽だまりの樹 第2巻', '陽だまりの樹'],
    ['陽だまりの樹_03', '陽だまりの樹'],
    ['陽だまりの樹 (下)', '陽だまりの樹'],
    ['陽だまりの樹 下', '陽だまりの樹'],
    ['陽だまりの樹 01-05', '陽だまりの樹'],
    ['[手塚治虫] 陽だまりの樹 第1巻', '[手塚治虫] 陽だまりの樹'],
    ['キングダム 70巻', 'キングダム'],
    ['センゴク 제3권', 'センゴク'],
    ['One Piece v01 (2003) (Digital)', 'One Piece'],
    ['Vinland Saga Vol.12', 'Vinland Saga'],
    ['ドラゴンボール #42', 'ドラゴンボール'],
    ['陽だまりの樹　０１', '陽だまりの樹'], // 전각 숫자·공백
  ])('%s → %s', (name, expected) => {
    expect(seriesTitleOf(name)).toBe(expected);
  });

  it('제목 앞쪽의 숫자나 "下"로 끝나는 낱말은 권 번호로 보지 않는다', () => {
    expect(seriesTitleOf('20世紀少年 01')).toBe('20世紀少年');
    expect(seriesTitleOf('3月のライオン 5')).toBe('3月のライオン');
    expect(seriesTitleOf('天下')).toBe('天下');
  });

  it('제목을 알 수 없는 낱장 이미지 이름은 빈 문자열', () => {
    expect(seriesTitleOf('001.jpg')).toBe('');
    expect(seriesTitleOf('page_012.png')).toBe('');
    expect(seriesTitleOf('')).toBe('');
  });
});

describe('workKeyOf / resolveWork — 같은 작품끼리 같은 저장 키', () => {
  it('전각/반각·대소문자·띄어쓰기·문장부호 차이는 같은 작품', () => {
    expect(workKeyOf('One Piece')).toBe(workKeyOf('ＯＮＥ　ＰＩＥＣＥ'));
    expect(workKeyOf('Re:Zero')).toBe(workKeyOf('re zero'));
  });

  it('같은 작품의 다른 권은 같은 키, 다른 작품은 다른 키', () => {
    const vol1 = resolveWork('陽だまりの樹 01');
    const vol2 = resolveWork('陽だまりの樹 第2巻');
    expect(vol1.key).toBe(vol2.key);
    expect(vol1.title).toBe('陽だまりの樹');
    expect(resolveWork('キングダム 01').key).not.toBe(vol1.key);
  });

  it('낱장 이미지나 빈 이름은 "이름 없는 작품"', () => {
    expect(resolveWork('001.jpg')).toMatchObject({ key: UNTITLED_KEY, title: UNTITLED_TITLE });
    expect(resolveWork('')).toMatchObject({ key: UNTITLED_KEY, title: UNTITLED_TITLE });
  });

  it('직접 지정한 이름이 자동 판별보다 우선하고, 빈 값이면 자동으로 되돌아간다', () => {
    setWorkAlias('hidamari_extra.zip', '陽だまりの樹');
    expect(resolveWork('hidamari_extra.zip')).toMatchObject({ key: workKeyOf('陽だまりの樹'), manual: true });
    setWorkAlias('hidamari_extra.zip', null);
    expect(resolveWork('hidamari_extra.zip')).toMatchObject({ title: 'hidamari extra', manual: false });
  });

  it('열었던 작품은 목록에 남는다 (이름 없는 작품은 제외)', () => {
    rememberWork(resolveWork('陽だまりの樹 01'));
    rememberWork(resolveWork('001.jpg'));
    expect(listKnownWorks()).toEqual([{ key: workKeyOf('陽だまりの樹'), title: '陽だまりの樹' }]);
  });
});

describe('migrateLegacyWorkData — 작품별로 나누기 전 데이터 옮기기', () => {
  const seedLegacy = () => {
    // 예전에는 파일 이름 그대로 저장했고, 단어장은 모든 작품이 한 개를 썼음
    saveWorkNotes('陽だまりの樹 01', { text: '1권 노트', pageCount: 10, updatedAt: '2026-09-01T00:00:00Z' });
    saveWorkNotes('陽だまりの樹 02', { text: '2권 노트 (최신)', pageCount: 20, updatedAt: '2026-09-10T00:00:00Z' });
    saveCorrections('陽だまりの樹 01', [{ original: 'あ', before: '가', after: '가!', at: '2026-09-01T00:00:00Z' }]);
    saveCorrections('陽だまりの樹 02', [{ original: 'い', before: '나', after: '나!', at: '2026-09-10T00:00:00Z' }]);
    localStorage.setItem(LEGACY_GLOSSARY_KEY, JSON.stringify({ 晴信: '하루노부', 於満津: '오마츠' }));
  };

  it('예전에 작업하던 작품: 노트는 최신 것, 교정은 합쳐서, 단어장은 예전 공통 단어장을 이어 받는다', () => {
    seedLegacy();
    const work = resolveWork('陽だまりの樹 03');
    migrateLegacyWorkData(work);

    expect(loadWorkNotes(work.key)?.text).toBe('2권 노트 (최신)');
    expect(loadCorrections(work.key).map(c => c.original).sort()).toEqual(['あ', 'い']);
    expect(loadGlossary(work.key)).toEqual({ 晴信: '하루노부', 於満津: '오마츠' });
  });

  it('처음 여는 작품은 빈 단어장으로 시작한다 (다른 작품 단어가 섞이지 않게)', () => {
    seedLegacy();
    const work = resolveWork('キングダム 01');
    migrateLegacyWorkData(work);

    expect(loadGlossary(work.key)).toEqual({});
    expect(hasStoredGlossary(work.key)).toBe(false);
    expect(loadWorkNotes(work.key)).toBeNull();
  });

  it('여러 번 불러도 이미 옮긴 뒤 바뀐 내용을 덮어쓰지 않는다', () => {
    seedLegacy();
    const work = resolveWork('陽だまりの樹 01');
    migrateLegacyWorkData(work);
    saveGlossary(work.key, { 晴信: '하루노부(수정)' });
    saveWorkNotes(work.key, { text: '새로 고친 노트', pageCount: 30, updatedAt: '2026-09-20T00:00:00Z' });

    migrateLegacyWorkData(work);
    expect(loadGlossary(work.key)).toEqual({ 晴信: '하루노부(수정)' });
    expect(loadWorkNotes(work.key)?.text).toBe('새로 고친 노트');
  });

  it('사용자가 단어장을 다 지웠으면 예전 단어장이 다시 옮겨 오지 않는다', () => {
    seedLegacy();
    const work = resolveWork('陽だまりの樹 01');
    migrateLegacyWorkData(work);
    saveGlossary(work.key, {});
    migrateLegacyWorkData(work);
    expect(loadGlossary(work.key)).toEqual({});
  });
});

describe('carryOverWorkData — 작품 이름을 바꿨을 때', () => {
  it('새 이름이 비어 있으면 지금까지의 단어장·노트를 가져간다', () => {
    saveGlossary('default', { 進: '신' });
    saveWorkNotes('default', { text: '노트', pageCount: 1, updatedAt: '' });
    carryOverWorkData('default', workKeyOf('火の鳥'));
    expect(loadGlossary(workKeyOf('火の鳥'))).toEqual({ 進: '신' });
    expect(loadWorkNotes(workKeyOf('火の鳥'))?.text).toBe('노트');
  });

  it('이미 데이터가 있는 작품에 연결하면 그 작품 것을 그대로 쓴다', () => {
    saveGlossary('a', { 進: '신' });
    saveGlossary('b', { 晴信: '하루노부' });
    carryOverWorkData('a', 'b');
    expect(loadGlossary('b')).toEqual({ 晴信: '하루노부' });
  });
});
