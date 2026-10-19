import React, { useState, KeyboardEvent } from 'react';
import { Tag as TagIcon, X, Plus } from 'lucide-react';

export interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const DEFAULT_SUGGESTIONS = ['工作', '研发', '部署', '测试', 'QA', 'CI/CD', '日常'];

export const TagInput: React.FC<TagInputProps> = ({
  tags = [],
  onChange,
  suggestions = DEFAULT_SUGGESTIONS,
  placeholder = '输入标签名后按回车添加...',
  disabled = false,
  className = '',
}) => {
  const [inputValue, setInputValue] = useState('');

  const handleAddTag = (rawTag: string) => {
    const trimmed = rawTag.trim().replace(/^#+/, '');
    if (!trimmed) return;
    if (tags.includes(trimmed)) {
      setInputValue('');
      return;
    }
    const nextTags = [...tags, trimmed];
    if (import.meta.env?.DEV) {
      console.log('[TagInput] 添加标签:', trimmed, '当前标签列表:', nextTags);
    }
    onChange(nextTags);
    setInputValue('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    if (disabled) return;
    const nextTags = tags.filter((t) => t !== tagToRemove);
    if (import.meta.env?.DEV) {
      console.log('[TagInput] 移除标签:', tagToRemove, '当前标签列表:', nextTags);
    }
    onChange(nextTags);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      e.stopPropagation();
      handleAddTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      e.preventDefault();
      handleRemoveTag(tags[tags.length - 1]);
    }
  };

  const remainingSuggestions = suggestions.filter((s) => !tags.includes(s));

  return (
    <div className={`space-y-1.5 ${className}`}>
      {/* 标签容器与输入框 */}
      <div
        className={`min-h-[34px] w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2 py-1 flex flex-wrap items-center gap-1.5 focus-within:bg-white focus-within:border-[#4f46e5] focus-within:ring-1 focus-within:ring-[#4f46e5]/30 transition-all ${
          disabled ? 'opacity-60 cursor-not-allowed' : ''
        }`}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#eeedfd] text-[#4f46e5] border border-[#d8d6fb] text-[11px] font-medium transition-colors select-none"
          >
            <TagIcon size={10} className="shrink-0 text-[#6366f1]" />
            <span className="max-w-[120px] truncate">{tag}</span>
            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveTag(tag);
                }}
                className="hover:bg-[#4f46e5]/10 rounded p-0.5 text-[#6366f1] hover:text-[#4338ca] transition-colors cursor-pointer"
                title={`删除标签: ${tag}`}
              >
                <X size={10} strokeWidth={2.2} />
              </button>
            )}
          </span>
        ))}

        {!disabled && (
          <div className="flex-1 min-w-[100px] flex items-center">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                if (inputValue.trim()) {
                  handleAddTag(inputValue);
                }
              }}
              placeholder={tags.length === 0 ? placeholder : '添加标签...'}
              className="w-full bg-transparent text-[12px] text-[#1c1c21] placeholder:text-[#85858d] outline-none"
            />
          </div>
        )}
      </div>

      {/* 推荐快速添加微标签 */}
      {!disabled && remainingSuggestions.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap pt-0.5">
          <span className="text-[10px] text-[#85858d] select-none">推荐:</span>
          {remainingSuggestions.map((sug) => (
            <button
              key={sug}
              type="button"
              onClick={() => handleAddTag(sug)}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f6] hover:bg-[#eeedfd] text-[#63636b] hover:text-[#4f46e5] border border-[#e3e3e8]/70 hover:border-[#d8d6fb] text-[10px] font-medium transition-all active:scale-95 cursor-pointer"
              title={`点击添加「${sug}」标签`}
            >
              <Plus size={9} strokeWidth={2.4} />
              <span>{sug}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
