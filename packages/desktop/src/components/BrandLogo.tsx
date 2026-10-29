import React from 'react';

interface BrandLogoProps {
  size?: number;
  className?: string;
  title?: string;
}

/**
 * openLoop 品牌标识：夜巡猫头鹰（Night-watch Owl）。
 *
 * 语义映射：
 * - 两只圆形眼窝构成镂空双环，对应 openLoop 的环状编排（open loop）；
 * - 双眼正视前方，对应全流程日志可观测；
 * - 耳羽向上张开，轮廓收口开放。
 *
 * 眼窝用 evenodd 挖空（透明），可放在任意底色上；鸟喙是全标识唯一的强调色 #4f46e5。
 * 几何比例与 build/icon.svg（桌面应用图标）保持一致。
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 20,
  className = '',
  title = 'openLoop',
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      {/* 耳羽 */}
      <path d="M29 17 L36 46 L50 38 Z" fill="#1c1c21" />
      <path d="M99 17 L92 46 L78 38 Z" fill="#1c1c21" />
      {/* 头部 + 镂空双环眼窝 */}
      <path
        fillRule="evenodd"
        fill="#1c1c21"
        d="M107 76 A43 43 0 1 0 21 76 A43 43 0 1 0 107 76 Z M64 70 A17 17 0 1 1 30 70 A17 17 0 1 1 64 70 Z M98 70 A17 17 0 1 1 64 70 A17 17 0 1 1 98 70 Z"
      />
      {/* 瞳孔 */}
      <circle cx="46.5" cy="72.5" r="7.6" fill="#1c1c21" />
      <circle cx="81.5" cy="72.5" r="7.6" fill="#1c1c21" />
      {/* 鸟喙：唯一强调色 */}
      <path d="M64 96 L57.5 82.5 L70.5 82.5 Z" fill="#4f46e5" />
    </svg>
  );
};

export default BrandLogo;
