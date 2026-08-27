import JSZip from 'jszip';
import type { TranslationResult } from './gemini';

export interface MangaSaveData {
  version: string;
  timestamp: string;
  images: {
    filename: string;
    mimeType: string;
    translations: TranslationResult[];
  }[];
}

export async function uploadToGoogleDrive(
  accessToken: string,
  zipBlob: Blob,
  fileName: string
): Promise<string> {
  const metadata = {
    name: fileName,
    mimeType: 'application/zip',
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const reader = new FileReader();
  
  return new Promise((resolve, reject) => {
    reader.readAsArrayBuffer(zipBlob);
    reader.onload = async function() {
      if (!reader.result) return reject(new Error('Failed to read zip blob'));
      
      const fileData = reader.result as ArrayBuffer;
      const metadataStr = JSON.stringify(metadata);
      
      const bodyPrefix = delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        metadataStr +
        delimiter +
        'Content-Type: application/zip\r\n\r\n';

      const prefixBlob = new Blob([bodyPrefix], { type: 'text/plain' });
      const suffixBlob = new Blob([closeDelimiter], { type: 'text/plain' });
      
      const multipartBlob = new Blob([prefixBlob, fileData, suffixBlob], {
        type: `multipart/related; boundary=${boundary}`
      });

      try {
        const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
          body: multipartBlob,
        });
        
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error?.message || 'Drive upload failed');
        }
        
        const data = await response.json();
        resolve(data.id);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(new Error('FileReader error'));
  });
}

export async function listMangaSaves(accessToken: string): Promise<any[]> {
  const query = "mimeType='application/zip' and name contains 'Manga_' and trashed=false";
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,createdTime,size)&orderBy=createdTime desc`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });
  
  if (!response.ok) throw new Error('Failed to fetch file list');
  const data = await response.json();
  return data.files || [];
}

export async function downloadFromGoogleDrive(accessToken: string, fileId: string): Promise<Blob> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });
  
  if (!response.ok) throw new Error('Failed to download file');
  return await response.blob();
}

export async function createMangaZip(
  images: { file: File; src: string; mimeType: string }[],
  translations: Record<string, TranslationResult[]>,
  provider: string,
  aiModel: string
): Promise<Blob> {
  const zip = new JSZip();
  const manifest: MangaSaveData = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    images: []
  };

  const imagesFolder = zip.folder("images");
  if (!imagesFolder) throw new Error("Failed to create folder in zip");

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const ext = img.file.name.split('.').pop() || 'jpg';
    const filename = `page_${String(i).padStart(3, '0')}.${ext}`;
    
    const base64Data = img.src.split(',')[1];
    imagesFolder.file(filename, base64Data, { base64: true });

    const key = `manga-cache-${provider}-${aiModel}-${img.file.name}-${img.file.size}`;
    const result = translations[key] || [];

    manifest.images.push({
      filename,
      mimeType: img.mimeType,
      translations: result
    });
  }

  zip.file("manga_data.json", JSON.stringify(manifest, null, 2));

  return await zip.generateAsync({ type: "blob" });
}

export async function extractMangaZip(zipBlob: Blob): Promise<{
  images: { file: File; src: string; mimeType: string }[],
  translations: Record<string, TranslationResult[]>
}> {
  const zip = await JSZip.loadAsync(zipBlob);
  const dataFile = zip.file("manga_data.json");
  if (!dataFile) throw new Error("Invalid manga save file: missing manga_data.json");
  
  const manifestStr = await dataFile.async("string");
  const manifest: MangaSaveData = JSON.parse(manifestStr);
  
  const loadedImages: { file: File; src: string; mimeType: string }[] = [];
  const loadedTranslations: Record<string, TranslationResult[]> = {};
  
  const provider = 'google';
  const aiModel = 'flash';

  for (const imgData of manifest.images) {
    const imgFile = zip.file(`images/${imgData.filename}`);
    if (!imgFile) continue;

    const base64Content = await imgFile.async("base64");
    const dataUri = `data:${imgData.mimeType};base64,${base64Content}`;
    
    const byteString = atob(base64Content);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: imgData.mimeType });
    const file = new File([blob], imgData.filename, { type: imgData.mimeType, lastModified: Date.now() });

    loadedImages.push({
      file,
      src: dataUri,
      mimeType: imgData.mimeType
    });

    const key = `manga-cache-${provider}-${aiModel}-${file.name}-${file.size}`;
    loadedTranslations[key] = imgData.translations;
  }

  return { images: loadedImages, translations: loadedTranslations };
}
