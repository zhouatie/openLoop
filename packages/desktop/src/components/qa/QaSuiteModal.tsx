import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Globe,
  Monitor,
  Smartphone,
  RefreshCw,
  Radio,
  Wifi,
  Package,
} from 'lucide-react';
import { QaSuite, QaStep, QaStepType, QaPlatform, AndroidDeviceInfo } from '@openloop/core';
import { api } from '../../services/api';
import { toast } from '../Toast';

interface QaSuiteModalProps {
  initialSuite?: QaSuite | null;
  onSave: (suite: Partial<QaSuite>) => Promise<void>;
  onClose: () => void;
}

export const QaSuiteModal: React.FC<QaSuiteModalProps> = ({
  initialSuite,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState(initialSuite?.name || '');
  const [description, setDescription] = useState(initialSuite?.description || '');
  const [platform, setPlatform] = useState<QaPlatform>(initialSuite?.platform || 'web');
  const [targetUrl, setTargetUrl] = useState(initialSuite?.targetUrl || 'http://localhost:3000');
  const [appPackage, setAppPackage] = useState(initialSuite?.appPackage || '');
  const [deviceSerial, setDeviceSerial] = useState(initialSuite?.deviceSerial || '');
  const [isMobile, setIsMobile] = useState(Boolean(initialSuite?.viewport?.isMobile));
  
  // Android 设备列表状态
  const [devices, setDevices] = useState<AndroidDeviceInfo[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [isFetchingApp, setIsFetchingApp] = useState(false);
  const [wifiAddress, setWifiAddress] = useState('');
  const [showWifiConnect, setShowWifiConnect] = useState(false);
  const [isConnectingWifi, setIsConnectingWifi] = useState(false);

  const [steps, setSteps] = useState<QaStep[]>(() => {
    if (initialSuite?.steps && initialSuite.steps.length > 0) {
      return initialSuite.steps;
    }
    return [
      { id: 's1', type: 'action', prompt: '等待页面完成首屏加载，点击页面顶部的登录或注册按钮' },
      { id: 's2', type: 'action', prompt: '在用户名输入框输入 demo_user，密码输入 123456' },
      { id: 's3', type: 'action', prompt: '点击「立即登录」按钮' },
      { id: 's4', type: 'assert', prompt: '页面呈现登录成功提示，并成功跳转至工作台仪表盘' },
    ];
  });
  const [isSaving, setIsSaving] = useState(false);

  // 加载 Android 设备
  const loadDevices = async () => {
    setIsLoadingDevices(true);
    if (import.meta.env?.DEV) {
      console.log('[QaSuiteModal] 探测 Android 设备与模拟器...');
    }
    try {
      const devList = await api.getAndroidDevices();
      setDevices(devList || []);
      if (!deviceSerial && devList && devList.length > 0) {
        // 默认选中首个在线设备
        const online = devList.find((d) => d.status === 'device');
        if (online) setDeviceSerial(online.serial);
      }
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[QaSuiteModal] 获取设备列表失败:', err);
      }
    } finally {
      setIsLoadingDevices(false);
    }
  };

  useEffect(() => {
    if (platform === 'android') {
      loadDevices();
    }
  }, [platform]);

  // 从当前设备一键抓取前台 App
  const handleFetchCurrentApp = async () => {
    setIsFetchingApp(true);
    if (import.meta.env?.DEV) {
      console.log('[QaSuiteModal] 抓取前台应用, serial:', deviceSerial);
    }
    try {
      const res = await api.getAndroidCurrentApp(deviceSerial || undefined);
      if (res && res.packageName) {
        const fullTarget = res.activityName ? `${res.packageName}/${res.activityName}` : res.packageName;
        setAppPackage(fullTarget);
        toast.success(`成功识别前台应用: ${res.packageName}`);
      } else {
        toast.info('未获取到活跃的前台应用，请确认设备屏幕已解锁并处于前台');
      }
    } catch (err: any) {
      toast.error(`获取前台应用失败: ${err.message}`);
    } finally {
      setIsFetchingApp(false);
    }
  };

  // WiFi ADB 连接
  const handleConnectWifi = async () => {
    if (!wifiAddress.trim()) return;
    setIsConnectingWifi(true);
    try {
      const res = await api.connectAndroidWifi(wifiAddress.trim());
      if (res.success) {
        toast.success(`WiFi 设备连接成功: ${wifiAddress}`);
        setShowWifiConnect(false);
        setWifiAddress('');
        await loadDevices();
      } else {
        toast.error(`连接失败: ${res.message}`);
      }
    } catch (err: any) {
      toast.error(`连接失败: ${err.message}`);
    } finally {
      setIsConnectingWifi(false);
    }
  };

  const handleAddStep = () => {
    const newStep: QaStep = {
      id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      type: 'action',
      prompt: '',
    };
    if (import.meta.env?.DEV) {
      console.log('[QaSuiteModal] 添加新步骤:', newStep.id);
    }
    setSteps([...steps, newStep]);
  };

  const handleRemoveStep = (index: number) => {
    if (import.meta.env?.DEV) {
      console.log('[QaSuiteModal] 移除步骤:', index);
    }
    setSteps(steps.filter((_, idx) => idx !== index));
  };

  const handleMoveStep = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= steps.length) return;
    const next = [...steps];
    const [moved] = next.splice(index, 1);
    next.splice(targetIdx, 0, moved);
    setSteps(next);
  };

  const handleUpdateStep = (index: number, updates: Partial<QaStep>) => {
    setSteps(steps.map((s, idx) => (idx === index ? { ...s, ...updates } : s)));
  };

  const handleFillTemplate = (templateType: 'web-ecommerce' | 'web-form' | 'android-app' | 'android-settings') => {
    if (templateType === 'web-ecommerce') {
      setName('电商商品购买全链路视觉验收');
      setDescription('使用多模态视觉模型验证商品详情展示、加购交互及订单确认页面的视觉完整性');
      setPlatform('web');
      setTargetUrl('http://localhost:3000/shop');
      setSteps([
        { id: 's1', type: 'action', prompt: '浏览商品推荐流，点击第 1 件热销商品卡片' },
        { id: 's2', type: 'assert', prompt: '商品详情页正常加载，主图清晰且显示价格标签与「加入购物车」按钮' },
        { id: 's3', type: 'action', prompt: '点击页面中的「加入购物车」按钮' },
        { id: 's4', type: 'assert', prompt: '页面右上角购物车角标更新为 1，弹出加入成功的浮层提示' },
      ]);
    } else if (templateType === 'web-form') {
      setName('客户信息表单校验与提交');
      setDescription('测试表单必填校验高亮提示以及填写完成后的成功反馈');
      setPlatform('web');
      setTargetUrl('http://localhost:3000/contact');
      setSteps([
        { id: 's1', type: 'action', prompt: '不填写内容，直接点击底部的「提交」按钮' },
        { id: 's2', type: 'assert', prompt: '输入框下方弹出红色的表单必填校验错误提示' },
        { id: 's3', type: 'action', prompt: '在姓名输入框填写「张工程师」，邮箱填写「test@example.com」' },
        { id: 's4', type: 'action', prompt: '再次点击「提交」按钮' },
        { id: 's5', type: 'assert', prompt: '页面呈现绿色的提交成功提示卡片' },
      ]);
    } else if (templateType === 'android-app') {
      setName('移动端原生应用主链路探索');
      setDescription('唤醒 App 并进行主界面导航、列表滑动与返回操作验收');
      setPlatform('android');
      setAppPackage(appPackage || 'com.android.chrome');
      setSteps([
        { id: 's1', type: 'action', prompt: '等待应用首屏渲染完成，如果出现权限弹窗点击允许或同意' },
        { id: 's2', type: 'assert', prompt: '界面正常展示主功能入口或顶栏，无无响应闪退提示' },
        { id: 's3', type: 'action', prompt: '向上滑动浏览更多内容' },
        { id: 's4', type: 'action', prompt: '点击返回按钮回到前一个视口' },
        { id: 's5', type: 'assert', prompt: '界面成功返回并呈现稳定的内容流' },
      ]);
    } else if (templateType === 'android-settings') {
      setName('移动端设置与物理按键响应');
      setDescription('验证移动端通用按键与设置页面的交互流');
      setPlatform('android');
      setAppPackage('com.android.settings');
      setSteps([
        { id: 's1', type: 'action', prompt: '进入系统设置界面，等待列表展示' },
        { id: 's2', type: 'assert', prompt: '页面包含网络、显示或系统相关设置项' },
        { id: 's3', type: 'action', prompt: '执行 Android 物理返回键' },
      ]);
    }
    if (import.meta.env?.DEV) {
      console.log('[QaSuiteModal] 应用预设模板:', templateType);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveTarget = platform === 'android' ? (appPackage.trim() || targetUrl.trim()) : targetUrl.trim();
    if (!name.trim() || !effectiveTarget || steps.length === 0) return;

    setIsSaving(true);
    if (import.meta.env?.DEV) {
      console.log('[QaSuiteModal] 提交保存用例:', { name, platform, effectiveTarget, stepsCount: steps.length });
    }
    try {
      await onSave({
        id: initialSuite?.id,
        name: name.trim(),
        description: description.trim() || undefined,
        platform,
        targetUrl: effectiveTarget,
        appPackage: platform === 'android' ? appPackage.trim() : undefined,
        deviceSerial: platform === 'android' ? (deviceSerial || undefined) : undefined,
        viewport: platform === 'android'
          ? { width: 1080, height: 2400, isMobile: true }
          : isMobile
          ? { width: 390, height: 844, isMobile: true }
          : { width: 1280, height: 800, isMobile: false },
        steps,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-[12px] border border-[#e3e3e8] shadow-[0_12px_32px_rgba(0,0,0,0.12)] flex flex-col max-h-[88vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* 顶部标题栏 */}
        <div className="px-5 py-3.5 border-b border-[#ececf0] flex items-center justify-between shrink-0 bg-[#fafafc]">
          <div>
            <h2 className="text-[13.5px] font-semibold text-[#1c1c21]">
              {initialSuite ? '编辑测试用例' : '新建 QA 自动化测试用例'}
            </h2>
            <p className="text-[11.5px] text-[#85858d] mt-0.5">
              基于 Midscene 多模态视觉模型，以自然语言编排跨端操作与断言
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-[6px] hover:bg-[#f0f0f2] text-[#85858d] hover:text-[#1c1c21] flex items-center justify-center transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* 表单内容 */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 平台分段切换器 & 快速填入模版 */}
          <div className="flex items-center justify-between pb-3 border-b border-[#f4f4f6]">
            {/* 极简平台切换微胶囊 */}
            <div className="flex items-center gap-1 p-0.5 bg-[#f0f0f3] rounded-[6px]">
              <button
                type="button"
                onClick={() => setPlatform('web')}
                className={`h-6 px-3 rounded-[5px] text-[11.5px] font-medium flex items-center gap-1.5 transition-all ${
                  platform === 'web'
                    ? 'bg-white text-[#1c1c21] shadow-xs'
                    : 'text-[#71717a] hover:text-[#1c1c21]'
                }`}
              >
                <Globe size={12} />
                <span>Web 网页</span>
              </button>
              <button
                type="button"
                onClick={() => setPlatform('android')}
                className={`h-6 px-3 rounded-[5px] text-[11.5px] font-medium flex items-center gap-1.5 transition-all ${
                  platform === 'android'
                    ? 'bg-white text-[#1c1c21] shadow-xs'
                    : 'text-[#71717a] hover:text-[#1c1c21]'
                }`}
              >
                <Smartphone size={12} />
                <span>Android 移动端</span>
              </button>
            </div>

            {/* 模版快捷入口 */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-[#85858d] flex items-center gap-1">
                <Sparkles size={11} className="text-[#4f46e5]" />
                快速模板:
              </span>
              {platform === 'web' ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleFillTemplate('web-ecommerce')}
                    className="text-[11px] px-2 py-0.5 rounded-[4px] bg-[#f4f4f7] hover:bg-[#eeedfd] hover:text-[#4f46e5] text-[#52525b] border border-[#ececf0] transition-colors"
                  >
                    电商购买链路
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFillTemplate('web-form')}
                    className="text-[11px] px-2 py-0.5 rounded-[4px] bg-[#f4f4f7] hover:bg-[#eeedfd] hover:text-[#4f46e5] text-[#52525b] border border-[#ececf0] transition-colors"
                  >
                    表单校验提交
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleFillTemplate('android-app')}
                    className="text-[11px] px-2 py-0.5 rounded-[4px] bg-[#f4f4f7] hover:bg-[#eeedfd] hover:text-[#4f46e5] text-[#52525b] border border-[#ececf0] transition-colors"
                  >
                    App 探索与返回
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFillTemplate('android-settings')}
                    className="text-[11px] px-2 py-0.5 rounded-[4px] bg-[#f4f4f7] hover:bg-[#eeedfd] hover:text-[#4f46e5] text-[#52525b] border border-[#ececf0] transition-colors"
                  >
                    系统设置链路
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 基本信息 */}
          <div className="space-y-3">
            <div>
              <label className="block text-[11.5px] font-medium text-[#4b4b53] mb-1">
                用例名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={platform === 'android' ? '例如: 移动端核心链路自动化验收' : '例如: 核心功能全链路视觉验收'}
                className="w-full h-[30px] px-2.5 rounded-[6px] border border-[#e3e3e8] bg-white text-[12.5px] text-[#1c1c21] outline-none focus:border-[#4f46e5] shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
              />
            </div>

            <div>
              <label className="block text-[11.5px] font-medium text-[#4b4b53] mb-1">
                测试说明与验收目标
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="简短描述该自动化用例的覆盖范围和验收目标"
                className="w-full h-[30px] px-2.5 rounded-[6px] border border-[#e3e3e8] bg-white text-[12.5px] text-[#1c1c21] outline-none focus:border-[#4f46e5] shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
              />
            </div>

            {/* Web 专属配置 */}
            {platform === 'web' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11.5px] font-medium text-[#4b4b53] mb-1">
                    目标测试 URL <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Globe size={13} className="absolute left-2.5 top-2.5 text-[#a1a1aa]" />
                    <input
                      type="text"
                      required
                      value={targetUrl}
                      onChange={(e) => setTargetUrl(e.target.value)}
                      placeholder="http://localhost:3000"
                      className="w-full h-[30px] pl-8 pr-2.5 rounded-[6px] border border-[#e3e3e8] bg-white font-mono text-[11.5px] text-[#1c1c21] outline-none focus:border-[#4f46e5] shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11.5px] font-medium text-[#4b4b53] mb-1">
                    视口模式
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setIsMobile(false)}
                      className={`flex-1 h-[30px] rounded-[6px] border text-[11.5px] font-medium flex items-center justify-center gap-1.5 transition-all ${
                        !isMobile
                          ? 'bg-[#1c1c21] border-[#1c1c21] text-white'
                          : 'border-[#e3e3e8] bg-white text-[#71717a] hover:bg-[#f9f9fb]'
                      }`}
                    >
                      <Monitor size={12} />
                      <span>桌面端 (1280x800)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsMobile(true)}
                      className={`flex-1 h-[30px] rounded-[6px] border text-[11.5px] font-medium flex items-center justify-center gap-1.5 transition-all ${
                        isMobile
                          ? 'bg-[#1c1c21] border-[#1c1c21] text-white'
                          : 'border-[#e3e3e8] bg-white text-[#71717a] hover:bg-[#f9f9fb]'
                      }`}
                    >
                      <Smartphone size={12} />
                      <span>移动端 (390x844)</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Android 专属配置 */}
            {platform === 'android' && (
              <div className="space-y-3 p-3 rounded-[8px] bg-[#fafafc] border border-[#e3e3e8]">
                {/* 设备选择 */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11.5px] font-medium text-[#4b4b53] flex items-center gap-1.5">
                      <Radio size={12} className="text-[#4f46e5]" />
                      <span>目标设备 / 模拟器</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowWifiConnect(!showWifiConnect)}
                        className="text-[11px] text-[#4f46e5] hover:underline flex items-center gap-1"
                      >
                        <Wifi size={11} />
                        <span>WiFi 远程连接</span>
                      </button>
                      <button
                        type="button"
                        onClick={loadDevices}
                        disabled={isLoadingDevices}
                        className="text-[11px] text-[#71717a] hover:text-[#1c1c21] flex items-center gap-1"
                        title="刷新设备列表"
                      >
                        <RefreshCw size={11} className={isLoadingDevices ? 'animate-spin' : ''} />
                        <span>刷新</span>
                      </button>
                    </div>
                  </div>

                  {showWifiConnect && (
                    <div className="mb-2 p-2 rounded-[6px] bg-white border border-[#e3e3e8] flex items-center gap-2 animate-in fade-in duration-100">
                      <input
                        type="text"
                        value={wifiAddress}
                        onChange={(e) => setWifiAddress(e.target.value)}
                        placeholder="例如: 192.168.1.100:5555"
                        className="flex-1 h-[26px] px-2 rounded-[4px] border border-[#e3e3e8] text-[11.5px] font-mono outline-none focus:border-[#4f46e5]"
                      />
                      <button
                        type="button"
                        onClick={handleConnectWifi}
                        disabled={isConnectingWifi || !wifiAddress.trim()}
                        className="h-[26px] px-3 rounded-[4px] bg-[#1c1c21] text-white text-[11px] font-medium hover:bg-[#2e2f36] disabled:opacity-50"
                      >
                        {isConnectingWifi ? '连接中...' : '连接'}
                      </button>
                    </div>
                  )}

                  {devices.length === 0 ? (
                    <div className="py-2.5 px-3 rounded-[6px] bg-white border border-[#e3e3e8] text-[11.5px] text-[#85858d] flex items-center justify-between">
                      <span>暂未探查到在线设备，请连接 USB 或启动模拟器</span>
                      <button
                        type="button"
                        onClick={loadDevices}
                        className="text-[11px] text-[#4f46e5] hover:underline"
                      >
                        重新探查
                      </button>
                    </div>
                  ) : (
                    <select
                      value={deviceSerial}
                      onChange={(e) => setDeviceSerial(e.target.value)}
                      className="w-full h-[30px] px-2.5 rounded-[6px] border border-[#e3e3e8] bg-white text-[12px] text-[#1c1c21] outline-none focus:border-[#4f46e5]"
                    >
                      <option value="">自动调度首个可用设备</option>
                      {devices.map((d) => (
                        <option key={d.serial} value={d.serial}>
                          {d.model} ({d.serial}){d.version ? ` · ${d.version}` : ''} · {d.isEmulator ? '模拟器' : '真机'}
                          {d.status === 'unauthorized' ? ' · 待授权' : d.status === 'offline' ? ' · 离线' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* 目标应用包名与一键抓取 */}
                <div>
                  <label className="block text-[11.5px] font-medium text-[#4b4b53] mb-1">
                    目标应用包名 (Package) 或唤醒 Activity <span className="text-red-500">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Package size={13} className="absolute left-2.5 top-2.5 text-[#a1a1aa]" />
                      <input
                        type="text"
                        required
                        value={appPackage}
                        onChange={(e) => setAppPackage(e.target.value)}
                        placeholder="例如: com.android.chrome 或 com.example.app/.MainActivity"
                        className="w-full h-[30px] pl-8 pr-2.5 rounded-[6px] border border-[#e3e3e8] bg-white font-mono text-[11.5px] text-[#1c1c21] outline-none focus:border-[#4f46e5] shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleFetchCurrentApp}
                      disabled={isFetchingApp || devices.length === 0}
                      className="h-[30px] px-3 rounded-[6px] bg-white border border-[#e3e3e8] hover:bg-[#f4f4f7] hover:border-[#b9b9c2] text-[11.5px] text-[#1c1c21] font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 shrink-0"
                      title="读取设备当前正在前台运行的应用包名"
                    >
                      <RefreshCw size={11} className={isFetchingApp ? 'animate-spin' : ''} />
                      <span>抓取前台 App</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* AI 步骤编排序列 */}
          <div className="space-y-2.5 pt-2">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[12px] font-semibold text-[#1c1c21]">
                  AI 视觉步骤编排 ({steps.length} 步)
                </h3>
                <p className="text-[11px] text-[#85858d]">
                  Midscene 执行每步时均会自动进行多模态视觉推理、坐标定位与截图归档
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddStep}
                className="h-[26px] px-2.5 rounded-[5px] bg-[#f4f4f7] hover:bg-[#e4e4e7] text-[#1c1c21] text-[11.5px] font-medium flex items-center gap-1 border border-[#ececf0] transition-colors"
              >
                <Plus size={11} strokeWidth={2.4} />
                <span>添加步骤</span>
              </button>
            </div>

            <div className="space-y-2">
              {steps.map((step, idx) => (
                <div
                  key={step.id || idx}
                  className="p-2.5 rounded-[7px] border border-[#e3e3e8] bg-[#fafafc] hover:border-[#b9b9c2] transition-colors space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full bg-[#e4e4e7] text-[#3f3f46] text-[10px] font-mono font-semibold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <select
                        value={step.type}
                        onChange={(e) =>
                          handleUpdateStep(idx, { type: e.target.value as QaStepType })
                        }
                        className="h-[24px] px-2 rounded-[4px] border border-[#d4d4d8] text-[11.5px] font-medium outline-none bg-white text-[#1c1c21]"
                      >
                        <option value="action">aiAction (操作动作)</option>
                        <option value="assert">aiAssert (视觉断言)</option>
                        <option value="waitFor">aiWaitFor (等待元素)</option>
                        <option value="query">aiQuery (数据提取)</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMoveStep(idx, 'up')}
                        className="w-5 h-5 rounded hover:bg-[#e4e4e7] disabled:opacity-25 text-[#71717a] flex items-center justify-center"
                        title="上移"
                      >
                        <ArrowUp size={11} />
                      </button>
                      <button
                        type="button"
                        disabled={idx === steps.length - 1}
                        onClick={() => handleMoveStep(idx, 'down')}
                        className="w-5 h-5 rounded hover:bg-[#e4e4e7] disabled:opacity-25 text-[#71717a] flex items-center justify-center"
                        title="下移"
                      >
                        <ArrowDown size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveStep(idx)}
                        className="w-5 h-5 rounded hover:bg-red-50 text-red-500 flex items-center justify-center ml-1"
                        title="删除该步"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>

                  <input
                    type="text"
                    required
                    value={step.prompt}
                    onChange={(e) => handleUpdateStep(idx, { prompt: e.target.value })}
                    placeholder={
                      platform === 'android'
                        ? step.type === 'assert'
                          ? '如: 页面包含「购物车」标签且商品单价正常显示'
                          : '如: 点击「加入购物车」按钮 / 向上滑动浏览 / 按返回键'
                        : step.type === 'assert'
                        ? '如: 界面出现「登录成功」提示且无红字报错'
                        : '如: 点击页面右上角「登录」按钮'
                    }
                    className="w-full h-[28px] px-2 rounded-[5px] border border-[#e3e3e8] bg-white text-[12px] text-[#1c1c21] outline-none focus:border-[#4f46e5]"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 底部保存按钮 */}
          <div className="pt-3 border-t border-[#ececf0] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-[30px] px-3.5 rounded-[6px] border border-[#e3e3e8] bg-white text-[12px] font-medium text-[#52525b] hover:bg-[#f4f4f7] transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSaving || steps.length === 0}
              className="h-[30px] px-4 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all shadow-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSaving ? '正在保存...' : '保存测试用例'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
