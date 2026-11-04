import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';

/**
 * 扩展 UI 桥：把 pi 扩展的对话框（选择 / 确认 / 输入 / 编辑器）转成
 * 前端审批卡，再把宿主回传的结果交回扩展。
 *
 * 进程内有两点和 pi 的 RPC 模式不同，必须由这里补上：
 * 1. 没有子进程帮忙兜底，超时与中止只能自己兜，否则扩展的 Promise 永久悬挂；
 * 2. 会话销毁时要一次性取消所有未回应的对话框。
 */

/** 扩展 UI 回应形状：与前端审批卡回传一致 */
export interface ExtensionUiResponse {
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

/** 发给上层的对话框描述：字段与前端审批卡一一对应 */
export interface ExtensionUiRequest {
  id: string;
  method: 'select' | 'confirm' | 'input' | 'editor';
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  timeout?: number;
}

interface DialogPayload {
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
}

interface DialogOptions {
  timeout?: number;
  signal?: AbortSignal;
}

/** 宿主长时间不回应时的兜底时长：按取消处理，绝不让会话卡死 */
const FALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export class ExtensionUiBridge {
  private seq = 0;
  private pending = new Map<string, { settle: (response: ExtensionUiResponse) => void; timer?: NodeJS.Timeout }>();

  constructor(
    private readonly emitRequest: (request: ExtensionUiRequest) => void,
    private readonly emitNotice: (text: string) => void
  ) {}

  public select(title: string, options: string[], opts?: DialogOptions): Promise<string | undefined> {
    return this.dialog('select', { title, options }, opts).then((r) => (r.cancelled ? undefined : r.value));
  }

  public confirm(title: string, message: string, opts?: DialogOptions): Promise<boolean> {
    return this.dialog('confirm', { title, message }, opts).then((r) => (r.cancelled ? false : r.confirmed === true));
  }

  public input(title: string, placeholder?: string, opts?: DialogOptions): Promise<string | undefined> {
    return this.dialog('input', { title, placeholder }, opts).then((r) => (r.cancelled ? undefined : r.value));
  }

  public editor(title: string, prefill?: string, opts?: DialogOptions): Promise<string | undefined> {
    return this.dialog('editor', { title, prefill }, opts).then((r) => (r.cancelled ? undefined : r.value));
  }

  /** 宿主回传对话框结果；找不到说明已超时或已取消，直接忽略 */
  public respond(id: string, response: ExtensionUiResponse) {
    this.pending.get(id)?.settle(response);
  }

  /** 会话销毁：所有未回应的对话框按取消处理 */
  public cancelAll() {
    for (const [, item] of this.pending) item.settle({ cancelled: true });
    this.pending.clear();
  }

  /**
   * 交给 pi 扩展的 UI 上下文
   * 终端专属成员（主题、状态栏、编辑器外观）在无 TUI 环境无意义，按空实现兜住。
   */
  public createContext(): ExtensionUIContext {
    const ui = {
      select: (title: string, options: string[], opts?: DialogOptions) => this.select(title, options, opts),
      confirm: (title: string, message: string, opts?: DialogOptions) => this.confirm(title, message, opts),
      input: (title: string, placeholder?: string, opts?: DialogOptions) => this.input(title, placeholder, opts),
      editor: (title: string, prefill?: string) => this.editor(title, prefill),
      notify: (message: string) => this.emitNotice(message),
      setStatus: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: () => {},
      setFooter: () => {},
      setHeader: () => {},
      setTitle: () => {},
      onTerminalInput: () => () => {},
      custom: async () => undefined,
      pasteToEditor: () => {},
      setEditorText: () => {},
      // 同步接口无法等待宿主回传，与 pi 的 RPC 模式行为一致
      getEditorText: () => '',
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: '进程内会话不支持主题切换' }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
    return ui as unknown as ExtensionUIContext;
  }

  private dialog(method: ExtensionUiRequest['method'], payload: DialogPayload, opts?: DialogOptions) {
    const id = `ui_${++this.seq}_${Date.now()}`;
    return new Promise<ExtensionUiResponse>((resolve) => {
      const settle = (response: ExtensionUiResponse) => {
        const entry = this.pending.get(id);
        if (!entry) return;
        if (entry.timer) clearTimeout(entry.timer);
        opts?.signal?.removeEventListener('abort', onAbort);
        this.pending.delete(id);
        resolve(response);
      };
      const onAbort = () => settle({ cancelled: true });
      const timer = setTimeout(
        () => settle({ cancelled: true }),
        typeof opts?.timeout === 'number' && opts.timeout > 0 ? opts.timeout : FALLBACK_TIMEOUT_MS
      );
      timer.unref?.();
      this.pending.set(id, { settle, timer });

      if (opts?.signal?.aborted) {
        settle({ cancelled: true });
        return;
      }
      opts?.signal?.addEventListener('abort', onAbort, { once: true });
      this.emitRequest({
        id,
        method,
        title: payload.title || '',
        message: payload.message || '',
        options: payload.options,
        placeholder: payload.placeholder,
        timeout: opts?.timeout,
      });
    });
  }
}
