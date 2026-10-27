/** 文件名 → 语法名映射。DSH 原实现来自 @deepseek-ai/dsh-util-code-language，
    这里只保留代码卡标题需要的常见后缀，未知后缀返回 undefined。 */
const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'vue',
  svelte: 'svelte',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  m: 'objectivec',
  mm: 'objectivec',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  ps1: 'powershell',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  md: 'markdown',
  mdx: 'markdown',
  xml: 'xml',
  svg: 'xml',
  diff: 'diff',
  patch: 'diff',
  dockerfile: 'docker',
  makefile: 'makefile',
};

/** 取路径最后一段后缀对应的语法名 */
export function languageForPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const name = path.split(/[\\/]/).pop() || path;
  const lower = name.toLowerCase();
  if (lower === 'dockerfile') return 'docker';
  if (lower === 'makefile') return 'makefile';
  const dot = lower.lastIndexOf('.');
  if (dot <= 0) return undefined;
  return EXTENSION_LANGUAGE[lower.slice(dot + 1)];
}
