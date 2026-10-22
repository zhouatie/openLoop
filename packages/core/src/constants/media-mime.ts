/**
 * 图片 MIME 类型推断（纯函数，无 node 依赖，可被前端渲染层直接复用）
 */
export function guessImageMimeType(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  const ext = dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}
