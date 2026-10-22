/**
 * 배포 버전 정보 (vite.config.ts가 빌드할 때 넣음). 집·회사 등 다른 컴퓨터에서 같은 버전인지 비교하고,
 * 오래 열어 둔 탭이 새 배포를 알아채는 데 씀
 */
export interface BuildInfo {
  /** 빌드 시각 (ISO) */
  time: string;
  /** git 커밋 (짧은 해시) */
  commit: string;
  /** 패치 로그의 가장 최근 "추가 수정 N — 제목 (날짜)" */
  latest: string;
}

declare const __BUILD_INFO__: BuildInfo;

export const BUILD_INFO: BuildInfo = typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__ : { time: '', commit: '', latest: '' };

/** "10월 22일 14:30" */
export function formatBuildTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 지금 배포된 버전 (version.json, 캐시 없이). 개발 서버나 오프라인이면 null */
export async function fetchDeployedBuildInfo(): Promise<BuildInfo | null> {
  try {
    const response = await fetch(`./version.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const info = (await response.json()) as Partial<BuildInfo>;
    return typeof info.commit === 'string' && typeof info.time === 'string' ? { time: info.time, commit: info.commit, latest: info.latest ?? '' } : null;
  } catch {
    return null;
  }
}

/** 배포된 버전이 지금 화면의 버전보다 새로우면 true */
export function isNewerBuild(deployed: BuildInfo | null, current: BuildInfo = BUILD_INFO): boolean {
  if (!deployed || !deployed.commit || !current.commit || deployed.commit === current.commit) return false;
  return new Date(deployed.time).getTime() > new Date(current.time).getTime();
}
