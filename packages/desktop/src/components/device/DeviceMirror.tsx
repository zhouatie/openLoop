import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Smartphone,
  Apple,
  RotateCcw,
  Keyboard,
  X,
  ArrowLeft,
  Home,
  Loader2,
  Lock,
  Minimize2,
  AlertTriangle,
  ChevronDown,
  Check,
  Play,
} from 'lucide-react';
import { api } from '../../services/api';
import { WebCodecsVideoDecoder, WebGLVideoFrameRenderer, BitmapVideoFrameRenderer } from '@yume-chan/scrcpy-decoder-webcodecs';
import { ScrcpyVideoCodecId } from '@yume-chan/scrcpy';
import { DeviceLeaseSnapshot } from '@openloop/core';

/** 紧贴屏幕的竖向操作按键列宽度（px） */
const ACTION_RAIL_WIDTH = 32;

/** 可切换的设备条目（浮层标题栏下拉使用） */
export interface SwitchableDevice {
  key: string;
  platform: 'android' | 'ios';
  serial: string;
  name: string;
  /** 右侧弱化提示，例如「模拟器」 */
  hint?: string;
}

export interface DeviceSwitcherConfig {
  devices: SwitchableDevice[];
  activeKey: string;
  onSelect: (device: SwitchableDevice) => void;
  /** 自动化任务锁定设备时禁止切换 */
  locked?: boolean;
}

interface DeviceMirrorProps {
  platform: 'android' | 'ios';
  serial: string;
  wdaEndpoint?: string;
  /** 设备自定义显示名称 */
  name?: string;
  /** 外部传入的设备租约列表（用于感知执行态） */
  leases?: DeviceLeaseSnapshot[];
  /** 紧凑模式（用于侧边栏嵌入）还是全量模式（用于主页面） */
  variant?: 'dock' | 'standalone';
  onClose?: () => void;
  /** 标题栏设备切换器（设备数大于 1 时出现） */
  deviceSwitcher?: DeviceSwitcherConfig;
  /** QA 执行上下文：镜像聚焦到正在执行的用例与步骤 */
  run?: {
    runId: string;
    suiteName?: string;
    stepIndex?: number;
    totalSteps?: number;
    stepTitle?: string;
    active: boolean;
  } | null;
}

interface DeviceSize {
  width: number;
  height: number;
}

export const DeviceMirror: React.FC<DeviceMirrorProps> = ({
  platform,
  serial,
  wdaEndpoint,
  name,
  leases = [],
  variant = 'dock',
  onClose,
  deviceSwitcher,
  run,
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasStageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<'connecting' | 'streaming' | 'error' | 'disconnected'>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deviceSize, setDeviceSize] = useState<DeviceSize>({ width: 1080, height: 2400 });
  const [inputText, setInputText] = useState('');
  const [inputOpen, setInputOpen] = useState(false);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const autoRetryRef = useRef(0);
  /** iOS 分支是否已收到过画面（用于看门狗与错误判定） */
  const iosHasPictureRef = useRef(false);
  /** 是否正在后台构建启动 WebDriverAgent */
  const [wdaLaunching, setWdaLaunching] = useState(false);
  /** WDA 启动过程提示 */
  const [wdaHint, setWdaHint] = useState<string | null>(null);
  /** iOS：WebDriverAgent 是否可用（false 表示当前走截图轮播，画面较慢且不能反向控制） */
  const [wdaReachable, setWdaReachable] = useState<boolean | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const canSwitch = Boolean(deviceSwitcher && deviceSwitcher.devices.length > 1 && !deviceSwitcher.locked);
  const [touchIndicator, setTouchIndicator] = useState<{ left: number; top: number; id: number } | null>(null);
  const [codec, setCodec] = useState<string>('h264');
  const [stageBox, setStageBox] = useState<{ width: number; height: number } | null>(null);

  // 检查设备当前是否正处于自动化任务运行中（运行态互斥保护）
  const leaseHolder = useMemo(() => {
    const targetKey = serial.trim();
    const lease = leases.find((l) => l.key === targetKey);
    return lease?.holder;
  }, [leases, serial]);

  const isBusy = Boolean(leaseHolder);

  // 监听画面舞台尺寸，换算外框等比尺寸（外框 = 画面 + 标题栏）
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const measure = () => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      setStageBox((prev) =>
        prev && prev.width === next.width && prev.height === next.height ? prev : next
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const frameSize = useMemo(() => {
    if (!stageBox || stageBox.width <= 0 || stageBox.height <= 0) return null;
    // 32px 为紧贴屏幕的按键列；36px 为卡片顶部标题栏
    const usableWidth = Math.max(80, stageBox.width - 32);
    const usableHeight = Math.max(80, stageBox.height - 36);
    const scale = Math.min(usableWidth / deviceSize.width, usableHeight / deviceSize.height);
    return {
      width: Math.max(120, Math.round(deviceSize.width * scale)),
      height: Math.round(deviceSize.height * scale) + 36,
    };
  }, [stageBox, deviceSize]);

  // 文本浮层锚定在按键列左侧：向右展开会顶出应用可视区，所以一律朝画面外侧（左）打开
  const floatPanel = useMemo(() => {
    if (!stageBox || !frameSize) return null;
    const groupWidth = frameSize.width + ACTION_RAIL_WIDTH;
    const groupLeft = Math.max(0, Math.round((stageBox.width - groupWidth) / 2));
    const width = Math.min(260, Math.max(200, groupLeft - 16));
    return { left: groupLeft - 8 - width, width };
  }, [stageBox, frameSize]);

  // 卡片较窄时收起次要信息，保持标题栏呼吸感
  const isCompact = Boolean(frameSize && frameSize.width < 300);

  const pointerStartRef = useRef<{
    ratioX: number;
    ratioY: number;
    clientX: number;
    clientY: number;
    time: number;
  } | null>(null);

  // 精准计算视口内接画面的实际几何矩形（排除 letterbox 黑边）
  const getInscribedRect = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const aspect = deviceSize.width / deviceSize.height;
    if (rect.width / rect.height > aspect) {
      const renderedWidth = rect.height * aspect;
      return {
        left: rect.left + (rect.width - renderedWidth) / 2,
        top: rect.top,
        width: renderedWidth,
        height: rect.height,
      };
    }
    const renderedHeight = rect.width / aspect;
    return {
      left: rect.left,
      top: rect.top + (rect.height - renderedHeight) / 2,
      width: rect.width,
      height: renderedHeight,
    };
  }, [deviceSize]);

  // 精准计算事件在手机画面内容区域上的归一化百分比 (0.0 ~ 1.0)
  const getEventRatio = useCallback((e: React.PointerEvent) => {
    const rect = getInscribedRect();
    if (!rect) return null;

    if (
      e.clientX < rect.left ||
      e.clientX > rect.left + rect.width ||
      e.clientY < rect.top ||
      e.clientY > rect.top + rect.height
    ) {
      return null;
    }

    const ratioX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ratioY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    return { ratioX, ratioY, rect };
  }, [getInscribedRect]);

  // 触发反向控制
  const handleAction = useCallback(
    async (action: any) => {
      if (isBusy) {
        if (import.meta.env?.DEV) console.log('[DeviceMirror] 设备处于自动化运行中，操作被阻止');
        return;
      }
      try {
        if (import.meta.env?.DEV) console.log('[DeviceMirror] 发起反向控制动作:', action);
        await api.executeDeviceAction({
          platform,
          serial,
          action,
          wdaEndpoint,
        });
      } catch (err: any) {
        if (import.meta.env?.DEV) console.warn('[DeviceMirror] 控制动作执行异常:', err);
      }
    },
    [isBusy, platform, serial, wdaEndpoint]
  );

  // 指针按下
  const handlePointerDown = (e: React.PointerEvent) => {
    if (isBusy) return;
    const info = getEventRatio(e);
    if (!info) return;

    pointerStartRef.current = {
      ratioX: info.ratioX,
      ratioY: info.ratioY,
      clientX: e.clientX,
      clientY: e.clientY,
      time: Date.now(),
    };
  };

  // 指针释放 (精准判定 Tap 点击 与 Swipe 滑动)
  const handlePointerUp = (e: React.PointerEvent) => {
    if (isBusy || !pointerStartRef.current) return;
    const start = pointerStartRef.current;
    pointerStartRef.current = null;

    const info = getEventRatio(e);
    if (!info) return;

    const dx = e.clientX - start.clientX;
    const dy = e.clientY - start.clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const duration = Date.now() - start.time;

    if (dist < 12 && duration < 400) {
      // 判定为 Tap 点击
      const id = Date.now();
      const viewport = viewportRef.current;
      if (viewport) {
        const vRect = viewport.getBoundingClientRect();
        setTouchIndicator({ left: e.clientX - vRect.left, top: e.clientY - vRect.top, id });
        setTimeout(() => {
          setTouchIndicator((curr) => (curr?.id === id ? null : curr));
        }, 250);
      }

      handleAction({
        type: 'tap',
        ratioX: info.ratioX,
        ratioY: info.ratioY,
      });
    } else {
      // 判定为 Swipe 滑动
      handleAction({
        type: 'swipe',
        ratioX: start.ratioX,
        ratioY: start.ratioY,
        ratioEndX: info.ratioX,
        ratioEndY: info.ratioY,
        duration: Math.max(120, Math.min(1000, duration)),
      });
    }
  };

  // ================= Android WebCodecs 视频流管道 =================
  useEffect(() => {
    if (platform !== 'android') return;

    setStatus('connecting');
    setErrorMessage(null);

    const wsUrl = api.getAndroidStreamWsUrl(serial);
    if (import.meta.env?.DEV) console.log('[DeviceMirror:Android] 正在连接实时流:', wsUrl);

    let ws: WebSocket | null = null;
    let decoder: any = null;
    let decoderWriter: any = null;
    let isDisposed = false;
    let hasPicture = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // 无画面看门狗：连上却不来画面（会话僵尸/设备休眠）不能一直黑屏
    const watchdog = setTimeout(() => {
      if (isDisposed || hasPicture) return;
      setStatus((prev) => (prev === 'streaming' ? prev : 'error'));
      setErrorMessage((prev) => prev || '长时间未收到画面数据，请重新连接');
    }, 12000);

    try {
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err.message || '无法建立 WebSocket 串流');
      return;
    }

    // Transform stream 用于 WebCodecs 帧解析与 configuration 帧保底
    let configPacketEnqueued = false;
    let pendingPackets: Array<{ type: string; data: Uint8Array; keyframe?: boolean }> = [];
    let uninitializedPackets: Array<{ type: string; data: Uint8Array; keyframe?: boolean }> = [];

    const pushPacketToDecoder = (packet: { type: string; data: Uint8Array; keyframe?: boolean }) => {
      if (isDisposed) return;
      if (!decoderWriter) {
        // 解码器尚未就绪，先暂存以防关键配置帧丢失
        uninitializedPackets.push(packet);
        if (uninitializedPackets.length > 100) uninitializedPackets.shift();
        return;
      }

      try {
        if (packet.type === 'configuration') {
          configPacketEnqueued = true;
          decoderWriter.write(packet).catch((err: any) => {
            if (import.meta.env?.DEV) console.warn('[DeviceMirror:Android] 写入配置帧异常:', err);
          });
          // 补发在此之前收到的数据包
          if (pendingPackets.length > 0) {
            for (const p of pendingPackets) {
              decoderWriter.write(p).catch(() => {});
            }
            pendingPackets = [];
          }
        } else {
          if (!configPacketEnqueued) {
            pendingPackets.push(packet);
            if (pendingPackets.length > 60) pendingPackets.shift();
            return;
          }
          decoderWriter.write(packet).catch((err: any) => {
            if (import.meta.env?.DEV) console.warn('[DeviceMirror:Android] 写入视频数据帧异常:', err);
          });
        }
      } catch (err: any) {
        if (import.meta.env?.DEV) console.warn('[DeviceMirror:Android] 帧处理失败:', err);
      }
    };

    const initDecoder = (meta: { codec: string | number; width: number; height: number }) => {
      if (isDisposed) return;
      try {
        setDeviceSize({ width: meta.width, height: meta.height });

        // 每次创建崭新的渲染器与 Canvas，避免 WebGL 上下文污染与 React 虚拟 DOM 冲突
        const renderer = WebGLVideoFrameRenderer.isSupported
          ? new WebGLVideoFrameRenderer()
          : new BitmapVideoFrameRenderer();

        const canvas = renderer.canvas as HTMLCanvasElement;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.objectFit = 'contain';

        if (canvasStageRef.current) {
          canvasStageRef.current.replaceChildren(canvas);
        }

        const isH265 = String(meta.codec).toLowerCase().includes('h265');
        setCodec(isH265 ? 'h265' : 'h264');
        const codecId = isH265 ? ScrcpyVideoCodecId.H265 : ScrcpyVideoCodecId.H264;

        decoder = new WebCodecsVideoDecoder({
          codec: codecId,
          renderer,
        });

        // 统一获取单例 writer，避免频繁 getWriter / releaseLock 引发 stream locked 冲突
        decoderWriter = decoder.writable.getWriter();

        hasPicture = true;
        autoRetryRef.current = 0;
        setStatus('streaming');
        if (import.meta.env?.DEV) console.log('[DeviceMirror:Android] WebCodecs 解码器初始化成功:', meta);

        // 如果在 decoder 初始化前已有数据包到达，立即冲刷处理
        if (uninitializedPackets.length > 0) {
          const queue = uninitializedPackets;
          uninitializedPackets = [];
          for (const pkt of queue) {
            pushPacketToDecoder(pkt);
          }
        }
      } catch (err: any) {
        setStatus('error');
        setErrorMessage(`WebCodecs 解码器初始化失败: ${err.message}`);
      }
    };

    ws.onmessage = async (event) => {
      if (isDisposed) return;

      if (typeof event.data === 'string') {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'metadata') {
            initDecoder(parsed);
          } else if (parsed.type === 'error') {
            setStatus('error');
            setErrorMessage(parsed.message || '串流会话异常');
          } else if (parsed.type === 'end') {
            if (import.meta.env?.DEV) console.log('[DeviceMirror:Android] 服务端视频流已结束:', parsed.message);
            setStatus('disconnected');
            setErrorMessage(parsed.message || '设备视频流已中断');
          }
        } catch {}
        return;
      }

      // 二进制数据包 (兼容 ArrayBuffer 与 Blob)
      let rawBuf: Uint8Array | null = null;
      if (event.data instanceof ArrayBuffer) {
        rawBuf = new Uint8Array(event.data);
      } else if (event.data instanceof Blob) {
        try {
          const ab = await event.data.arrayBuffer();
          rawBuf = new Uint8Array(ab);
        } catch {}
      }

      if (!rawBuf || rawBuf.length < 2) return;
      const flag = rawBuf[0];
      const isConfig = (flag & 0x01) !== 0;
      const isKeyFrame = (flag & 0x02) !== 0;
      const payload = rawBuf.subarray(1);

      pushPacketToDecoder({
        type: isConfig ? 'configuration' : 'data',
        data: payload,
        keyframe: isKeyFrame,
      });
    };

    ws.onerror = (e) => {
      if (isDisposed) return;
      if (import.meta.env?.DEV) console.warn('[DeviceMirror:Android] WebSocket 错误:', e);
      setStatus('error');
      setErrorMessage('视频流通信异常，请确认 ADB 正常运行');
    };

    ws.onclose = (event) => {
      if (isDisposed) return;
      if (import.meta.env?.DEV) console.log('[DeviceMirror:Android] WebSocket 关闭:', event.code, event.reason);
      setStatus((prev) => (prev === 'error' ? 'error' : 'disconnected'));
      if (event.reason) {
        setErrorMessage(event.reason);
      }
      // 已经出过画面的连接被服务端收掉（如流中断），静默重连一次
      if (hasPicture && autoRetryRef.current < 1) {
        autoRetryRef.current += 1;
        retryTimer = setTimeout(() => {
          if (!isDisposed) setReconnectNonce((n) => n + 1);
        }, 1200);
      }
    };

    return () => {
      isDisposed = true;
      clearTimeout(watchdog);
      if (retryTimer) clearTimeout(retryTimer);
      if (ws) {
        ws.close();
      }
      if (decoderWriter) {
        try {
          decoderWriter.releaseLock();
        } catch {}
      }
      if (decoder) {
        try {
          decoder.dispose();
        } catch {}
      }
      if (canvasStageRef.current) {
        canvasStageRef.current.replaceChildren();
      }
    };
  }, [platform, serial, reconnectNonce]);

  // ================= iOS 画面管道（WDA 串流 / simctl 截图轮播） =================
  useEffect(() => {
    if (platform !== 'ios') return;
    setStatus('connecting');
    setErrorMessage(null);
    iosHasPictureRef.current = false;

    // 首帧看门狗：后端会依次尝试 WDA MJPEG、WDA 截图、本机模拟器截图
    const watchdog = window.setTimeout(() => {
      if (iosHasPictureRef.current) return;
      setStatus('error');
      setErrorMessage('长时间未收到 iOS 画面。请确认模拟器已启动，或用 Xcode 运行 WebDriverAgentRunner。');
    }, 12000);

    return () => window.clearTimeout(watchdog);
  }, [platform, serial, wdaEndpoint, reconnectNonce]);

  /** 启动 WebDriverAgentRunner；就绪后自动重连切换到 MJPEG 流畅串流 */
  const handleLaunchWda = useCallback(async () => {
    if (!serial || wdaLaunching) return;
    setWdaLaunching(true);
    setWdaHint('正在构建并启动 WebDriverAgent...');
    try {
      const res = await api.launchWebDriverAgent(serial);
      if (import.meta.env?.DEV) {
        console.log('[DeviceMirror:iOS] 启动 WebDriverAgent:', res);
      }
      setWdaHint(res.message);
      if (!res.success) {
        setWdaLaunching(false);
        return;
      }
      // 轮询 WDA 就绪，最多等 6 分钟
      const deadline = Date.now() + 6 * 60 * 1000;
      const timer = window.setInterval(async () => {
        if (Date.now() > deadline) {
          window.clearInterval(timer);
          setWdaLaunching(false);
          setWdaHint('WebDriverAgent 启动超时，请检查 Xcode 构建日志（~/.openloop/logs）');
          return;
        }
        try {
          const snapshot = await api.getIosDevices(wdaEndpoint);
          if (!snapshot?.wda?.reachable) return;
          window.clearInterval(timer);
          setWdaLaunching(false);
          setWdaHint('WebDriverAgent 已就绪，已切换到流畅串流');
          setStatus('connecting');
          setErrorMessage(null);
          setReconnectNonce((n) => n + 1);
        } catch {
          /* 探测失败继续等待 */
        }
      }, 5000);
    } catch (err: any) {
      setWdaLaunching(false);
      setWdaHint(err?.message || '启动 WebDriverAgent 失败');
    }
  }, [serial, wdaEndpoint, wdaLaunching]);

  // iOS：每 20 秒探测 WebDriverAgent 是否可用，用于在标题栏提供启动入口
  useEffect(() => {
    if (platform !== 'ios') {
      setWdaReachable(null);
      return;
    }
    let active = true;
    const probe = async () => {
      try {
        const snapshot = await api.getIosDevices(wdaEndpoint);
        if (active) setWdaReachable(Boolean(snapshot?.wda?.reachable));
      } catch {
        if (active) setWdaReachable(null);
      }
    };
    void probe();
    const timer = window.setInterval(() => void probe(), 20000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [platform, wdaEndpoint, wdaLaunching, reconnectNonce]);

  // 设备切换下拉：点击浮层外部关闭
  useEffect(() => {
    if (!switcherOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (switcherRef.current?.contains(event.target as Node)) return;
      setSwitcherOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [switcherOpen]);

  const iosPreviewUrl = useMemo(() => {
    if (platform !== 'ios') return '';
    return api.getIosStreamPreviewUrl({ wdaEndpoint, udid: serial });
  }, [platform, wdaEndpoint, serial, reconnectNonce]);

  return (
    <div className="relative flex w-full h-full min-h-0 items-stretch gap-3">
      {/* 画面舞台：手机外框 + 紧贴屏幕的操作按键列 */}
      <div ref={stageRef} className="flex-1 min-w-0 min-h-0 flex items-center justify-center">
        {/* 紧贴屏幕的操作按键列（位于画面左侧） */}
        <div className="flex flex-col shrink-0 self-center divide-y divide-[#f1f1f4] bg-white border border-r-0 border-[#e3e3e8] rounded-l-[9px] overflow-hidden shadow-xs">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => handleAction({ type: 'key', key: 'back' })}
            title="返回键 (Back)"
            className="w-8 h-9 text-[#63636b] hover:text-[#1c1c21] hover:bg-[#fafafc] flex items-center justify-center disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <ArrowLeft size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => handleAction({ type: 'key', key: 'home' })}
            title="主屏幕 (Home)"
            className="w-8 h-9 text-[#63636b] hover:text-[#1c1c21] hover:bg-[#fafafc] flex items-center justify-center disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <Home size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => setInputOpen((v) => !v)}
            title="发送文本输入（⌘ + Enter 发送）"
            className={`w-8 h-9 flex items-center justify-center transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
              inputOpen
                ? 'bg-[#eeedfd] text-[#4f46e5]'
                : 'text-[#63636b] hover:text-[#1c1c21] hover:bg-[#fafafc]'
            }`}
          >
            <Keyboard size={14} strokeWidth={1.8} />
          </button>
        </div>

        <div
          style={frameSize ? { width: `${frameSize.width}px`, height: `${frameSize.height}px` } : undefined}
          className={`flex flex-col overflow-hidden rounded-[10px] bg-[#18181b] text-white select-none border border-[#27272a] shadow-[0_8px_28px_rgba(0,0,0,0.12)] ${
            frameSize ? 'shrink-0' : 'h-full w-full'
          }`}
        >
          {/* 顶部标题栏与状态指示 */}
          <div className="relative z-10 h-[36px] bg-[#27272a]/90 backdrop-blur px-3 flex items-center justify-between border-b border-[#3f3f46]/60 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {platform === 'ios' ? (
                <Apple size={14} className="text-[#a1a1aa] shrink-0" />
              ) : (
                <Smartphone size={14} className="text-[#10b981] shrink-0" />
              )}
              <div ref={switcherRef} className="relative min-w-0">
                {canSwitch ? (
                  <button
                    type="button"
                    title="切换设备"
                    onClick={() => setSwitcherOpen((prev) => !prev)}
                    className="group flex items-center gap-1 min-w-0 rounded-[4px] px-1 -mx-1 h-[22px] hover:bg-[#3f3f46]/70 transition-colors cursor-pointer"
                  >
                    <span className="text-[12px] font-medium text-[#f4f4f5] truncate">{name || serial}</span>
                    <ChevronDown
                      size={11}
                      className={`shrink-0 text-[#71717a] group-hover:text-[#d4d4d8] transition-transform ${
                        switcherOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                ) : (
                  <span className="text-[12px] font-medium text-[#f4f4f5] truncate">{name || serial}</span>
                )}

                {switcherOpen && deviceSwitcher && (
                  <div className="absolute left-0 top-[26px] z-20 w-[196px] rounded-[8px] border border-[#3f3f46] bg-[#27272a] py-1 shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
                    <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-[#71717a]">切换设备</div>
                    <div className="max-h-[300px] overflow-y-auto">
                    {deviceSwitcher.devices.map((device) => {
                      const isActive = device.key === deviceSwitcher.activeKey;
                      return (
                        <button
                          key={device.key}
                          type="button"
                          onClick={() => {
                            setSwitcherOpen(false);
                            if (!isActive) deviceSwitcher.onSelect(device);
                          }}
                          className={`w-full flex items-center gap-2 px-2 h-[28px] text-left transition-colors cursor-pointer ${
                            isActive ? 'bg-[#3f3f46]/60' : 'hover:bg-[#3f3f46]/70'
                          }`}
                        >
                          {device.platform === 'ios' ? (
                            <Apple size={11} className="shrink-0 text-[#a1a1aa]" />
                          ) : (
                            <Smartphone size={11} className="shrink-0 text-[#10b981]" />
                          )}
                          <span className="flex-1 min-w-0 truncate text-[11px] text-[#e4e4e7]">{device.name}</span>
                          {device.hint && (
                            <span className="shrink-0 font-mono text-[10px] text-[#71717a]">{device.hint}</span>
                          )}
                          {isActive && <Check size={11} className="shrink-0 text-[#a5b4fc]" />}
                        </button>
                      );
                    })}
                    </div>
                  </div>
                )}
              </div>
              {platform === 'ios' && wdaReachable === false && (
                <button
                  type="button"
                  disabled={wdaLaunching}
                  onClick={() => void handleLaunchWda()}
                  title="WebDriverAgent 未运行：当前是截图轮播（约 1.5 fps）。启动后画面流畅，并可反向点击输入。"
                  className="shrink-0 inline-flex items-center gap-1 px-1.5 h-[18px] rounded-[4px] bg-[#4f46e5]/18 text-[#c7d2fe] text-[10px] font-medium border border-[#4f46e5]/30 hover:bg-[#4f46e5]/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {wdaLaunching ? <Loader2 size={9} className="animate-spin" /> : <Play size={9} />}
                  <span className="whitespace-nowrap">
                    {wdaLaunching ? '启动中' : isCompact ? 'WDA' : '启动 WDA'}
                  </span>
                </button>
              )}
              {!isCompact && platform !== 'ios' && (
                <span className="font-mono text-[10px] text-[#71717a] truncate max-w-[90px]">
                  {serial}
                </span>
              )}
              {run?.suiteName && !isCompact && (
                <span className="text-[10px] text-[#a1a1aa] truncate max-w-[120px]" title={run.suiteName}>
                  {run.suiteName}
                </span>
              )}
              {run && (
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[10px] font-medium whitespace-nowrap border ${
                    run.active
                      ? 'bg-[#4f46e5]/18 text-[#c7d2fe] border-[#4f46e5]/30'
                      : 'bg-white/6 text-[#a1a1aa] border-white/10'
                  }`}
                  title={[run.suiteName, run.stepTitle].filter(Boolean).join(' · ') || 'QA 执行'}
                >
                  <span className={`w-1 h-1 rounded-full ${run.active ? 'bg-[#a5b4fc] animate-pulse' : 'bg-[#71717a]'}`} />
                  {typeof run.stepIndex === 'number'
                    ? `${run.stepIndex + 1}/${run.totalSteps ?? '?'}`
                    : run.active
                    ? '执行中'
                    : '已结束'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {isBusy ? (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#3b82f6]/15 text-[#93c5fd] text-[10px] font-medium border border-[#3b82f6]/25"
                  title={`正在执行任务: ${leaseHolder?.label}`}
                >
                  <Lock size={9} className="text-[#93c5fd]" />
                  {!isCompact && <span className="whitespace-nowrap">仅观看</span>}
                </span>
              ) : status === 'streaming' ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#10b981]/12 text-[#34d399] text-[10px] font-medium border border-[#10b981]/20">
                  <span className="w-1 h-1 rounded-full bg-[#34d399] animate-pulse" />
                  {!isCompact && <span className="whitespace-nowrap">实时</span>}
                </span>
              ) : status === 'connecting' ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#eab308]/12 text-[#facc15] text-[10px] font-medium border border-[#eab308]/20">
                  <Loader2 size={9} className="animate-spin text-[#facc15]" />
                  {!isCompact && <span className="whitespace-nowrap">连接中</span>}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#ef4444]/12 text-[#f87171] text-[10px] font-medium border border-[#ef4444]/20">
                  <AlertTriangle size={9} className="text-[#f87171]" />
                  {!isCompact && <span className="whitespace-nowrap">离线</span>}
                </span>
              )}

              <button
                type="button"
                title="重新连接"
                onClick={() => setReconnectNonce((n) => n + 1)}
                className="p-1 rounded text-[#a1a1aa] hover:text-white hover:bg-[#3f3f46] transition-colors cursor-pointer"
              >
                <RotateCcw size={11} />
              </button>

              {onClose && (
                <button
                  type="button"
                  title="关闭窗口"
                  onClick={onClose}
                  className="p-1 rounded text-[#a1a1aa] hover:text-white hover:bg-[#3f3f46] transition-colors cursor-pointer"
                >
                  <Minimize2 size={11} />
                </button>
              )}
            </div>
          </div>

          {/* 画面视口区域 */}
          <div
            ref={viewportRef}
            className="relative flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden touch-none select-none cursor-crosshair"
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
          >
            {platform === 'android' ? (
              <div
                ref={canvasStageRef}
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
              />
            ) : (
              <img
                ref={imgRef}
                key={`${iosPreviewUrl}#${reconnectNonce}`}
                src={iosPreviewUrl}
                alt="iOS Device Stream"
                className="w-full h-full object-contain pointer-events-none"
                onLoad={() => {
                  iosHasPictureRef.current = true;
                  setStatus('streaming');
                  if (imgRef.current?.naturalWidth && imgRef.current?.naturalHeight) {
                    setDeviceSize({
                      width: imgRef.current.naturalWidth,
                      height: imgRef.current.naturalHeight,
                    });
                  }
                }}
                onError={() => {
                  if (iosHasPictureRef.current) return;
                  setStatus('error');
                  setErrorMessage('无法获取 iOS 画面：WebDriverAgent 未启动，且没有可截图的已启动模拟器。');
                }}
              />
            )}

            {/* 触控涟漪视觉反馈 */}
            {touchIndicator && (
              <div
                key={touchIndicator.id}
                className="absolute pointer-events-none rounded-full border border-white/90 bg-white/40 -translate-x-1/2 -translate-y-1/2 animate-ping"
                style={{
                  left: `${touchIndicator.left}px`,
                  top: `${touchIndicator.top}px`,
                  width: 24,
                  height: 24,
                }}
              />
            )}

            {/* 状态异常或断开遮罩 */}
            {(status === 'error' || status === 'disconnected') && (
              <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center p-4 text-center z-10 select-none">
                <AlertTriangle size={22} className="text-[#f87171] mb-2" />
                <p className="text-[12px] text-[#f4f4f5] font-medium">
                  {status === 'error' ? '未能连接到设备实时画面' : '设备画面已断开'}
                </p>
                <p className="text-[11px] text-[#a1a1aa] mt-1 max-w-[240px] leading-relaxed">
                  {errorMessage || '请确认设备在线、USB 调试或 WebDriverAgent 连通正常'}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStatus('connecting');
                      setErrorMessage(null);
                      setReconnectNonce((n) => n + 1);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#3f3f46] hover:bg-[#52525b] text-white rounded-[5px] text-[11.5px] font-medium transition-colors cursor-pointer"
                  >
                    <RotateCcw size={11} />
                    <span>重新连接</span>
                  </button>
                  {platform === 'ios' && (
                    <button
                      type="button"
                      disabled={wdaLaunching}
                      onClick={() => void handleLaunchWda()}
                      title="在后台构建并启动 WebDriverAgentRunner，获得流畅串流与反向控制"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#4f46e5] hover:bg-[#4338ca] text-white rounded-[5px] text-[11.5px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {wdaLaunching ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                      <span>{wdaLaunching ? '正在启动' : '启动 WDA'}</span>
                    </button>
                  )}
                </div>
                {platform === 'ios' && wdaHint && (
                  <p className="text-[10.5px] text-[#a1a1aa] mt-2 max-w-[240px] leading-relaxed">{wdaHint}</p>
                )}
              </div>
            )}

            {status === 'connecting' && (
              <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-10">
                <Loader2 size={22} className="animate-spin text-[#60a5fa] mb-2" />
                <span className="text-[11.5px] text-[#d4d4d8]">正在连接设备画面...</span>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* 文本输入浮层 */}
      {inputOpen && (
        <div
          style={floatPanel ? { left: `${floatPanel.left}px`, width: `${floatPanel.width}px` } : undefined}
          className="absolute top-1/2 -translate-y-1/2 z-30 flex flex-col bg-white border border-[#e3e3e8] rounded-[10px] shadow-[0_12px_32px_rgba(0,0,0,0.14)] overflow-hidden"
        >
          <div className="h-[32px] px-2.5 flex items-center justify-between border-b border-[#f1f1f4] shrink-0">
            <div className="flex items-center gap-1.5">
              <Keyboard size={12} className="text-[#85858d]" />
              <span className="text-[11px] font-medium text-[#1c1c21]">文本输入</span>
            </div>
            <button
              type="button"
              onClick={() => setInputOpen(false)}
              title="关闭"
              className="w-5 h-5 rounded-[4px] text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4] flex items-center justify-center transition-colors cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>

          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={isBusy}
            autoFocus
            placeholder={isBusy ? '自动化任务执行中，输入已锁定' : '先在手机上点选输入框，再在此输入文本'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (inputText.trim()) {
                  handleAction({ type: 'text', text: inputText });
                  setInputText('');
                }
              }
            }}
            className="h-[92px] w-full resize-none bg-transparent border-0 outline-none px-2.5 py-2 text-[11.5px] leading-relaxed text-[#1c1c21] placeholder-[#a1a1aa] disabled:opacity-50"
          />

          <div className="px-2.5 py-2 border-t border-[#f1f1f4] flex items-center justify-between gap-2">
            <span className="text-[10px] text-[#a1a1aa] font-mono">⌘ + Enter</span>
            <button
              type="button"
              disabled={isBusy || !inputText.trim()}
              onClick={() => {
                if (inputText.trim()) {
                  handleAction({ type: 'text', text: inputText });
                  setInputText('');
                }
              }}
              className="h-[24px] px-3 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium transition-colors active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              发送
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
