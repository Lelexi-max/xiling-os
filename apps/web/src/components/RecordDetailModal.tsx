import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function RecordDetailModal({ title, eyebrow, children, onClose }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("record-modal-open");
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.classList.remove("record-modal-open"); };
  }, [onClose]);

  return createPortal(
    <div className="record-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="record-modal" role="dialog" aria-modal="true" aria-labelledby="record-modal-title">
        <header><div>{eyebrow ? <small>{eyebrow}</small> : null}<h2 id="record-modal-title">{title}</h2></div><button aria-label="关闭完整记录" onClick={onClose}>×</button></header>
        <div className="record-modal-content">{children}</div>
        <footer><span>完整记录</span><button onClick={onClose}>关闭</button></footer>
      </section>
    </div>,
    document.body,
  );
}
