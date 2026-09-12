import { useState } from 'react';
import { downloadFromGoogleDrive, listMangaSaves, uploadToGoogleDrive } from '../lib/drive';

declare global {
  interface Window {
    google: any;
  }
}

const DEFAULT_CLIENT_ID = '499460859404-ub21a3onu2807hmeei71110c5d3b4ugo.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface DriveFile {
  id: string;
  name: string;
  createdTime: string;
  size: string;
}

function requestDriveToken(clientId: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) {
      reject(new Error('구글 로그인 스크립트를 아직 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'));
      return;
    }
    try {
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: (response: any) => {
          if (response.error !== undefined) {
            reject(new Error(response.error_description || response.error));
            return;
          }
          resolve(response.access_token);
        },
        // 팝업을 닫거나 열지 못한 경우. 이 콜백이 없으면 Promise가 끝나지 않아 버튼이 로딩 상태로 고정됨
        error_callback: (err: any) => {
          reject(new Error(err?.type === 'popup_closed' ? 'POPUP_CLOSED' : `구글 로그인 실패 (${err?.type ?? 'unknown'})`));
        },
      });
      client.requestAccessToken();
    } catch (err) {
      reject(err);
    }
  });
}

interface Options {
  buildBackupZip: () => Promise<Blob>;
  defaultFilename: () => string;
  /** 백업 ZIP을 복원하고 사용자에게 보여줄 결과 메시지를 돌려줍니다. */
  restoreBackup: (zipBlob: Blob, filename: string) => Promise<string>;
  /** 저장에 사용한 파일 이름 (다음 저장 때 같은 파일을 덮어쓰도록 기억) */
  onSaved?: (filename: string) => void;
}

export function useDriveSync({ buildBackupZip, defaultFilename, restoreBackup, onSaved }: Options) {
  const [clientId] = useState(() => localStorage.getItem('googleClientId') || DEFAULT_CLIENT_ID);
  const [token, setToken] = useState<string | null>(null);
  const [isDriveSyncing, setIsDriveSyncing] = useState(false);
  /** null이면 파일 목록 창이 닫힌 상태 */
  const [driveFiles, setDriveFiles] = useState<DriveFile[] | null>(null);

  const getToken = async () => {
    if (token) return token;
    const newToken = await requestDriveToken(clientId);
    setToken(newToken);
    return newToken;
  };

  const run = async (action: string, task: () => Promise<void>) => {
    setIsDriveSyncing(true);
    try {
      await task();
    } catch (e: any) {
      if (e?.message === 'POPUP_CLOSED') return; // 사용자가 팝업을 닫은 경우는 조용히 종료
      console.error(e);
      if (e?.message === 'AUTH_EXPIRED') {
        setToken(null);
        alert('구글 로그인 인증이 만료되었습니다. 다시 시도해주세요.');
      } else {
        alert(`${action} 실패: ${e?.message ?? e}`);
      }
    } finally {
      setIsDriveSyncing(false);
    }
  };

  const saveToDrive = () => {
    const filename = window.prompt('구글 드라이브에 저장할 파일 이름을 입력해주세요 (확장자 .zip 포함)\n같은 이름이면 드라이브의 기존 파일을 덮어씁니다.', defaultFilename());
    if (!filename) return;
    return run('구글 드라이브 저장', async () => {
      const accessToken = await getToken();
      await uploadToGoogleDrive(accessToken, await buildBackupZip(), filename);
      onSaved?.(filename);
      alert(`구글 드라이브에 저장했습니다.\n${filename}`);
    });
  };

  const openDriveFiles = () =>
    run('구글 드라이브 파일 목록 불러오기', async () => {
      setDriveFiles(await listMangaSaves(await getToken()));
    });

  const closeDriveFiles = () => setDriveFiles(null);

  const loadDriveFile = (fileId: string, filename: string) => {
    setDriveFiles(null);
    return run('파일 불러오기', async () => {
      const zipBlob = await downloadFromGoogleDrive(await getToken(), fileId);
      alert(await restoreBackup(zipBlob, filename));
    });
  };

  return { isDriveSyncing, driveFiles, saveToDrive, openDriveFiles, closeDriveFiles, loadDriveFile };
}
