/* 取自 deepseek-harness packages/client/ui-primitives/src/FoldToggle.tsx（MIT），原样保留。 */
interface FoldToggleProps {
  className: string | undefined;
  expanded: boolean;
  hidden: number;
  labels: {
    collapseAria: string;
    expandAria: (hidden: number) => string;
    collapse: string;
    expand: (hidden: number) => string;
  };
  onToggle: () => void;
}

/** 共享的头尾折叠按钮（高度受限的代码卡 / 差分卡使用） */
export function FoldToggle({ className, expanded, hidden, labels, onToggle }: FoldToggleProps) {
  return (
    <button
      type="button"
      className={className}
      aria-expanded={expanded}
      aria-label={expanded ? labels.collapseAria : labels.expandAria(hidden)}
      onClick={onToggle}
    >
      {expanded ? labels.collapse : labels.expand(hidden)}
    </button>
  );
}
