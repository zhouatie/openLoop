import React, { useState, useEffect, useRef } from 'react';
import { BrandLogo } from './BrandLogo';
import styles from './AppSplashScreen.module.css';

export interface AppSplashScreenProps {
  /** 外部背景数据加载是否进行中（如接口请求、工作区与任务初始化） */
  isLoading: boolean;
  /** 开屏 Logo 动效的最短展示时长 (毫秒)，默认 1000ms，保证优雅动效完整呈现 */
  minDuration?: number;
  /** 开屏 Logo 动效的兜底上限时长 (毫秒)，默认 2600ms，超时即使网络挂起也自动淡出 */
  maxDuration?: number;
  /** 开屏彻底退出并卸载 DOM 时的回调 */
  onComplete?: () => void;
}

/**
 * 应用开启前纯净优雅的品牌 Logo 动效浮层 (AppSplashScreen)。
 *
 * 特性：
 * 1. 极致纯净：无外圈与文案干扰，专注呈现大幅（384px）夜巡猫头鹰品牌标识与呼吸微动效；
 * 2. 遮罩承托：全屏覆盖并承托底层视口，给底部看板、工作流与插件列表预留充足的数据加载时间；
 * 3. 丝滑退出：达到最短时长且数据就绪后（或兜底超时后），通过 450ms 贝塞尔曲线平滑渐隐淡出。
 */
export const AppSplashScreen: React.FC<AppSplashScreenProps> = ({
  isLoading,
  minDuration = 1000,
  maxDuration = 2600,
  onComplete,
}) => {
  const [isMounted, setIsMounted] = useState<boolean>(true);
  const [isExiting, setIsExiting] = useState<boolean>(false);
  const [minTimePassed, setMinTimePassed] = useState<boolean>(false);
  const [maxTimePassed, setMaxTimePassed] = useState<boolean>(false);
  // 回调只用于退出完成通知，放进 ref 避免父级重渲染打断卸载计时
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (import.meta.env?.DEV) {
      console.log('[SplashScreen] 启动 Logo 动效启动，背景加载中...', {
        minDuration,
        maxDuration,
      });
    }

    const minTimer = setTimeout(() => {
      setMinTimePassed(true);
    }, minDuration);

    const maxTimer = setTimeout(() => {
      setMaxTimePassed(true);
    }, maxDuration);

    return () => {
      clearTimeout(minTimer);
      clearTimeout(maxTimer);
    };
  }, [minDuration, maxDuration]);

  useEffect(() => {
    if (isExiting || !isMounted) return;

    // 当满足最短播放时间且背景数据加载完成，或者触发最大安全上限兜底时，启动渐隐退出
    const canExit = (minTimePassed && !isLoading) || maxTimePassed;
    if (!canExit) return;
    if (import.meta.env?.DEV) {
      console.log('[SplashScreen] 满足退出条件，启动优雅淡出过渡', {
        minTimePassed,
        isLoading,
        maxTimePassed,
      });
    }
    setIsExiting(true);
  }, [minTimePassed, isLoading, maxTimePassed, isExiting, isMounted]);

  // 淡出结束后卸载 DOM 并通知调用方；依赖只有稳定的状态值，父级重渲染不会重置计时
  useEffect(() => {
    if (!isExiting || !isMounted) return;
    const exitTimer = setTimeout(() => {
      setIsMounted(false);
      if (import.meta.env?.DEV) {
        console.log('[SplashScreen] 启动 Logo 动效彻底结束，已卸载 DOM');
      }
      onCompleteRef.current?.();
    }, 450);
    return () => clearTimeout(exitTimer);
  }, [isExiting, isMounted]);

  if (!isMounted) return null;

  return (
    <div
      className={`${styles.splashOverlay} ${isExiting ? styles.splashOverlayExiting : ''}`}
      role="status"
      aria-live="polite"
      aria-label="正在启动 openLoop"
    >
      <div className={styles.stage}>
        {/* 纯净居中标识舞台：纯夜巡猫头鹰 Logo 动效 */}
        <div className={styles.emblemBox}>
          {/* 弥散呼吸光晕 */}
          <div className={styles.ambientGlow} aria-hidden="true" />

          {/* 核心品牌 Logo：大幅夜巡猫头鹰 (384px) */}
          <div className={styles.logoWrapper}>
            <BrandLogo size={384} className="shrink-0" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppSplashScreen;
