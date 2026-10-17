import React from 'react';
import { useShortcuts } from '../context/ShortcutContext';

interface KbdProps {
  keys?: (string | 'super')[];
  children?: React.ReactNode;
  variant?: 'light' | 'dark';
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export const Kbd: React.FC<KbdProps> = ({
  keys,
  children,
  variant = 'light',
  size = 'xs',
  className = '',
}) => {
  const { superKeySymbol } = useShortcuts();

  const sizeClasses = {
    xs: 'h-[17px] min-w-[17px] px-1 text-[10px]',
    sm: 'h-[19px] min-w-[19px] px-1.5 text-[10.5px]',
    md: 'h-[22px] min-w-[22px] px-2 text-[11.5px]',
  }[size];

  const variantClasses = {
    light:
      'bg-[#f0f0f3] text-[#4b4b53] border border-[#d2d2d8] shadow-[0_1px_0_rgba(0,0,0,0.06)]',
    dark:
      'bg-white/20 text-white/95 border border-white/25 shadow-[0_1px_0_rgba(0,0,0,0.18)]',
  }[variant];

  const items = keys || (children ? [children] : []);

  return (
    <span className={`inline-flex items-center gap-[3px] select-none ${className}`}>
      {items.map((item, index) => {
        const display = item === 'super' ? superKeySymbol : item;
        return (
          <kbd
            key={index}
            className={`inline-flex items-center justify-center rounded-[3.5px] font-mono font-medium leading-none tracking-tight ${sizeClasses} ${variantClasses}`}
          >
            {display}
          </kbd>
        );
      })}
    </span>
  );
};
