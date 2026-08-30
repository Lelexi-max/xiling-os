import { useState, useRef, useEffect } from "react";
import type { ResearchProject } from "@xiling/contracts";
import { AgentExecutionGraphView } from "./AgentExecutionGraphView.js";
import { ArtifactViewer } from "../components/ArtifactViewer.js";
import type { ProjectResearchWorkflow } from "@xiling/domain-ocean";

type OutputTab = "graph" | "artifact" | "tools";

interface OutputPanelProps {
  project: ResearchProject;
  activeSessionId: string;
  workflows?: ProjectResearchWorkflow[];
}

export function OutputPanel({ project, activeSessionId, workflows }: OutputPanelProps) {
  const [activeTab, setActiveTab] = useState<OutputTab>("graph");
  const [panelVisible, setPanelVisible] = useState(true);
  const [artifactWidth, setArtifactWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = Number(localStorage.getItem("xiling:output-panel-width"));
    if (Number.isFinite(saved) && saved >= 280 && saved <= 700) setArtifactWidth(saved);
  }, []);

  const handleResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = panelRef.current?.offsetWidth ?? 400;
    const handleMove = (ev: MouseEvent) => {
      const diff = startX - ev.clientX;
      const newWidth = Math.max(280, Math.min(700, startWidth + diff));
      setArtifactWidth(newWidth);
      document.documentElement.style.setProperty("--lx-output-w", `${newWidth}px`);
    };
    const handleUp = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      localStorage.setItem("xiling:output-panel-width", String(artifactWidth));
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  if (!panelVisible) {
    return (
      <button
        className="output-panel-expand"
        onClick={() => setPanelVisible(true)}
        title="展开产出面板"
      >
        ▶ 产出
      </button>
    );
  }

  return (
    <>
      <aside
        ref={panelRef}
        className="output-panel"
        style={{ width: `${artifactWidth}px`, minWidth: `${artifactWidth}px`, maxWidth: `${artifactWidth}px` }}
      >
        <div className="output-panel-header">
          <button
            className={`panel-tab ${activeTab === "graph" ? "active" : ""}`}
            onClick={() => setActiveTab("graph")}
          >
            执行图
          </button>
          <button
            className={`panel-tab ${activeTab === "artifact" ? "active" : ""}`}
            onClick={() => setActiveTab("artifact")}
          >
            产物
          </button>
          <button
            className={`panel-tab ${activeTab === "tools" ? "active" : ""}`}
            onClick={() => setActiveTab("tools")}
          >
            工具调用
          </button>
          <button
            className="panel-toggle"
            onClick={() => setPanelVisible(false)}
            title="收起产出面板"
          >
            ◀ 收起
          </button>
        </div>

        <div
          className={`split-resizer ${isResizing ? "active" : ""}`}
          onPointerDown={handleResizeStart}
          role="separator"
          aria-label="调整产出面板宽度"
          aria-orientation="vertical"
          tabIndex={0}
        />

        <div className="output-panel-body">
          {activeTab === "graph" && (
            <ExecutionGraphTab projectId={project.id} activeSessionId={activeSessionId} />
          )}
          {activeTab === "artifact" && workflows && workflows.length > 0 && (
            <ArtifactTab project={project} workflows={workflows} />
          )}
          {activeTab === "artifact" && (!workflows || workflows.length === 0) && (
            <div className="output-panel-empty">
              <div className="empty-icon">📦</div>
              <p>暂无产物<br /><small>完成对话后在此查看</small></p>
            </div>
          )}
          {activeTab === "tools" && (
            <div className="output-panel-empty">
              <div className="empty-icon">⚡</div>
              <p>工具调用记录将在此显示<br /><small>Agent 执行时会实时更新</small></p>
            </div>
          )}
        </div>
      </aside>
      <button
        className="output-panel-expand"
        onClick={() => setPanelVisible(true)}
        title="展开产出面板"
      >
        ▶ 产出
      </button>
    </>
  );
}

function ExecutionGraphTab({
  projectId,
  activeSessionId,
}: {
  projectId: string;
  activeSessionId: string;
}) {
  if (!activeSessionId) {
    return (
      <div className="output-panel-empty">
        <div className="empty-icon">◈</div>
        <p>执行图将在对话启动后显示<br /><small>发送消息后自动加载</small></p>
      </div>
    );
  }
  return (
    <div className="execution-graph-container">
      <AgentExecutionGraphView projectId={projectId} activeSessionId={activeSessionId} />
    </div>
  );
}

function ArtifactTab({
  project,
  workflows,
}: {
  project: ResearchProject;
  workflows: ProjectResearchWorkflow[];
}) {
  return (
    <div className="artifact-container">
      <ArtifactViewer
        projectId={project.id}
        workflows={workflows}
        expanded={false}
        onToggleExpanded={() => {}}
        onClose={() => {}}
      />
    </div>
  );
}
