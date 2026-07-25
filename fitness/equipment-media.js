/** CDN база за миниатюри — същата като worker mediaUrl. */
export const DEFAULT_MEDIA_BASE = 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/';

export function mediaUrl(relativePath, base = DEFAULT_MEDIA_BASE) {
  if (!relativePath) return '';
  if (/^https?:\/\//.test(relativePath)) return relativePath;
  return base.replace(/\/+$/, '/') + String(relativePath).replace(/^\/+/, '');
}

export function apparatusImageUrl(item, base = DEFAULT_MEDIA_BASE) {
  if (!item) return '';
  return mediaUrl(item.image, base);
}

export function apparatusThumbUrl(item, base = DEFAULT_MEDIA_BASE) {
  if (!item) return '';
  return mediaUrl(item.image || item.gif, base);
}
