/* 取自 deepseek-harness packages/client/ui-sidebar-terminal/src/client/terminal-theme.ts（MIT）：
   xterm 主题 = 界面主题的底色/前景色 + 应用自己用 OSC 改过的调色板。
   应用改色（OSC 4 / 10-12）与复位（OSC 104 / 110-112）都要留住，否则 vim、htop 这类程序
   设的配色会被界面主题覆盖掉。 */
import type { IDisposable, ITheme, Terminal } from '@xterm/xterm';

const ANSI_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;

const SPECIAL_KEYS = ['foreground', 'background', 'cursor'] as const;

/** 界面主题色与应用自定义色分开存：OSC 复位时只回退到界面主题 */
export class TerminalTheme implements IDisposable {
  private defaults: ITheme = {};
  private readonly indexed = new Map<number, string>();
  private readonly special = new Map<(typeof SPECIAL_KEYS)[number], string>();
  private readonly subscriptions: IDisposable[];

  /**
   * 只旁听 OSC 命令，不改写 xterm 自己的查询与染色逻辑。
   * @param terminal - 已经 open 的终端实例
   */
  constructor(private readonly terminal: Terminal) {
    const observe = (code: number, change: (data: string) => void): IDisposable =>
      terminal.parser.registerOscHandler(code, (data) => {
        change(data);
        return false;
      });
    this.subscriptions = [
      observe(4, (data) => {
        const parts = data.split(';');
        for (let i = 0; i + 1 < parts.length; i += 2) {
          const index = colorIndex(parts[i]!);
          const color = oscColor(parts[i + 1]!);
          if (index !== undefined && color !== undefined) this.indexed.set(index, color);
        }
      }),
      observe(104, (data) => {
        if (data === '') this.indexed.clear();
        else {
          for (const part of data.split(';')) {
            const index = colorIndex(part);
            if (index !== undefined) this.indexed.delete(index);
          }
        }
        this.apply();
      }),
      ...SPECIAL_KEYS.flatMap((key, offset) => [
        observe(10 + offset, (data) => {
          for (const [i, part] of data.split(';').entries()) {
            const target = SPECIAL_KEYS[offset + i];
            const color = oscColor(part);
            if (target !== undefined && color !== undefined) this.special.set(target, color);
          }
        }),
        observe(110 + offset, () => {
          this.special.delete(key);
          this.apply();
        }),
      ]),
    ];
  }

  /**
   * 换主题时只换底色与前景色，程序改过的调色板不动。
   * @param background - 面板实际底色
   * @param foreground - 面板实际前景色
   */
  update(background: string, foreground: string): void {
    if (this.defaults.background === background && this.defaults.foreground === foreground) return;
    this.defaults = {
      background,
      foreground,
      cursor: foreground,
      cursorAccent: background,
      selectionBackground: foreground,
      selectionForeground: background,
      selectionInactiveBackground: foreground,
    };
    this.apply();
  }

  /** 当前光标色：优先应用用 OSC 12 指定的，其次跟随前景色 */
  get cursor(): string {
    return this.special.get('cursor') ?? this.defaults.cursor!;
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
  }

  private apply(): void {
    const theme: ITheme = { ...this.defaults, ...Object.fromEntries(this.special) };
    for (const [index, color] of this.indexed) {
      if (index < ANSI_KEYS.length) theme[ANSI_KEYS[index]!] = color;
      else (theme.extendedAnsi ??= [])[index - ANSI_KEYS.length] = color;
    }
    this.terminal.options.theme = theme;
  }
}

function colorIndex(value: string): number | undefined {
  return /^\d+$/u.test(value) && Number(value) < 256 ? Number(value) : undefined;
}

/** XParseColor 的 rgb: 通道按位宽缩放，CSS 的 #rgb 则按位数扩展，两者不能混算 */
function oscColor(value: string): string | undefined {
  const rgb = /^rgb:([\da-f]{1,4})\/([\da-f]{1,4})\/([\da-f]{1,4})$/iu.exec(value);
  let channels: string[];
  if (rgb !== null) {
    channels = rgb.slice(1);
    if (!channels.every((channel) => channel.length === channels[0]!.length)) return;
  } else {
    if (!/^#(?:[\da-f]{3}){1,4}$/iu.test(value)) return;
    const width = (value.length - 1) / 3;
    channels = [value.slice(1, width + 1), value.slice(width + 1, 2 * width + 1), value.slice(2 * width + 1)];
  }
  return `#${channels
    .map((channel) => {
      const n =
        rgb === null
          ? Number.parseInt(channel.padEnd(2, '0').slice(0, 2), 16)
          : Math.round((Number.parseInt(channel, 16) * 255) / (16 ** channel.length - 1));
      return n.toString(16).padStart(2, '0');
    })
    .join('')}`;
}
