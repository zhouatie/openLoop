import { diffWordsWithSpace } from 'diff';

export interface DiffPart {
  text: string;
  type: 'same' | 'delete' | 'add';
}

export interface UnifiedDiffLine {
  type: 'chunk-header' | 'add' | 'delete' | 'context';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
  parts?: DiffPart[];
}

export interface SplitDiffSide {
  lineNumber?: number;
  type: 'delete' | 'add' | 'context';
  content: string;
  parts?: DiffPart[];
}

export interface SplitDiffRow {
  type: 'chunk-header' | 'diff';
  chunkContent?: string;
  left?: SplitDiffSide;
  right?: SplitDiffSide;
}

export interface ParsedFileDiffResult {
  unified: UnifiedDiffLine[];
  split: SplitDiffRow[];
}

interface DeleteLine {
  oldLineNumber: number;
  content: string;
}

interface AddLine {
  newLineNumber: number;
  content: string;
}

interface ChangePair {
  del?: DeleteLine;
  add?: AddLine;
}

/** 删除行与新增行配对的最低相似度，低于该值不做词级配对 */
const MIN_PAIR_SIMILARITY = 0.25;

/**
 * 针对两行文本进行词级（Word-level / Intra-line）差异比对
 */
function computeLineDiff(oldText: string, newText: string): { oldParts: DiffPart[]; newParts: DiffPart[] } {
  if (oldText === newText) {
    return {
      oldParts: [{ text: oldText, type: 'same' }],
      newParts: [{ text: newText, type: 'same' }],
    };
  }

  const changes = diffWordsWithSpace(oldText, newText);
  const oldParts: DiffPart[] = [];
  const newParts: DiffPart[] = [];

  for (const c of changes) {
    if (c.removed) {
      oldParts.push({ text: c.value, type: 'delete' });
    } else if (c.added) {
      newParts.push({ text: c.value, type: 'add' });
    } else {
      oldParts.push({ text: c.value, type: 'same' });
      newParts.push({ text: c.value, type: 'same' });
    }
  }

  return { oldParts, newParts };
}

/**
 * 计算两行文本公共前后缀相似度，用于多行变动时的智能对齐配对
 */
function calcLineSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const minLen = Math.min(s1.length, s2.length);
  if (minLen === 0) return 0;
  let prefix = 0;
  while (prefix < minLen && s1[prefix] === s2[prefix]) prefix++;
  let suffix = 0;
  while (suffix < minLen - prefix && s1[s1.length - 1 - suffix] === s2[s2.length - 1 - suffix]) suffix++;
  return ((prefix + suffix) * 2) / (s1.length + s2.length);
}

/**
 * 将连续的删除行块与新增行块配对。
 * 约束：配对必须保持两侧原始行序（行号单调递增），
 * 否则 Diff 面板会出现行号跳号、回退的乱序展示。
 */
function pairChangeBlocks(delBlock: DeleteLine[], addBlock: AddLine[]): ChangePair[] {
  // 行数相同：按行序一一配对，重排缩进等场景不会互相错配
  if (delBlock.length === addBlock.length) {
    return delBlock.map((del, idx) => ({ del, add: addBlock[idx] }));
  }

  const pairs: ChangePair[] = [];
  let cursor = 0;

  for (const del of delBlock) {
    let bestIdx = -1;
    let bestScore = MIN_PAIR_SIMILARITY;
    for (let j = cursor; j < addBlock.length; j++) {
      const score = calcLineSimilarity(del.content, addBlock[j].content);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }

    if (bestIdx === -1) {
      pairs.push({ del });
      continue;
    }

    // 跳过的未配对新增行先按原顺序落位，保证新行号单调递增
    for (let j = cursor; j < bestIdx; j++) {
      pairs.push({ add: addBlock[j] });
    }
    pairs.push({ del, add: addBlock[bestIdx] });
    cursor = bestIdx + 1;
  }

  for (let j = cursor; j < addBlock.length; j++) {
    pairs.push({ add: addBlock[j] });
  }

  return pairs;
}

/**
 * 解析 Git Unified Diff 文本为统一视图与分栏视图所需的行模型。
 * 输出严格保持文件原始行序。
 */
export function parseFileDiff(diffText: string): ParsedFileDiffResult {
  if (!diffText) return { unified: [], split: [] };
  const rawLines = diffText.split('\n');
  const unified: UnifiedDiffLine[] = [];
  const split: SplitDiffRow[] = [];

  let oldLine = 0;
  let newLine = 0;

  let delBlock: DeleteLine[] = [];
  let addBlock: AddLine[] = [];

  const flushBlock = () => {
    if (delBlock.length === 0 && addBlock.length === 0) return;

    for (const { del, add } of pairChangeBlocks(delBlock, addBlock)) {
      if (del && add) {
        const { oldParts, newParts } = computeLineDiff(del.content, add.content);
        unified.push({
          type: 'delete',
          oldLineNumber: del.oldLineNumber,
          content: del.content,
          parts: oldParts,
        });
        unified.push({
          type: 'add',
          newLineNumber: add.newLineNumber,
          content: add.content,
          parts: newParts,
        });
        split.push({
          type: 'diff',
          left: {
            lineNumber: del.oldLineNumber,
            type: 'delete',
            content: del.content,
            parts: oldParts,
          },
          right: {
            lineNumber: add.newLineNumber,
            type: 'add',
            content: add.content,
            parts: newParts,
          },
        });
      } else if (del) {
        unified.push({
          type: 'delete',
          oldLineNumber: del.oldLineNumber,
          content: del.content,
        });
        split.push({
          type: 'diff',
          left: {
            lineNumber: del.oldLineNumber,
            type: 'delete',
            content: del.content,
          },
          right: undefined,
        });
      } else if (add) {
        unified.push({
          type: 'add',
          newLineNumber: add.newLineNumber,
          content: add.content,
        });
        split.push({
          type: 'diff',
          left: undefined,
          right: {
            lineNumber: add.newLineNumber,
            type: 'add',
            content: add.content,
          },
        });
      }
    }

    delBlock = [];
    addBlock = [];
  };

  for (const line of rawLines) {
    if (line.startsWith('@@')) {
      flushBlock();
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      unified.push({
        type: 'chunk-header',
        content: line,
      });
      split.push({
        type: 'chunk-header',
        chunkContent: line,
      });
    } else if (
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename from') ||
      line.startsWith('rename to')
    ) {
      // 元数据行，略过展示以保持视觉极简专注
      continue;
    } else if (line.startsWith('-')) {
      if (addBlock.length > 0) {
        flushBlock();
      }
      delBlock.push({ oldLineNumber: oldLine, content: line.slice(1) });
      oldLine++;
    } else if (line.startsWith('+')) {
      addBlock.push({ newLineNumber: newLine, content: line.slice(1) });
      newLine++;
    } else if (line.startsWith(' ') || line === '') {
      flushBlock();
      const content = line.startsWith(' ') ? line.slice(1) : line;
      unified.push({
        type: 'context',
        oldLineNumber: oldLine,
        newLineNumber: newLine,
        content,
      });
      split.push({
        type: 'diff',
        left: { lineNumber: oldLine, type: 'context', content },
        right: { lineNumber: newLine, type: 'context', content },
      });
      oldLine++;
      newLine++;
    }
  }

  flushBlock();
  if (import.meta.env?.DEV) {
    console.log(
      `[DiffParser] 解析完成: ${rawLines.length} 行原始 diff → 统一视图 ${unified.length} 行 / 分栏视图 ${split.length} 行`
    );
  }
  return { unified, split };
}
