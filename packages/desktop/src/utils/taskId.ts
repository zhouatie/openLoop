/**
 * 任务 ID 格式化与剪贴板交互工具
 */

/**
 * 将长格式任务 ID 提取为高辨识度的短编号
 * 示例：
 * - task_1792490933969_o23y -> #o23y
 * - task_sub_1792490933969_0_o23y -> #sub-1-o23y
 * - task_sub_1792490933969_o23y -> #sub-o23y
 * - task_x7ka -> #x7ka
 * - my-custom-task -> #my-custom-task
 */
export function formatShortTaskId(taskId?: string | null): string {
  if (!taskId) return '';

  const trimmed = taskId.trim();

  // 1. 子任务模式 (含带序号的 index: task_sub_<timestamp>_<index>_<hash>)
  const subWithIndexMatch = trimmed.match(/^task_sub_\d+_(\d+)_([a-zA-Z0-9]+)$/);
  if (subWithIndexMatch) {
    const [, indexStr, hash] = subWithIndexMatch;
    const indexNum = parseInt(indexStr, 10);
    return `#sub-${isNaN(indexNum) ? indexStr : indexNum + 1}-${hash}`;
  }

  // 2. 子任务模式 (不带序号: task_sub_<timestamp>_<hash>)
  const subMatch = trimmed.match(/^task_sub_\d+_([a-zA-Z0-9]+)$/);
  if (subMatch) {
    return `#sub-${subMatch[1]}`;
  }

  // 3. 标准主任务模式: task_<timestamp>_<hash>
  const taskMatch = trimmed.match(/^task_\d+_([a-zA-Z0-9]+)$/);
  if (taskMatch) {
    return `#${taskMatch[1]}`;
  }

  // 4. 简写主任务模式: task_<hash>
  const simpleTaskMatch = trimmed.match(/^task_([a-zA-Z0-9]+)$/);
  if (simpleTaskMatch) {
    return `#${simpleTaskMatch[1]}`;
  }

  // 5. 已经带 # 开头的短编号直接返回
  if (trimmed.startsWith('#')) {
    return trimmed;
  }

  // 6. 普通短 ID (<= 12 字符)，添加 # 前缀
  if (trimmed.length <= 12) {
    return `#${trimmed}`;
  }

  // 7. 通用分段 ID：尝试提取最后一段作为特征后缀
  const parts = trimmed.split(/[_-]/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (last.length >= 3 && last.length <= 8) {
      return `#${last}`;
    }
  }

  // 8. 通用兜底：保留尾部 6 位作为短标识
  return `#${trimmed.slice(-6)}`;
}

/**
 * 安全复制文本到剪贴板 (兼容现代浏览器与环境降级)
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    // 降级使用 document.execCommand
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    return false;
  }
}
