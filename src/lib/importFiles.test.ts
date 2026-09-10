import { describe, expect, it } from 'vitest';
import { mergeImages } from './importFiles';

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
