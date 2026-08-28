import { useCallback, useEffect, useState } from "react";
import type { ProjectResearchWorkflow } from "@xiling/domain-ocean";
import { ResearchWorkflowCard } from "../chat/ResearchWorkflowCard.js";

export function ProjectWorkflowDashboard({ projectId }: { projectId: string }) {
  const [workflows, setWorkflows] = useState<ProjectResearchWorkflow[]>([]);
  const [status, setStatus] = useState("正在读取项目科研闭环…");
  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/research-workflows?projectId=${encodeURIComponent(projectId)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const items = await response.json() as ProjectResearchWorkflow[];
    setWorkflows(items); setStatus(items.length ? `${items.length} 个真实科研 Workflow` : "当前项目还没有科研 Workflow");
  }, [projectId]);
  useEffect(() => { void load().catch((error) => setStatus(error instanceof Error ? error.message : String(error))); }, [load]);
  const replace = (workflow: ProjectResearchWorkflow) => setWorkflows((current) => current.map((item) => item.id === workflow.id ? workflow : item));
  return <div className="project-workflow-dashboard">
    <header><div><small>PROJECT RESEARCH LOOP</small><h1>科研运行与实验</h1><p>{status}</p></div><button onClick={() => void load()}>刷新</button></header>
    <section className="project-workflow-stats"><article><b>{workflows.length}</b><span>全部运行</span></article><article><b>{workflows.filter((item) => ["probing", "downloading", "analyzing"].includes(item.status)).length}</b><span>执行中</span></article><article><b>{workflows.filter((item) => item.status === "pending_approval").length}</b><span>待审批</span></article><article><b>{workflows.filter((item) => item.status === "completed").length}</b><span>已完成</span></article></section>
    {workflows.length ? <section className="project-workflow-list">{[...workflows].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map((workflow) => <ResearchWorkflowCard key={workflow.id} workflow={workflow} onChange={replace} />)}</section> : <section className="project-workflow-empty"><span>⌁</span><h2>从 Chat 发起第一个科研闭环</h2><p>描述数据源、变量、区域和时间。Agent 会先生成可审阅计划；只有你批准后才下载和计算。</p></section>}
  </div>;
}
