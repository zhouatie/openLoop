import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Eraser,
  GitBranch,
  GitMerge,
  Layers,
  Plus,
  SquareCheck,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  CARD_KINDS,
  FIELD_TYPE_LABELS,
  KEY_LABELS,
  NODE_TYPES,
  createCard,
  field,
  isMultiline,
  jsonIssue,
  kindMeta,
} from '../../utils/pipelineCards';
import type { CardField, CardKind, FieldType, PipelineCard } from '../../utils/pipelineCards';
import { autoResizeTextarea } from '../../utils/autoResizeTextarea';

const KIND_ICONS: Record<CardKind, LucideIcon> = {
  worktree: GitBranch,
  agent: Bot,
  approval: SquareCheck,
  node: Terminal,
  merge: GitMerge,
  cleanup: Eraser,
};

const FIELD_TYPES = Object.keys(FIELD_TYPE_LABELS) as FieldType[];

const CONTROL =
  'w-full bg-white rounded-[5px] px-1.5 py-1 text-[11.5px] text-[#3f3f46] outline-none border border-[#ececf0] hover:border-[#dcdce2] focus:border-[#b9b9c2] transition-colors placeholder:text-[#c4c4cc]';

export interface PipelineCardsProps {
  cards: PipelineCard[];
  onChange: (cards: PipelineCard[]) => void;
}

/** 步骤卡片列表：一步一张卡片，参数按字段填写，保存时拼回调用参数 */
export const PipelineCards: React.FC<PipelineCardsProps> = ({ cards, onChange }) => {
  const [pickerOpen, setPickerOpen] = useState(false);

  const patch = (id: string, next: Partial<PipelineCard>) => {
    onChange(cards.map((card) => (card.id === id ? { ...card, ...next } : card)));
  };

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= cards.length) return;
    const next = [...cards];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const add = (kind: CardKind) => {
    onChange([...cards, createCard(kind)]);
    setPickerOpen(false);
  };

  const remove = (id: string) => {
    onChange(cards.filter((card) => card.id !== id));
  };

  const patchField = (card: PipelineCard, fieldId: string, next: Partial<CardField>) => {
    patch(card.id, {
      fields: card.fields.map((item) => (item.id === fieldId ? { ...item, ...next } : item)),
    });
  };

  const addField = (card: PipelineCard) => {
    patch(card.id, { fields: [...card.fields, field('', 'text', '')] });
  };

  const removeField = (card: PipelineCard, fieldId: string) => {
    patch(card.id, { fields: card.fields.filter((item) => item.id !== fieldId) });
  };

  const renderValue = (card: PipelineCard, item: CardField) => {
    const set = (next: Partial<CardField>) => patchField(card, item.id, next);

    if (item.type === 'bool') {
      return (
        <select
          value={item.value === 'true' ? 'true' : 'false'}
          onChange={(event) => set({ value: event.target.value })}
          className={`${CONTROL} max-w-[120px] cursor-pointer`}
        >
          <option value="true">是</option>
          <option value="false">否</option>
        </select>
      );
    }

    if (item.type === 'number') {
      return (
        <input
          value={item.value}
          onChange={(event) => set({ value: event.target.value })}
          spellCheck={false}
          className={`${CONTROL} max-w-[140px] font-mono`}
        />
      );
    }

    if (item.type === 'lines' || item.type === 'json' || (item.type === 'text' && isMultiline(item.key))) {
      const issue = item.type === 'json' ? jsonIssue(item.value) : null;
      return (
        <>
          <textarea
            ref={(el) => autoResizeTextarea(el, 220)}
            value={item.value}
            onChange={(event) => set({ value: event.target.value })}
            rows={2}
            spellCheck={false}
            placeholder={item.type === 'lines' ? '一行一项' : item.type === 'json' ? '{ … } 或 [ … ]' : ''}
            className={`${CONTROL} resize-none leading-[17px] ${item.type === 'text' ? '' : 'font-mono'}`}
          />
          {issue && <div className="px-1.5 pb-1 text-[10.5px] text-[#b45309]">{issue}</div>}
        </>
      );
    }

    return (
      <input
        value={item.value}
        onChange={(event) => set({ value: event.target.value })}
        spellCheck={false}
        className={CONTROL}
      />
    );
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pb-1">
      {cards.length === 0 && (
        <div className="rounded-[8px] bg-white/60 border border-dashed border-[#d8d8df] px-6 py-9 text-center">
          <Layers size={18} strokeWidth={1.6} className="mx-auto text-[#c4c4cc]" />
          <div className="mt-1.5 text-[12px] font-medium text-[#3f3f46]">还没有步骤</div>
          <p className="mt-1 text-[11px] text-[#85858d] leading-relaxed">
            添加 Worktree、AI Agent 或通用节点，参数按字段填写。
          </p>
        </div>
      )}

      {cards.map((card, index) => {
        const meta = kindMeta(card.kind);
        const Icon = KIND_ICONS[card.kind];
        return (
          <div
            key={card.id}
            className="bg-white border border-[#e3e3e8] rounded-[8px] shadow-sm overflow-hidden"
          >
            <div className="flex items-center gap-2 px-2.5 h-[34px] border-b border-[#f1f1f4]">
              <span className="w-[14px] shrink-0 text-right text-[10px] font-mono text-[#a1a1aa]">
                {index + 1}
              </span>
              <span className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] border border-[#e3e3e8]/60 flex items-center justify-center text-[#63636b] shrink-0">
                <Icon size={11} strokeWidth={2} />
              </span>
              <input
                value={card.title}
                onChange={(event) => patch(card.id, { title: event.target.value })}
                placeholder={meta.label}
                title="步骤名称"
                className="flex-1 min-w-0 text-[12px] font-medium text-[#1c1c21] bg-transparent outline-none border-b border-transparent focus:border-[#d4d4d8] py-0.5"
              />
              {card.kind === 'node' && (
                <input
                  value={card.nodeType}
                  list="pipeline-node-types"
                  onChange={(event) => patch(card.id, { nodeType: event.target.value })}
                  placeholder="cli"
                  title="执行器类型"
                  className="w-[110px] h-[20px] shrink-0 px-1.5 rounded-[4px] bg-[#f9f9fb] border border-[#e3e3e8] text-[10.5px] font-mono text-[#52525b] outline-none focus:bg-white focus:border-[#b9b9c2]"
                />
              )}
              {card.kind !== 'node' && (
                <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f5] text-[#52525b] text-[10px] font-medium font-mono">
                  {meta.stepType}
                </span>
              )}
              <span className="w-[1px] h-3.5 bg-[#ececf0] shrink-0" />
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                title="上移"
                className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === cards.length - 1}
                title="下移"
                className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
              >
                <ArrowDown size={12} />
              </button>
              <button
                type="button"
                onClick={() => remove(card.id)}
                title="删除步骤"
                className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#dc2626] hover:bg-[#fef2f2] flex items-center justify-center transition-all cursor-pointer"
              >
                <Trash2 size={12} />
              </button>
            </div>

            <div className="py-1">
              {card.fields.map((item) => {
                const known = KEY_LABELS[item.key] !== undefined;
                return (
                  <div key={item.id} className="group flex items-start gap-1.5 px-2.5 py-0.5">
                    {known ? (
                      <span
                        title={item.key}
                        className="w-[82px] shrink-0 pt-[6px] text-[11px] text-[#71717a] truncate"
                      >
                        {KEY_LABELS[item.key]}
                      </span>
                    ) : (
                      <>
                        <input
                          value={item.key}
                          onChange={(event) => patchField(card, item.id, { key: event.target.value })}
                          placeholder="键名"
                          spellCheck={false}
                          className="w-[92px] shrink-0 mt-[5px] px-1.5 h-[22px] rounded-[4px] bg-[#f9f9fb] border border-[#e9e9ee] font-mono text-[10.5px] text-[#52525b] outline-none focus:bg-white focus:border-[#b9b9c2]"
                        />
                        <select
                          value={item.type}
                          onChange={(event) =>
                            patchField(card, item.id, { type: event.target.value as FieldType })
                          }
                          title="字段类型"
                          className="w-[54px] shrink-0 mt-[5px] h-[22px] px-1 rounded-[4px] bg-[#f9f9fb] border border-[#e9e9ee] text-[10.5px] text-[#52525b] outline-none focus:bg-white focus:border-[#b9b9c2] cursor-pointer"
                        >
                          {FIELD_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {FIELD_TYPE_LABELS[type]}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                    <div className="flex-1 min-w-0">{renderValue(card, item)}</div>
                    <button
                      type="button"
                      onClick={() => removeField(card, item.id)}
                      title="删除字段"
                      className="w-5 h-5 mt-[4px] shrink-0 rounded-[3px] text-[#c4c4cc] opacity-0 group-hover:opacity-100 hover:text-[#dc2626] hover:bg-[#fef2f2] flex items-center justify-center transition-all cursor-pointer"
                    >
                      <X size={11} />
                    </button>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={() => addField(card)}
                className="ml-2.5 mt-0.5 mb-0.5 px-1.5 h-[20px] rounded-[4px] text-[10.5px] text-[#a1a1aa] hover:text-[#3f3f46] hover:bg-[#f4f4f6] flex items-center gap-1 transition-colors cursor-pointer"
              >
                <Plus size={10} strokeWidth={2.4} />
                <span>字段</span>
              </button>
            </div>
          </div>
        );
      })}

      <div>
        <button
          type="button"
          onClick={() => setPickerOpen((prev) => !prev)}
          className="w-full h-[32px] rounded-[8px] border border-dashed border-[#d8d8df] text-[11.5px] text-[#71717a] hover:border-[#b9b9c2] hover:text-[#1c1c21] hover:bg-white flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <Plus size={12} strokeWidth={2.4} />
          <span>添加步骤</span>
        </button>

        {pickerOpen && (
          <div className="mt-1.5 bg-white border border-[#e3e3e8] rounded-[8px] shadow-[0_8px_20px_rgba(0,0,0,0.08)] p-1.5 grid grid-cols-2 gap-1">
            {CARD_KINDS.map((meta) => {
              const Icon = KIND_ICONS[meta.kind];
              return (
                <button
                  key={meta.kind}
                  type="button"
                  onClick={() => add(meta.kind)}
                  className="flex items-start gap-2 p-2 rounded-[6px] text-left hover:bg-[#fafafc] transition-colors cursor-pointer"
                >
                  <span className="w-5 h-5 mt-0.5 rounded-[4px] bg-[#f4f4f6] border border-[#e3e3e8]/60 flex items-center justify-center text-[#63636b] shrink-0">
                    <Icon size={11} strokeWidth={2} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11.5px] font-medium text-[#3f3f46]">{meta.label}</span>
                    <span className="block text-[10.5px] text-[#a1a1aa] truncate">{meta.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <datalist id="pipeline-node-types">
        {NODE_TYPES.map((type) => (
          <option key={type} value={type} />
        ))}
      </datalist>
    </div>
  );
};
