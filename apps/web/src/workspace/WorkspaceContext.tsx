import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Gate4Project } from "@xiling/contracts";

type WorkspaceState = {
  projects: Gate4Project[];
  activeProject?: Gate4Project;
  activeProjectId: string;
  setActiveProjectId: (id: string) => void;
  refreshProjects: (preferredId?: string) => Promise<void>;
  loading: boolean;
  error?: string;
};

const WorkspaceContext = createContext<WorkspaceState | undefined>(undefined);
const storageKey = "xiling.activeProjectId";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Gate4Project[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState(() => localStorage.getItem(storageKey) ?? "ocean-heatwave");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const setActiveProjectId = useCallback((id: string) => {
    setActiveProjectIdState(id);
    localStorage.setItem(storageKey, id);
  }, []);

  const refreshProjects = useCallback(async (preferredId?: string) => {
    setLoading(true);
    try {
      const response = await fetch("/api/gate4/projects");
      if (!response.ok) throw new Error(`项目加载失败：${response.status}`);
      const all = await response.json() as Gate4Project[];
      const visible = all.filter((project) => project.status !== "archived");
      setProjects(visible);
      const requested = preferredId ?? activeProjectId;
      const next = visible.find((project) => project.id === requested)?.id ?? visible[0]?.id ?? "";
      if (next && next !== activeProjectId) setActiveProjectId(next);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setLoading(false); }
  }, [activeProjectId, setActiveProjectId]);

  useEffect(() => { void refreshProjects(); }, []);
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const value = useMemo<WorkspaceState>(() => ({ projects, ...(activeProject ? { activeProject } : {}), activeProjectId, setActiveProjectId, refreshProjects, loading, ...(error ? { error } : {}) }), [projects, activeProject, activeProjectId, setActiveProjectId, refreshProjects, loading, error]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}
