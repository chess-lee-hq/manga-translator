export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 일부 브라우저는 click 직후 revoke하면 다운로드가 취소되므로 약간 늦춥니다.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
