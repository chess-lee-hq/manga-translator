export function buildCacheKey(filename: string, size: number): string {
  return `manga-cache-unified-${filename}-${size}`;
}
