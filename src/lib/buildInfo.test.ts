import { describe, expect, it } from 'vitest';
import { formatBuildTime, isNewerBuild } from './buildInfo';

describe('buildInfo', () => {
  const current = { time: '2026-10-21T06:00:00.000Z', commit: 'aaa1111', latest: '추가 수정 46' };

  it('배포된 버전이 더 늦게 빌드된 다른 커밋이면 새 버전', () => {
    expect(isNewerBuild({ time: '2026-10-22T06:00:00.000Z', commit: 'bbb2222', latest: '' }, current)).toBe(true);
  });

  it('같은 커밋·더 이른 빌드·정보 없음이면 새 버전 아님', () => {
    expect(isNewerBuild({ ...current }, current)).toBe(false);
    expect(isNewerBuild({ time: '2026-10-20T06:00:00.000Z', commit: 'ccc3333', latest: '' }, current)).toBe(false);
    expect(isNewerBuild(null, current)).toBe(false);
    expect(isNewerBuild({ time: '2026-10-22T06:00:00.000Z', commit: 'bbb2222', latest: '' }, { time: '', commit: '', latest: '' })).toBe(false);
  });

  it('빌드 시각을 "월 일 시:분"으로', () => {
    expect(formatBuildTime('2026-10-22T05:07:00')).toBe('10월 22일 05:07');
    expect(formatBuildTime('')).toBe('');
  });
});
