import { useEffect, useState } from "react";
import type { AttentionItem } from "@xiling/contracts";

const labels = { approval: "待审批", "failed-run": "运行恢复", review: "审阅", "evidence-gap": "证据缺口", proposal: "事实提案" } as const;

export function AttentionView({ projectId, onNavigate }: { projectId: string; onNavigate(view: AttentionItem["targetView"]): void }) {
  const [items, setItems] = useState<AttentionItem[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); setLoading(true); void fetch(`/api/v1/attention?projectId=${encodeURIComponent(projectId)}`, { signal: controller.signal }).then(async (response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() as Promise<AttentionItem[]>; }).then((value) => { setItems(value); setError(""); }).catch((cause) => { if (cause.name !== "AbortError") setError("无法读取项目关注事项"); }).finally(() => setLoading(false)); return () => controller.abort(); }, [projectId]);
  return <div className="attention-view"><header><div><small>RESEARCH ATTENTION</small><h1>需要关注</h1><p>审批、失败恢复、证据缺口和待确认科研事实集中在这里。</p></div><span>{items.length}</span></header>{loading ? <p>正在核对项目状态…</p> : error ? <p className="research-error">{error}</p> : items.length ? <section>{items.map((item) => <article key={item.id} className={`severity-${item.severity}`}><i /><div><small>{labels[item.kind]}</small><h2>{item.title}</h2><p>{item.summary}</p><code>{item.sourceId}</code></div><button onClick={() => onNavigate(item.targetView)}>查看并处理 <span>→</span></button></article>)}</section> : <div className="attention-clear"><span>✓</span><h2>当前没有阻塞项</h2><p>系统未发现待审批、失败运行、证据定位缺口或待确认事实。</p></div>}</div>;
}
