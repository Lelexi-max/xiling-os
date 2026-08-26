import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { WorkspaceProvider, useWorkspace } from "./workspace/WorkspaceContext.js";
import { ConversationProvider, useConversations } from "./workspace/ConversationContext.js";

const ChatView = lazy(async () => ({ default: (await import("./chat/ChatView.js")).ChatView }));
const ResearchView = lazy(async () => ({ default: (await import("./research/ResearchView.js")).ResearchView }));
const PaperGraphView = lazy(async () => ({ default: (await import("./papers/PaperGraphView.js")).PaperGraphView }));
const ProjectView = lazy(async () => ({ default: (await import("./project/ProjectView.js")).ProjectView }));
const WikiView = lazy(async () => ({ default: (await import("./wiki/WikiView.js")).WikiView }));
const SettingsView = lazy(async () => ({ default: (await import("./settings/SettingsView.js")).SettingsView }));
const ScientificCanvasView = lazy(async () => ({ default: (await import("./canvas/ScientificCanvasView.js")).ScientificCanvasView }));

type View = "chat" | "canvas" | "project" | "wiki" | "papers" | "settings";

const labels: Record<View, string> = {
  chat: "对话",
  canvas: "科研画布",
  project: "项目",
  wiki: "Wiki",
  papers: "文献图",
  settings: "设置",
};

const icons: Record<View, ReactNode> = {
  chat: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v4a2.5 2.5 0 0 1-2.5 2.5H9l-3.8 3v-3.3A2.5 2.5 0 0 1 4 9.5z" /></>,
  canvas: <><circle cx="5" cy="5" r="2"/><circle cx="15" cy="6" r="2"/><circle cx="10" cy="15" r="2"/><path d="m7 5.2 6 .6M6.2 6.7l2.7 6.5m4.8-5.5-2.6 5.5"/></>,
  project: <><path d="M3 6.5h14v10H3zM3 6.5l3-3h4l2 3" /></>,
  wiki: <><path d="M4 3.5h9a3 3 0 0 1 3 3v10H7a3 3 0 0 1-3-3zM7 6.5h6M7 10h6" /></>,
  papers: <><circle cx="6" cy="6" r="2.5" /><circle cx="14.5" cy="5" r="2.5" /><circle cx="11" cy="14.5" r="2.5" /><path d="m8.4 5.7 3.6-.4M7.2 8.2l2.7 4.1m3.1-5  -1.1 4.8" /></>,
  settings: <><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2m0 11v2m7.5-7.5h-2m-11 0h-2m12.8-5.3-1.4 1.4M6.1 13.9l-1.4 1.4m10.6 0-1.4-1.4M6.1 6.1 4.7 4.7" /></>,
};

export function App() {
  return <WorkspaceProvider><ConversationProvider><WorkspaceApp /></ConversationProvider></WorkspaceProvider>;
}

function WorkspaceApp() {
  const [view, setView] = useState<View>("chat");
  const settingsReturnView = useRef<Exclude<View, "settings">>("chat");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const { projects, activeProject, activeProjectId, setActiveProjectId, refreshProjects, loading, error } = useWorkspace();
  const { sessions, activeSessionId, loading: sessionsLoading, selectSession, startNewConversation } = useConversations();

  useEffect(() => {
    if (!projectMenuOpen) return;
    const close = (event: PointerEvent) => { if (!projectMenuRef.current?.contains(event.target as Node)) setProjectMenuOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [projectMenuOpen]);

  if (loading && !activeProject) return <main className="shell"><div className="view-loading">正在恢复科研工作区…</div></main>;
  if (!activeProject) return <main className="shell"><div className="view-loading">{error ?? "没有可用科研项目"}</div></main>;

  return (
    <main className={`shell ${view === "settings" ? "settings-mode" : ""}`}>
      {view !== "settings" ? <aside className="sidebar">
        <div className="brand"><span><img src="/brand/xiling-mark.png" alt="" /></span><div><b>汐灵</b><small>XILING OCEAN INTELLIGENCE</small></div></div>
        <div className="project-switcher" ref={projectMenuRef}>
          <button className="project-switcher-trigger" aria-expanded={projectMenuOpen} onClick={() => setProjectMenuOpen((open) => !open)}>
            <span><small>当前项目</small><b>{activeProject.name}</b><em>{activeProject.researchQuestion}</em></span><i>⌄</i>
          </button>
          {projectMenuOpen ? <div className="project-switcher-menu">
            <header><b>科研项目</b><small>{projects.length} 个进行中</small></header>
            <div>{projects.map((project) => <button className={project.id === activeProjectId ? "active" : ""} key={project.id} onClick={() => { setActiveProjectId(project.id); setProjectMenuOpen(false); }}><i>{project.id === activeProjectId ? "✓" : ""}</i><span><b>{project.name}</b><small>{project.researchQuestion}</small></span></button>)}</div>
            <footer><button onClick={() => { setView("project"); setProjectMenuOpen(false); }}>＋ 新建或管理项目</button></footer>
          </div> : null}
        </div>
        <button className="new-conversation" onClick={() => { startNewConversation(); setView("chat"); }}><span>＋</span> 新对话</button>
        <nav>
          {(Object.keys(labels) as View[]).filter((item) => item !== "settings").map((item) => (
            <button className={view === item ? "active" : ""} key={item} onClick={() => setView(item)}><svg viewBox="0 0 20 20" aria-hidden="true">{icons[item]}</svg>{labels[item]}</button>
          ))}
        </nav>
        <div className="recent-work"><header><small>对话历史</small>{sessions.length ? <span>{sessions.length}</span> : null}</header>{sessionsLoading ? <p>正在恢复…</p> : sessions.length ? sessions.map((session) => <button className={view === "chat" && session.id === activeSessionId ? "active" : ""} key={session.id} onClick={() => { selectSession(session.id); setView("chat"); }}><i>○</i><span><b>{session.title}</b><small>{formatSessionTime(session.updatedAt)} · {session.messageCount} 条</small></span></button>) : <p>这个项目还没有对话</p>}</div>
        <button className="settings-entry" onClick={() => { settingsReturnView.current = view; setView("settings"); }}><svg viewBox="0 0 20 20" aria-hidden="true">{icons.settings}</svg><span>设置</span></button>
      </aside> : null}
      <section className={`workspace workspace-${view}`}>
        <header>
          <div className="workspace-title"><button aria-label="返回" onClick={() => { if (view === "settings") setView(settingsReturnView.current); }}>‹</button><strong>{labels[view]}</strong><span>{activeProject.name}</span></div>
          {view === "settings" ? <div className="settings-top-status"><i />本地设置 · 凭据不会回传</div> : <div className="workspace-actions"><span className="save-state">✓ 已保存</span><button>分享</button><button className="more-button">•••</button></div>}
        </header>
        <Suspense fallback={<div className="view-loading">按需加载当前视图…</div>}>
          {view === "chat" ? <ChatView project={activeProject} /> : view === "canvas" ? <ScientificCanvasView projectId={activeProjectId} /> : view === "project" ? <ProjectView ResearchWorkflow={ResearchView} projectId={activeProjectId} projects={projects} onProjectChange={setActiveProjectId} onProjectsChange={refreshProjects} /> : view === "wiki" ? <WikiView projectId={activeProjectId} onNavigate={setView} /> : view === "papers" ? <PaperGraphView projectId={activeProjectId} onNavigate={setView} /> : view === "settings" ? <SettingsView /> : <Placeholder title={labels[view]} />}
        </Suspense>
      </section>
    </main>
  );
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function Placeholder({ title }: { title: string }) {
  return <div className="placeholder"><span>Gate 3 纵切</span><h1>{title}</h1><p>该视图将在后续里程碑接入完整领域服务。</p></div>;
}
