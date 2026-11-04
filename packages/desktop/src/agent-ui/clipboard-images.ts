/**
 * 剪贴板取图：截图工具有的把文件放 files，有的只放 items，两条路都要走。
 * 系统给的临时文件名常常都叫 image.png，这里统一改写成带时间的截图名，
 * 避免多张图在落盘时互相覆盖。
 */
const GENERIC_NAME = 'image.png';

let seq = 0;

function isImage(file: File | null): file is File {
  return file !== null && file.type.startsWith('image/');
}

/** 供粘贴逻辑共用：读取剪贴板里的图片文件，没有图片就返回空数组 */
export function clipboardImageFiles(clipboard: DataTransfer | null | undefined): File[] {
  if (!clipboard) return [];
  const fromFiles = Array.from(clipboard.files || []).filter(isImage);
  const picked =
    fromFiles.length > 0
      ? fromFiles
      : Array.from(clipboard.items || [])
          .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter(isImage);
  return picked.map(withScreenshotName);
}

function withScreenshotName(file: File): File {
  if (file.name && file.name !== GENERIC_NAME) return file;
  seq += 1;
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  return new File([file], `screenshot_${Date.now()}_${seq}.${ext}`, { type: file.type });
}
