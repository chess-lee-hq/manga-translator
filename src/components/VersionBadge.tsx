import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { BUILD_INFO, fetchDeployedBuildInfo, formatBuildTime, isNewerBuild, type BuildInfo } from '../lib/buildInfo';

/** 새 배포 확인 주기 (탭을 오래 열어 둘 때) */
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 헤더의 배포 버전 표시 (항상 보임, 마우스를 올리면 최근 업데이트). 더 새 배포가 올라와 있으면 옆에 새로고침 버튼.
 * 처음 열 때 · 10분마다 · 창으로 돌아올 때 version.json을 확인
 */
export function VersionBadge() {
  const [deployed, setDeployed] = useState<BuildInfo | null>(null);

  useEffect(() => {
    let alive = true;
    const check = () => {
      fetchDeployedBuildInfo().then(info => {
        if (alive && info) setDeployed(info);
      });
    };
    check();
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const time = formatBuildTime(BUILD_INFO.time);
  const outdated = isNewerBuild(deployed);
  const detail = [
    `배포 버전: ${time || '개발 중'}${BUILD_INFO.commit ? ` (${BUILD_INFO.commit})` : ''}`,
    BUILD_INFO.latest && `최근 업데이트: ${BUILD_INFO.latest}`,
  ].filter(Boolean).join('\n');

  return (
    <>
      <span title={detail} className="text-[10px] text-gray-400 whitespace-nowrap shrink-0 cursor-default">
        {time ? `버전 ${time}` : '개발 중'}
      </span>
      {outdated && deployed && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          title={`새 버전: ${formatBuildTime(deployed.time)}${deployed.latest ? `\n${deployed.latest}` : ''}\n누르면 새로고침해서 적용합니다 (번역 기록은 그대로)`}
          className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[11px] font-bold whitespace-nowrap shrink-0 hover:bg-amber-500 animate-pulse"
        >
          <RefreshCw size={11} /> 새 버전 · 새로고침
        </button>
      )}
    </>
  );
}
