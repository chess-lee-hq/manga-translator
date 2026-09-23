import { describe, expect, it } from 'vitest';
import { appendImages, mergeImages } from './importFiles';

const page = (sortKey: string, size = 100) => ({ sortKey, file: { name: sortKey.split('/').pop()!, size } });

describe('mergeImages', () => {
  it('같은 파일(이름+크기)은 건너뛰고 자연 정렬한다', () => {
    const merged = mergeImages([page('2.jpg'), page('10.jpg')], [page('1.jpg'), page('2.jpg'), page('11.jpg')]);
    expect(merged.map(p => p.sortKey)).toEqual(['1.jpg', '2.jpg', '10.jpg', '11.jpg']);
  });

  it('이름이 같아도 크기가 다르면 다른 파일로 본다', () => {
    const merged = mergeImages([page('ch1/001.jpg', 100)], [page('ch2/001.jpg', 200)]);
    expect(merged.map(p => p.sortKey)).toEqual(['ch1/001.jpg', 'ch2/001.jpg']);
  });
});

describe('appendImages — 다른 권을 뒤에 이어 붙이기', () => {
  const vol = (tag: string, size: number) => ['001.jpg', '002.jpg', '003.jpg'].map((name, i) => ({ file: { name, size: size + i }, sortKey: name, tag }));

  it('권마다 001.jpg로 시작해도 섞이지 않고 1권 뒤에 2권이 붙는다', () => {
    const appended = appendImages(vol('1권', 1000), vol('2권', 5000));
    expect(appended.map(p => `${p.tag}:${p.sortKey}`)).toEqual([
      '1권:001.jpg', '1권:002.jpg', '1권:003.jpg', '2권:001.jpg', '2권:002.jpg', '2권:003.jpg',
    ]);
    // 참고: 전체를 다시 정렬하는 mergeImages는 번갈아 섞임 (그래서 압축 파일 이어 붙이기에는 쓰지 않음)
    expect(mergeImages(vol('1권', 1000), vol('2권', 5000))[1].tag).toBe('2권');
  });

  it('이미 있는 같은 파일(이름+크기)은 다시 붙이지 않는다', () => {
    expect(appendImages(vol('1권', 1000), vol('1권', 1000))).toHaveLength(3);
  });
});
