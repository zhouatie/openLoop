/** 工作区路径的展示与解析：下拉、浏览面板与侧栏共用同一套写法 */

/** 格式化精炼路径，例如将 /Users/username/My/project 显示为 ~/My/project */
export function formatCompactPath(fullPath: string): string {
  if (!fullPath) return '';
  // 替换 macOS / Linux 用户主目录前缀
  const macHomeMatch = fullPath.match(/^\/Users\/[^/]+(\/.*)?$/);
  if (macHomeMatch) {
    return `~${macHomeMatch[1] || ''}`;
  }
  const linuxHomeMatch = fullPath.match(/^\/home\/[^/]+(\/.*)?$/);
  if (linuxHomeMatch) {
    return `~${linuxHomeMatch[1] || ''}`;
  }
  return fullPath;
}

/** 获取路径最后一级目录名作为项目名 */
export function getWorkspaceDirName(fullPath: string): string {
  if (!fullPath) return '';
  const trimmed = fullPath.replace(/[/\\]+$/, '');
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || fullPath;
}

/**
 * 面包屑用的路径分段：`~` 开头按主目录缩写展开，每段带自己的绝对路径。
 * 根路径返回空数组，调用方自行决定如何显示。
 */
export function pathSegments(fullPath: string): Array<{ name: string; path: string }> {
  if (!fullPath) return [];
  const compact = formatCompactPath(fullPath);
  // 非主目录子树：从根开始逐级拼出绝对路径
  if (!compact.startsWith('~')) {
    const segments: Array<{ name: string; path: string }> = [];
    let cursor = '';
    for (const part of compact.split('/').filter(Boolean)) {
      cursor = `${cursor}/${part}`;
      segments.push({ name: part, path: cursor });
    }
    return segments;
  }

  const home = fullPath
    .slice(0, fullPath.length - compact.length + 1)
    .replace(/\/+$/, '');
  const segments: Array<{ name: string; path: string }> = [{ name: '~', path: home }];
  let cursor = home;
  for (const part of compact.slice(2).split('/').filter(Boolean)) {
    cursor = `${cursor}/${part}`;
    segments.push({ name: part, path: cursor });
  }
  return segments;
}
