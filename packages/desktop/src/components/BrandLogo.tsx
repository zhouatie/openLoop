import React, { useId } from 'react';

interface BrandLogoProps {
  size?: number;
  className?: string;
  title?: string;
}

/**
 * openLoop 品牌标识：深色圆角方形容器 + 两个互扣的环形（双环 / loop）。
 * 左环为中性浅灰，右环为品牌靛蓝（#6366f1 亮态，#4f46e5 主色），
 * 上交叉点由左环压过右环，形成真实的链环扣合关系。
 * 几何比例与 build/icon.svg（桌面应用图标）保持一致。
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({ size = 20, className = '', title = 'openLoop' }) => {
  const uid = useId().replace(/:/g, '');
  const bgId = `openloop-brand-bg-${uid}`;
  const glowId = `openloop-brand-glow-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={bgId} x1="4" y1="1.5" x2="20" y2="22.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2b2b32" />
          <stop offset="0.55" stopColor="#1c1c21" />
          <stop offset="1" stopColor="#141418" />
        </linearGradient>
        <radialGradient id={glowId} cx="0.6" cy="0.5" r="0.44">
          <stop stopColor="#6366f1" stopOpacity="0.34" />
          <stop offset="1" stopColor="#6366f1" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="24" height="24" rx="6" fill={`url(#${bgId})`} />
      <rect width="24" height="24" rx="6" fill={`url(#${glowId})`} />

      {/* 左环：中性浅灰 */}
      <circle cx="9.2" cy="12" r="4.15" stroke="#d4d4d8" strokeWidth="1.8" />
      {/* 右环：品牌靛蓝 */}
      <circle cx="14.8" cy="12" r="4.15" stroke="#6366f1" strokeWidth="1.8" />
      {/* 上交叉段：左环压过右环，构成互扣 */}
      <path
        d="M10.482 8.053A4.15 4.15 0 0 1 13.259 11.137"
        stroke="#d4d4d8"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
};

export default BrandLogo;
