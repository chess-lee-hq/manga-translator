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

/**
 * 받아 둔 드라이브 접근 권한(약 1시간 유효). 같은 탭에서 새로고침해도 다시 묻지 않도록 sessionStorage에 만료 시각과 함께 둠
 * (탭을 닫으면 사라짐. 권한은 이 앱이 만든 파일에만 접근하는 drive.file)
 */
const TOKEN_KEY = 'manga-drive-token';
/** 만료 직전에 쓰다 실패하지 않도록 이만큼 일찍 만료로 봄 */
const TOKEN_MARGIN_MS = 60_000;

interface StoredToken {
  token: string;
  expiresAt: number;
}

function loadStoredToken(): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null') as StoredToken | null;
    if (saved?.token && saved.expiresAt - TOKEN_MARGIN_MS > Date.now()) return saved.token;
  } catch {
    // 못 읽으면 새로 받음
  }
  return null;
}

function storeToken(token: string, expiresInSec: number) {
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt: Date.now() + expiresInSec * 1000 } satisfies StoredToken));
  } catch {
    // 저장 못 하면 이번 화면에서만 씀
  }
}

function clearStoredToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // 무시
  }
}

function requestDriveToken(clientId: string): Promise<{ token: string; expiresIn: number }> {
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) {
      reject(new Error('구글 로그인 스크립트를 아직 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'));
      return;
    }
    try {
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        // 이미 허락한 경우 허락 창을 다시 띄우지 않음 (처음이거나 Google이 다시 확인할 때만 뜸)
        prompt: '',
        callback: (response: any) => {
          if (response.error !== undefined) {
            reject(new Error(response.error_description || response.error));
            return;
          }
          resolve({ token: response.access_token, expiresIn: Number(response.expires_in) || 3600 });
        },
        // 팝업을 닫거나 열지 못한 경우. 이 콜백이 없으면 Promise가 끝나지 않아 버튼이 로딩 상태로 고정됨
        error_callback: (err: any) => {
          if (err?.type === 'popup_closed') reject(new Error('POPUP_CLOSED'));
          else if (err?.type === 'popup_failed_to_open') reject(new Error('구글 로그인 창이 브라우저에서 막혔습니다. 버튼을 한 번 더 눌러 주세요.'));
          else reject(new Error(`구글 로그인 실패 (${err?.type ?? 'unknown'})`));
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
  const [token, setToken] = useState<string | null>(loadStoredToken);
  const [isDriveSyncing, setIsDriveSyncing] = useState(false);
  /** null이면 파일 목록 창이 닫힌 상태 */
  const [driveFiles, setDriveFiles] = useState<DriveFile[] | null>(null);

  const getToken = async () => {
    // 만료 시각이 지난 권한은 쓰지 않고 새로 받음
    if (token && loadStoredToken() === token) return token;
    const { token: newToken, expiresIn } = await requestDriveToken(clientId);
    storeToken(newToken, expiresIn);
    setToken(newToken);
    return newToken;
  };

  const forgetToken = () => {
    clearStoredToken();
    setToken(null);
  };

  const run = async (action: string, task: (accessToken: () => Promise<string>) => Promise<void>) => {
    setIsDriveSyncing(true);
    try {
      try {
        await task(getToken);
      } catch (e: any) {
        if (e?.message !== 'AUTH_EXPIRED') throw e;
        // 권한이 만료됐으면 알림 없이 새로 받아 한 번 더 (이미 허락했으면 창이 뜨지 않음)
        forgetToken();
        let fresh: string | null = null;
        await task(async () => {
          if (!fresh) {
            const { token: newToken, expiresIn } = await requestDriveToken(clientId);
            storeToken(newToken, expiresIn);
            setToken(newToken);
            fresh = newToken;
          }
          return fresh;
        });
      }
    } catch (e: any) {
      if (e?.message === 'POPUP_CLOSED') return; // 사용자가 팝업을 닫은 경우는 조용히 종료
      console.error(e);
      if (e?.message === 'AUTH_EXPIRED') {
        forgetToken();
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
    return run('구글 드라이브 저장', async accessToken => {
      // 권한부터 받음: 로그인 창은 버튼을 누른 직후에 열어야 브라우저가 팝업을 막지 않음
      const authorized = await accessToken();
      await uploadToGoogleDrive(authorized, await buildBackupZip(), filename);
      onSaved?.(filename);
      alert(`구글 드라이브에 저장했습니다.\n${filename}`);
    });
  };

  const openDriveFiles = () =>
    run('구글 드라이브 파일 목록 불러오기', async accessToken => {
      setDriveFiles(await listMangaSaves(await accessToken()));
    });

  const closeDriveFiles = () => setDriveFiles(null);

  const loadDriveFile = (fileId: string, filename: string) => {
    setDriveFiles(null);
    return run('파일 불러오기', async accessToken => {
      const zipBlob = await downloadFromGoogleDrive(await accessToken(), fileId);
      alert(await restoreBackup(zipBlob, filename));
    });
  };

  return { isDriveSyncing, driveFiles, saveToDrive, openDriveFiles, closeDriveFiles, loadDriveFile };
}
