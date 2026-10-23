import React from 'react';

/**
 * 轻量且高效的关键词高亮组件（多词分词匹配）
 */
export const HighlightMatch: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  const trimmed = query.trim();
  if (!trimmed || !text) return <>{text}</>;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) return <>{text}</>;

  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) => {
        const isMatch = words.some((w) => w.toLowerCase() === part.toLowerCase());
        return isMatch ? (
          <span key={i} className="text-[#4f46e5] font-semibold bg-[#eeedfd]/80 px-0.5 rounded-[2px]">
            {part}
          </span>
        ) : (
          part
        );
      })}
    </>
  );
};
