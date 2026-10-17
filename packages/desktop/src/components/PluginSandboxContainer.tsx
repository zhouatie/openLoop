import React, { useEffect, useRef, useState } from 'react';
import { PluginManifest } from '@openloop/core';
import { toast } from './Toast';
import { RefreshCw, ExternalLink, AlertTriangle } from 'lucide-react';

interface PluginSandboxContainerProps {
  plugin: PluginManifest;
  currentWorkspace?: string;
}

export const PluginSandboxContainer: React.FC<PluginSandboxContainerProps> = ({
  plugin,
  currentWorkspace,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isHandshakeDone, setIsHandshakeDone] = useState<boolean>(false);

  const entryUrl = plugin.entry || '';

  // 监听来自沙箱插件的消息
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // 仅处理来自当前 iframe 的消息
      if (
        iframeRef.current &&
        event.source !== iframeRef.current.contentWindow
      ) {
        return;
      }

      const data = event.data;
      if (!data || typeof data !== 'object') return;

      // 1. 处理握手请求
      if (data.type === 'HANDSHAKE_INIT') {
        if (import.meta.env.DEV) {
          console.log('[HostBridge:Handshake] 收到插件握手请求:', {
            pluginId: data.pluginId,
            version: data.version,
          });
        }

        const ackPayload = {
          protocol: 'openloop-plugin-protocol',
          type: 'HANDSHAKE_ACK',
          success: true,
          host: {
            version: '0.1.0',
            theme: 'light',
            currentWorkspace: currentWorkspace || '',
            activeTask: null,
          },
        };

        iframeRef.current?.contentWindow?.postMessage(ackPayload, '*');
        setIsHandshakeDone(true);
        setIsLoading(false);
        return;
      }

      // 2. 处理 RPC 请求
      if (data.type === 'RPC_REQUEST') {
        const { id, method, params } = data;
        const startTime = Date.now();

        if (import.meta.env.DEV) {
          console.log(`[HostBridge:RPC] 收到请求 [${method}] ID=${id}:`, params);
        }

        let result: any = null;
        let error: any = null;

        try {
          switch (method) {
            case 'workspace.getCurrent':
              result = {
                path: currentWorkspace || '',
                name: currentWorkspace ? currentWorkspace.split('/').pop() : '',
              };
              break;

            case 'workspace.selectDirectory':
              if ((window as any).electronAPI?.openDirectoryDialog) {
                const selected = await (window as any).electronAPI.openDirectoryDialog({
                  defaultPath: currentWorkspace,
                });
                result = { path: selected };
              } else {
                result = { path: currentWorkspace || null };
              }
              break;

            case 'ui.toast':
              if (params?.type === 'success') {
                toast.success(params.message || '操作成功');
              } else if (params?.type === 'error') {
                toast.error(params.message || '操作失败');
              } else {
                toast.info(params.message || '提示');
              }
              result = { success: true };
              break;

            case 'ui.getTheme':
              result = {
                theme: 'light',
                surface: 'macOS',
                accentColor: '#4f46e5',
              };
              break;

            case 'task.getActive':
              result = { task: null };
              break;

            case 'cli.execute': {
              const cmd = params?.command;
              if (!cmd) throw new Error('command 参数必填');
              // 调用系统执行或通过 Core 执行
              const response = await fetch('http://127.0.0.1:19888/api/system/execute-cli', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: cmd, cwd: currentWorkspace }),
              }).catch(() => null);
              result = response ? await response.json().catch(() => ({ success: true })) : { success: true };
              break;
            }

            case 'qa.getSuites': {
              const res = await fetch('http://127.0.0.1:19888/api/qa/suites');
              result = await res.json();
              break;
            }

            case 'qa.saveSuite': {
              const res = await fetch('http://127.0.0.1:19888/api/qa/suites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params?.suite || params),
              });
              result = await res.json();
              break;
            }

            case 'qa.deleteSuite': {
              const suiteId = params?.id;
              const res = await fetch(`http://127.0.0.1:19888/api/qa/suites/${encodeURIComponent(suiteId)}`, {
                method: 'DELETE',
              });
              result = await res.json();
              break;
            }

            case 'qa.runSuite': {
              const res = await fetch('http://127.0.0.1:19888/api/qa/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
              });
              result = await res.json();
              break;
            }

            case 'qa.getRuns': {
              const suiteId = params?.suiteId ? `?suiteId=${encodeURIComponent(params.suiteId)}` : '';
              const res = await fetch(`http://127.0.0.1:19888/api/qa/runs${suiteId}`);
              result = await res.json();
              break;
            }

            case 'qa.getRunById': {
              const res = await fetch(`http://127.0.0.1:19888/api/qa/runs/${encodeURIComponent(params?.id)}`);
              result = await res.json();
              break;
            }

            default:
              throw new Error(`未受支持的宿主方法: ${method}`);
          }
        } catch (err: any) {
          error = {
            code: 'ERR_METHOD_EXECUTION',
            message: err.message || 'RPC 执行异常',
          };
          if (import.meta.env.DEV) {
            console.error(`[HostBridge:RPC:Error] [${method}]:`, err);
          }
        }

        const elapsed = Date.now() - startTime;
        if (import.meta.env.DEV) {
          console.log(`[HostBridge:RPC:Response] [${method}] 耗时 ${elapsed}ms`);
        }

        iframeRef.current?.contentWindow?.postMessage(
          {
            type: 'RPC_RESPONSE',
            id,
            success: !error,
            result,
            error,
          },
          '*'
        );
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [currentWorkspace]);

  // 当基座工作区变更时，广播给插件
  useEffect(() => {
    if (isHandshakeDone && iframeRef.current?.contentWindow) {
      if (import.meta.env.DEV) {
        console.log('[HostBridge:Event] 广播工作区变更事件: workspace:changed', {
          currentWorkspace,
        });
      }
      iframeRef.current.contentWindow.postMessage(
        {
          type: 'EVENT',
          topic: 'workspace:changed',
          payload: { currentWorkspace },
        },
        '*'
      );
    }
  }, [currentWorkspace, isHandshakeDone]);

  const handleReload = () => {
    setIsLoading(true);
    setLoadError(null);
    setIsHandshakeDone(false);
    if (iframeRef.current) {
      iframeRef.current.src = entryUrl;
    }
  };

  return (
    <div className="w-full h-full relative flex flex-col bg-white overflow-hidden">
      {/* 加载骨架提示 */}
      {isLoading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#fbfbfd]/80 backdrop-blur-xs">
          <div className="w-8 h-8 rounded-full border-2 border-[#4f46e5] border-t-transparent animate-spin mb-3" />
          <p className="text-[12.5px] text-[#52525b]">
            正在加载插件沙箱 [{plugin.name}]...
          </p>
          <p className="text-[11px] text-[#a1a1aa] mt-1 font-mono">{entryUrl}</p>
        </div>
      )}

      {/* 错误提示兜底 */}
      {loadError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center bg-white">
          <div className="w-12 h-12 rounded-[10px] bg-red-50 border border-red-200 text-red-600 flex items-center justify-center mb-3">
            <AlertTriangle size={22} />
          </div>
          <h4 className="text-[14px] font-semibold text-[#18181b] mb-1">
            无法连接至插件服务
          </h4>
          <p className="text-[12px] text-[#71717a] max-w-md mb-4 leading-relaxed">
            未检测到插件本地服务运行中。请确保插件服务已正常启动并监听对应端口。
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReload}
              className="px-3 py-1.5 rounded-[6px] bg-[#18181b] hover:bg-[#27272a] text-white text-[12px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RefreshCw size={12} />
              <span>重新连接</span>
            </button>
            <a
              href={entryUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-[6px] bg-[#f4f4f6] hover:bg-[#eaebee] text-[#52525b] text-[12px] font-medium flex items-center gap-1.5 transition-colors"
            >
              <ExternalLink size={12} />
              <span>在浏览器中打开</span>
            </a>
          </div>
        </div>
      )}

      {/* 沙箱 iframe */}
      <iframe
        ref={iframeRef}
        src={entryUrl}
        className="w-full h-full border-none"
        title={plugin.name}
        onLoad={() => {
          setIsLoading(false);
          if (import.meta.env.DEV) {
            console.log('[HostBridge] 沙箱 iframe 加载完成:', entryUrl);
          }
        }}
        onError={() => {
          setIsLoading(false);
          setLoadError('加载失败');
        }}
      />
    </div>
  );
};
