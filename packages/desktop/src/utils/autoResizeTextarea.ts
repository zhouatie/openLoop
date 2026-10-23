/**
 * textarea 高度随内容自适应撑开，超过 maxHeight 后改为内部滚动。
 * 用作 ref 回调：每次渲染都会重新测量，粘贴/切换节点后同样生效。
 */
export function autoResizeTextarea(el: HTMLTextAreaElement | null, maxHeight = 400) {
  if (!el) return;
  el.style.height = 'auto';
  const contentHeight = el.scrollHeight;
  el.style.height = `${Math.min(contentHeight, maxHeight)}px`;
  el.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
}
