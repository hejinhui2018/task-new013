import { useEffect, useRef, useState } from 'react';

interface CommentPopoverProps {
  x: number;
  y: number;
  quote: string;
  mode: 'new' | 'reattach';
  initialText?: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

/** 选区上方的留言浮层：新建批注或手动重挂时输入批注内容。 */
export function CommentPopover({ x, y, quote, mode, initialText = '', onSubmit, onCancel }: CommentPopoverProps) {
  const [text, setText] = useState(initialText);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = () => {
    if (text.trim()) onSubmit(text.trim());
  };

  return (
    <div className="cm-popover" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="cm-popover-quote" title={quote}>
        {quote.length > 60 ? `“${quote.slice(0, 60)}…”` : `“${quote}”`}
      </div>
      {mode === 'reattach' ? (
        <p className="cm-popover-note">将把原批注挂到上面选中的文字，批注内容不变。</p>
      ) : (
        <textarea
          ref={ref}
          className="cm-popover-input"
          rows={3}
          placeholder="写下你的批注…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="批注内容"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
      )}
      <div className="cm-popover-actions">
        <button className="btn btn-small" onClick={onCancel}>
          取消
        </button>
        <button
          className="btn btn-small btn-primary"
          disabled={mode === 'new' && !text.trim()}
          onClick={submit}
          autoFocus={mode === 'reattach'}
        >
          {mode === 'reattach' ? '重挂到此' : '添加批注'}
        </button>
      </div>
    </div>
  );
}
