import React, { useEffect, useState } from 'react';
import { useShortcuts } from '../context/ShortcutContext';

interface ShortcutRecorderProps {
  commandId: string;
  /** 悬停提示 */
  title?: string;
}

/** 快捷键录制：点击后按下组合键即可写入绑定（Esc 取消） */
export const ShortcutRecorder: React.FC<ShortcutRecorderProps> = ({ commandId, title }) => {
  const { describeShortcut, captureBinding, setBinding } = useShortcuts();
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setListening(false);
        return;
      }
      const binding = captureBinding(event);
      if (!binding) return;
      if (import.meta.env?.DEV) {
        console.log('[ShortcutRecorder] 录制绑定:', { commandId, binding });
      }
      void setBinding(commandId, binding);
      setListening(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [listening, commandId, captureBinding, setBinding]);

  const tokens = describeShortcut(commandId);

  return (
    <button
      type="button"
      onClick={() => setListening((prev) => !prev)}
      title={title || '点击后按下新的组合键'}
      className={`inline-flex items-center justify-center gap-[3px] h-[22px] min-w-[70px] px-2 rounded-[5px] border text-[10.5px] font-mono transition-colors cursor-pointer ${
        listening
          ? 'border-[#4f46e5] bg-[#eef2ff] text-[#4338ca]'
          : 'border-[#d2d2d8] bg-[#f0f0f3] text-[#4b4b53] hover:border-[#b9b9c2]'
      }`}
    >
      {listening
        ? '按下组合键…'
        : tokens.map((token, index) => (
            <kbd key={index} className="leading-none">
              {token}
            </kbd>
          ))}
    </button>
  );
};

export default ShortcutRecorder;
