interface ToolbarProps {
  conflictCount: number;
  pendingCount: number;
  activeConflict: number;
  onPrevConflict: () => void;
  onNextConflict: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onCopy: () => void;
  onDownload: () => void;
  copied: boolean;
}

export function Toolbar(props: ToolbarProps) {
  const {
    conflictCount,
    pendingCount,
    activeConflict,
    onPrevConflict,
    onNextConflict,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onReset,
    onCopy,
    onDownload,
    copied,
  } = props;
  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <h1>联合改稿工作台</h1>
        <span className="subtitle">品牌 × 法务 · 三方段落合并</span>
      </div>
      <div className="toolbar-center" role="group" aria-label="冲突导航">
        <button className="btn" onClick={onPrevConflict} disabled={conflictCount === 0}>
          ‹ 上一冲突
        </button>
        <span className="conflict-indicator">
          {conflictCount === 0
            ? '无冲突'
            : `冲突 ${activeConflict + 1}/${conflictCount} · 未解决 ${pendingCount}`}
        </span>
        <button className="btn" onClick={onNextConflict} disabled={conflictCount === 0}>
          下一冲突 ›
        </button>
      </div>
      <div className="toolbar-right">
        <button className="btn" onClick={onUndo} disabled={!canUndo} title="撤销 (Ctrl+Z)">
          ↺ 撤销
        </button>
        <button className="btn" onClick={onRedo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z / Ctrl+Y)">
          ↻ 重做
        </button>
        <span className="toolbar-sep" />
        <button className="btn" onClick={onReset} title="恢复内置示例稿件并清空全部裁决">
          ⟲ 恢复示例
        </button>
        <button className="btn" onClick={onCopy}>
          {copied ? '✓ 已复制' : '⧉ 复制合并稿'}
        </button>
        <button className="btn btn-primary" onClick={onDownload}>
          ⬇ 下载合并稿
        </button>
      </div>
    </header>
  );
}
