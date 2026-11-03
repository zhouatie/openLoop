/**
 * 极简二维码编码器：Byte 模式 / 纠错等级 M / 版本 1-10（最多 213 字节，足够扫码地址）。
 * 仅供扫码预览在本地离线渲染开发服务地址，零依赖、零网络请求。
 */

/** [每块纠错码字数, 组 1 块数, 组 1 数据码字, 组 2 块数, 组 2 数据码字] */
type RsBlock = readonly [ec: number, blocksA: number, dataA: number, blocksB: number, dataB: number];

const RS_BLOCKS_M: readonly RsBlock[] = [
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
];

const ALIGNMENT_POSITIONS: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

/** 纠错等级 M 在格式信息中的编码位 */
const EC_LEVEL_BITS_M = 0;

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(() => {
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = value;
    GF_LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();

const gfMul = (a: number, b: number): number => (a && b ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0);

class BitBuffer {
  private readonly bits: number[] = [];

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1);
  }

  get length(): number {
    return this.bits.length;
  }

  toBytes(): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (this.bits[i + j] ?? 0);
      bytes.push(byte);
    }
    return bytes;
  }
}

const dataSize = (version: number): number => {
  const [, blocksA, dataA, blocksB, dataB] = RS_BLOCKS_M[version - 1];
  return blocksA * dataA + blocksB * dataB;
};

const pickVersion = (byteLength: number): number | null => {
  for (let version = 1; version <= RS_BLOCKS_M.length; version += 1) {
    const headerBits = 4 + (version < 10 ? 8 : 16);
    if (headerBits + byteLength * 8 <= dataSize(version) * 8) return version;
  }
  return null;
};

const buildDataCodewords = (bytes: number[], version: number): number[] => {
  const capacity = dataSize(version);
  const buffer = new BitBuffer();
  buffer.push(0b0100, 4); // Byte 模式
  buffer.push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) buffer.push(byte, 8);

  for (let i = 0; i < 4 && buffer.length < capacity * 8; i += 1) buffer.push(0, 1);
  while (buffer.length % 8 !== 0) buffer.push(0, 1);

  const words = buffer.toBytes();
  for (let pad = 0xec; words.length < capacity; pad ^= 0xec ^ 0x11) words.push(pad);
  return words;
};

const generatorPoly = (ecCount: number): number[] => {
  let poly = [1];
  for (let i = 0; i < ecCount; i += 1) {
    const next = [...poly, 0];
    for (let j = 0; j < poly.length; j += 1) next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    poly = next;
  }
  return poly;
};

const reedSolomon = (data: number[], generator: number[], ecCount: number): number[] => {
  const remainder = new Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecCount; i += 1) remainder[i] ^= gfMul(generator[i + 1], factor);
  }
  return remainder;
};

const interleave = (words: number[], version: number): number[] => {
  const [ecCount, blocksA, dataA, blocksB, dataB] = RS_BLOCKS_M[version - 1];
  const generator = generatorPoly(ecCount);
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];

  let offset = 0;
  for (const [blocks, dataPerBlock] of [[blocksA, dataA], [blocksB, dataB]] as const) {
    for (let i = 0; i < blocks; i += 1) {
      const data = words.slice(offset, offset + dataPerBlock);
      offset += dataPerBlock;
      dataBlocks.push(data);
      ecBlocks.push(reedSolomon(data, generator, ecCount));
    }
  }

  const result: number[] = [];
  for (let i = 0; i < Math.max(dataA, dataB); i += 1) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i]);
  }
  for (let i = 0; i < ecCount; i += 1) {
    for (const block of ecBlocks) result.push(block[i]);
  }
  return result;
};

const formatBits = (mask: number): number => {
  const data = (EC_LEVEL_BITS_M << 3) | mask;
  let remainder = data << 10;
  for (let i = 4; i >= 0; i -= 1) {
    if (remainder & (1 << (i + 10))) remainder ^= 0x537 << i;
  }
  return ((data << 10) | remainder) ^ 0x5412;
};

const versionBits = (version: number): number => {
  let remainder = version << 12;
  for (let i = 5; i >= 0; i -= 1) {
    if (remainder & (1 << (i + 12))) remainder ^= 0x1f25 << i;
  }
  return (version << 12) | remainder;
};

const isMasked = (mask: number, row: number, col: number): boolean => {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
};

const buildMatrix = (version: number, codewords: number[], mask: number): Uint8Array => {
  const size = version * 4 + 17;
  const modules = new Uint8Array(size * size);
  const reserved = new Uint8Array(size * size);

  const put = (row: number, col: number, dark: boolean): void => {
    modules[row * size + col] = dark ? 1 : 0;
    reserved[row * size + col] = 1;
  };

  // 三个定位图形（含分隔带）
  for (const [row, col] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const ring = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        put(rr, cc, ring || core);
      }
    }
  }

  // 定时图形
  for (let i = 8; i < size - 8; i += 1) {
    put(6, i, i % 2 === 0);
    put(i, 6, i % 2 === 0);
  }

  // 校正图形
  const positions = ALIGNMENT_POSITIONS[version - 1];
  for (const row of positions) {
    for (const col of positions) {
      if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          put(row + r, col + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
        }
      }
    }
  }

  // 格式信息与固定暗点
  const fmt = formatBits(mask);
  for (let i = 0; i < 15; i += 1) {
    const dark = ((fmt >> i) & 1) === 1;
    put(i < 6 ? i : i < 8 ? i + 1 : size - 15 + i, 8, dark);
    put(8, i < 8 ? size - 1 - i : i === 8 ? 7 : 14 - i, dark);
  }
  put(size - 8, 8, true);

  // 版本信息（版本 7 及以上）
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >> i) & 1) === 1;
      const offset = size - 11 + (i % 3);
      put(offset, Math.floor(i / 3), dark);
      put(Math.floor(i / 3), offset, dark);
    }
  }

  // 数据按 Z 字形填充，逐位应用掩码
  const totalBits = codewords.length * 8;
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let offset = 0; offset < size; offset += 1) {
      const row = upward ? size - 1 - offset : offset;
      for (let k = 0; k < 2; k += 1) {
        const col = right - k;
        if (reserved[row * size + col]) continue;
        const bit = bitIndex < totalBits ? (codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1 : 0;
        bitIndex += 1;
        modules[row * size + col] = bit ^ (isMasked(mask, row, col) ? 1 : 0);
      }
    }
  }

  return modules;
};

const addRun = (length: number, history: number[], size: number): void => {
  // 首段游程需要补上符号外的浅色静区
  history.pop();
  history.unshift(history[0] === 0 ? length + size : length);
};

const countFinderPatterns = (history: number[]): number => {
  const unit = history[1];
  const core =
    unit > 0 && history[2] === unit && history[3] === unit * 3 && history[4] === unit && history[5] === unit;
  if (!core) return 0;
  return (
    (history[0] >= unit * 4 && history[6] >= unit ? 1 : 0) +
    (history[6] >= unit * 4 && history[0] >= unit ? 1 : 0)
  );
};

const terminateRuns = (runColor: number, runLength: number, history: number[], size: number): number => {
  let length = runLength;
  if (runColor === 1) {
    addRun(length, history, size);
    length = 0;
  }
  addRun(length + size, history, size);
  return countFinderPatterns(history);
};

const penaltyScore = (modules: Uint8Array, size: number): number => {
  let score = 0;

  // 规则 1：同色连续游程；规则 3：定位图形相似的 1:1:3:1:1 序列
  for (let line = 0; line < size; line += 1) {
    for (const rowMajor of [true, false]) {
      let runColor = 0;
      let runLength = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < size; i += 1) {
        const color = rowMajor ? modules[line * size + i] : modules[i * size + line];
        if (color === runColor) {
          runLength += 1;
          if (runLength === 5) score += 3;
          else if (runLength > 5) score += 1;
        } else {
          addRun(runLength, history, size);
          if (runColor === 0) score += countFinderPatterns(history) * 40;
          runColor = color;
          runLength = 1;
        }
      }
      score += terminateRuns(runColor, runLength, history, size) * 40;
    }
  }

  // 规则 2：2x2 同色块
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const first = modules[row * size + col];
      if (
        first === modules[row * size + col + 1] &&
        first === modules[(row + 1) * size + col] &&
        first === modules[(row + 1) * size + col + 1]
      ) {
        score += 3;
      }
    }
  }

  // 规则 4：深色占比偏离 50% 的幅度
  let dark = 0;
  for (const module of modules) dark += module;
  score += (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10;

  return score;
};

export interface QrCode {
  size: number;
  /** 行优先的深色模块标记 */
  modules: Uint8Array;
}

/** 编码失败（内容超出容量）时返回 null */
export function encodeQr(text: string): QrCode | null {
  if (!text) return null;
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = pickVersion(bytes.length);
  if (!version) return null;

  const codewords = interleave(buildDataCodewords(bytes, version), version);
  const size = version * 4 + 17;
  let best: Uint8Array | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const modules = buildMatrix(version, codewords, mask);
    const score = penaltyScore(modules, size);
    if (score < bestScore) {
      best = modules;
      bestScore = score;
    }
  }
  return best ? { size, modules: best } : null;
}

/** 渲染为矢量 SVG 字符串：单路径绘制 + crispEdges，任何尺寸下均锐利清晰 */
export function qrSvgMarkup(text: string, options: { quietZone?: number; color?: string } = {}): string | null {
  const qr = encodeQr(text);
  if (!qr) return null;

  const quietZone = options.quietZone ?? 2;
  const dimension = qr.size + quietZone * 2;
  let path = '';
  for (let row = 0; row < qr.size; row += 1) {
    for (let col = 0; col < qr.size; col += 1) {
      if (qr.modules[row * qr.size + col]) path += `M${col + quietZone} ${row + quietZone}h1v1h-1z`;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" width="100%" height="100%" shape-rendering="crispEdges">` +
    `<rect width="${dimension}" height="${dimension}" fill="#ffffff"/>` +
    `<path d="${path}" fill="${options.color ?? '#1c1c21'}"/>` +
    `</svg>`
  );
}
