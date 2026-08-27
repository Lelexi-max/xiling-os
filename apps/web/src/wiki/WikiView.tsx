import { useEffect, useMemo, useRef, useState } from "react";
import { defaultValueCtx, Editor, editorViewOptionsCtx, rootCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import type {
  EvidenceRecord,
  Gate4Project,
  ProjectItem,
  ProjectResearchWorkflow,
  ResearchGraphProjection,
  ResourceUri,
  WikiPageDetail,
  WikiPageRevision,
  WikiPageSummary,
  WikiSearchResult,
} from "@xiling/contracts";
import "@milkdown/kit/prose/view/style/prosemirror.css";

type WikiDestination = "project" | "papers";
type WikiMode = "read" | "edit";
type Heading = { id: string; label: string; level: number };
type OverviewData = {
  project: Gate4Project | null;
  items: ProjectItem[];
  evidence: EvidenceRecord[];
  researchGraph: ResearchGraphProjection;
  workflows: ProjectResearchWorkflow[];
};

const emptyOverview: OverviewData = {
  project: null,
  items: [],
  evidence: [],
  researchGraph: { projectId: "", view: "all", nodes: [], relations: [], generatedAt: "" },
  workflows: [],
};

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json() as T;
  if (!response.ok) throw new Error(`请求失败：${response.status}`);
  return body;
}

export function WikiView({ projectId, onNavigate }: { projectId: string; onNavigate?: (view: WikiDestination) => void }) {
  const [pages, setPages] = useState<WikiPageSummary[]>([]);
  const [page, setPage] = useState<WikiPageDetail>();
  const [overview, setOverview] = useState<OverviewData>(emptyOverview);
  const [mode, setMode] = useState<WikiMode>("read");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewRevision, setPreviewRevision] = useState<WikiPageRevision>();
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<WikiSearchResult[]>([]);
  const [status, setStatus] = useState("已同步");
  const [error, setError] = useState("");

  const currentMarkdown = page ? stripLeadingTitle(page.currentRevision.markdown) : "";
  const headings = useMemo(() => page ? extractHeadings(currentMarkdown) : overviewHeadings, [currentMarkdown, page]);

  const loadPages = async () => {
    const next = await jsonRequest<WikiPageSummary[]>(`/api/gate4/wiki/pages?projectId=${encodeURIComponent(projectId)}`);
    setPages(next);
    return next;
  };

  const loadOverview = async () => {
    const encoded = encodeURIComponent(projectId);
    const snapshot = await jsonRequest<OverviewData>(`/api/projects/${encoded}/overview`);
    setOverview(snapshot);
  };

  const openOverview = () => {
    setPage(undefined);
    setMode("read");
    setHistoryOpen(false);
    setPreviewRevision(undefined);
    setError("");
  };

  const openPage = async (id: string) => {
    try {
      const detail = await jsonRequest<WikiPageDetail>(`/api/gate4/wiki/pages/${id}`);
      setPage(detail);
      setDraftTitle(detail.title);
      setDraftBody(stripLeadingTitle(detail.currentRevision.markdown));
      setMode("read");
      setHistoryOpen(false);
      setPreviewRevision(undefined);
      setQuery("");
      setSearchResults([]);
      setStatus("已同步");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  useEffect(() => {
    setPage(undefined);
    setMode("read");
    setPages([]);
    setOverview(emptyOverview);
    setError("");
    void Promise.all([loadPages(), loadOverview()]).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [projectId]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void jsonRequest<WikiSearchResult[]>(`/api/gate4/wiki/search?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(trimmed)}&limit=8`, { signal: controller.signal })
        .then(setSearchResults)
        .catch((cause) => { if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : String(cause)); });
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [projectId, query]);

  const save = async () => {
    if (!page || !draftTitle.trim()) return;
    setStatus("保存中…");
    try {
      const updated = await jsonRequest<WikiPageDetail>(`/api/gate4/wiki/pages/${page.id}/revisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: draftTitle.trim(), markdown: composeMarkdown(draftTitle, draftBody), artifactUris: page.currentRevision.artifactUris }),
      });
      setPage(updated);
      setDraftTitle(updated.title);
      setDraftBody(stripLeadingTitle(updated.currentRevision.markdown));
      setMode("read");
      await loadPages();
      setStatus(`已保存 v${updated.currentRevision.version}`);
      setError("");
    } catch (cause) {
      setStatus("保存失败");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const create = async () => {
    const title = newTitle.trim();
    if (!title) return;
    try {
      const created = await jsonRequest<WikiPageDetail>("/api/gate4/wiki/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, title, markdown: composeMarkdown(title, "从这里记录研究背景、方法、证据与阶段结论。") }),
      });
      setNewTitle("");
      setShowCreate(false);
      await loadPages();
      await openPage(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const restore = async (revision: WikiPageRevision) => {
    if (!page || revision.version === page.currentRevision.version) return;
    setStatus("恢复中…");
    try {
      const updated = await jsonRequest<WikiPageDetail>(`/api/gate4/wiki/pages/${page.id}/revisions/${revision.version}/restore`, { method: "POST" });
      setPage(updated);
      setDraftTitle(updated.title);
      setDraftBody(stripLeadingTitle(updated.currentRevision.markdown));
      setPreviewRevision(undefined);
      setHistoryOpen(false);
      await loadPages();
      setStatus(`已将 v${revision.version} 恢复为 v${updated.currentRevision.version}`);
    } catch (cause) {
      setStatus("恢复失败");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return <div className="knowledge-wiki">
    <aside className="wiki-library">
      <div className="wiki-library-title"><div><small>项目百科</small><b>{overview.project?.name ?? "研究知识库"}</b></div><button aria-label="新建 Wiki 页面" title="新建页面" onClick={() => setShowCreate((value) => !value)}>＋</button></div>
      {showCreate ? <div className="wiki-create"><input aria-label="Wiki 页面标题" autoFocus placeholder="新页面标题" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} /><button onClick={() => void create()}>创建</button></div> : null}
      <div className="wiki-search"><span>⌕</span><input aria-label="搜索项目百科" placeholder="搜索页面与正文" value={query} onChange={(event) => setQuery(event.target.value)} />{query && searchResults.length ? <div className="wiki-search-results">{searchResults.map((result) => <button key={result.pageId} onClick={() => void openPage(result.pageId)}><b>{result.title}</b><span>{result.excerpt || `版本 ${result.version}`}</span></button>)}</div> : null}</div>
      <nav aria-label="项目百科页面">
        <button className={!page ? "active" : ""} onClick={openOverview}><span className="wiki-page-glyph">⌂</span><span><b>项目总览</b><small>入口与研究地图</small></span></button>
        <div className="wiki-nav-label">条目 <span>{pages.length}</span></div>
        {pages.map((item) => <button className={page?.id === item.id ? "active" : ""} key={item.id} onClick={() => void openPage(item.id)}><span className="wiki-page-glyph">§</span><span><b>{item.title}</b><small>v{item.revisionCount} · {formatDate(item.updatedAt)}</small></span></button>)}
      </nav>
      <div className="wiki-toc"><small>本页目录</small>{headings.map((heading) => <a className={`level-${heading.level}`} href={`#${heading.id}`} key={heading.id}>{heading.label}</a>)}</div>
    </aside>

    <main className="wiki-main">
      {error ? <div className="wiki-error" role="alert">{error}<button onClick={() => setError("")}>关闭</button></div> : null}
      {!page ? <ProjectOverview data={overview} pages={pages} onOpenPage={openPage} onNavigate={onNavigate} /> : <article className="wiki-article">
        <header className="wiki-article-head"><div><span>项目百科　/　{page.slug}</span>{mode === "edit" ? <input aria-label="Wiki 标题" value={draftTitle} onChange={(event) => { setDraftTitle(event.target.value); setStatus("有未保存修改"); }} /> : <h1>{page.title}</h1>}<p>版本化研究知识 · 可追溯证据与产物</p></div><div className="wiki-article-actions"><small>{status}</small>{mode === "edit" ? <><button className="quiet" onClick={() => { setDraftTitle(page.title); setDraftBody(currentMarkdown); setMode("read"); setStatus("已取消修改"); }}>取消</button><button className="primary" onClick={() => void save()}>保存新版本</button></> : <><button onClick={() => { setPreviewRevision(page.currentRevision); setHistoryOpen(true); }}>历史 <span>{page.revisionCount}</span></button><button className="primary" onClick={() => setMode("edit")}>编辑条目</button></>}</div></header>
        <section className="wiki-article-body">
          <PageInfobox page={page} />
          {mode === "edit" ? <div className="wiki-edit-note">编辑会生成一个不可变的新版本。使用 <code>[[页面-slug]]</code> 建立百科内链。</div> : null}
          <MilkdownDocument key={`${page.id}-${page.currentRevision.id}-${mode}`} markdown={mode === "edit" ? draftBody : prepareReadMarkdown(currentMarkdown, pages)} editable={mode === "edit"} onChange={(value) => { setDraftBody(value); setStatus("有未保存修改"); }} onOpenWikiLink={(slug) => { const target = pages.find((item) => item.slug === slug); if (target) void openPage(target.id); }} />
          <ArtifactSection uris={page.currentRevision.artifactUris} />
          <section className="wiki-related" id="related"><h2>关联与来源</h2><div><article><small>反向链接</small>{page.backlinks.length ? page.backlinks.map((backlink) => <button key={backlink.id} onClick={() => void openPage(backlink.id)}>↗ {backlink.title}</button>) : <p>暂时没有其他条目引用本页。</p>}</article><article><small>条目身份</small><p><code>[[{page.slug}]]</code></p><p>最后更新于 {formatDateTime(page.updatedAt)}</p></article></div></section>
        </section>
        {historyOpen ? <HistoryPanel page={page} preview={previewRevision ?? page.currentRevision} onPreview={setPreviewRevision} onRestore={restore} onClose={() => { setHistoryOpen(false); setPreviewRevision(undefined); }} /> : null}
      </article>}
    </main>
  </div>;
}

function ProjectOverview({ data, pages, onOpenPage, onNavigate }: { data: OverviewData; pages: WikiPageSummary[]; onOpenPage: (id: string) => Promise<void>; onNavigate: ((view: WikiDestination) => void) | undefined }) {
  const completedItems = data.items.filter((item) => item.status === "done").length;
  const artifactUris = data.workflows.flatMap((workflow) => [workflow.datasetArtifact?.uri, ...(workflow.run?.artifactUris ?? [])]).filter((uri): uri is ResourceUri => Boolean(uri));
  return <article className="wiki-article wiki-overview">
    <header className="wiki-article-head overview-head"><div><span>项目百科　/　总览</span><h1>{data.project?.name ?? "研究项目"}</h1><p>{data.project?.researchQuestion ?? "正在加载项目研究问题…"}</p></div><button className="primary" onClick={() => onNavigate?.("project")}>打开项目管理</button></header>
    <section className="wiki-article-body">
      <aside className="wiki-infobox project-infobox" aria-label="项目概览信息框"><strong>{data.project?.name ?? "研究项目"}</strong><p>{data.project?.description || "围绕核心问题组织证据、数据、运行与结论。"}</p><dl><div><dt>状态</dt><dd>{projectStatusLabel(data.project?.status)}</dd></div><div><dt>百科条目</dt><dd>{pages.length}</dd></div><div><dt>证据文献</dt><dd>{data.evidence.length}</dd></div><div><dt>科研对象</dt><dd>{data.researchGraph.nodes.length}</dd></div><div><dt>科研运行</dt><dd>{data.workflows.length}</dd></div><div><dt>已归档产物</dt><dd>{artifactUris.length}</dd></div></dl></aside>
      <section id="overview" className="wiki-lead"><p>这是项目的知识入口。它把分散在对话、画布、文献图、科研运行和文件中的结果，组织成可浏览、可追溯、可持续更新的项目百科。</p></section>
      <section id="contents"><div className="wiki-section-title"><div><small>KNOWLEDGE MAP</small><h2>从哪里开始</h2></div><span>{pages.length} 个正式条目</span></div>{pages.length ? <div className="wiki-page-grid">{pages.map((item) => <button key={item.id} onClick={() => void onOpenPage(item.id)}><span>§</span><div><h3>{item.title}</h3><p>版本 {item.revisionCount} · 更新于 {formatDate(item.updatedAt)}</p></div><i>→</i></button>)}</div> : <p className="wiki-empty">尚未创建百科条目。使用左栏的“＋”建立第一个页面。</p>}</section>
      <section id="evidence"><div className="wiki-section-title"><div><small>EVIDENCE</small><h2>证据与文献</h2></div><button onClick={() => onNavigate?.("papers")}>进入文献图 →</button></div>{data.evidence.length ? <div className="wiki-evidence-list">{data.evidence.slice(0, 5).map((record) => <article key={record.id}><span>{record.paper.year}</span><div><h3>{record.paper.title}</h3><p>{record.paper.authors.slice(0, 3).join(" · ")} · {record.paper.citationCount} 次引用</p></div></article>)}</div> : <p className="wiki-empty">保存到证据库的论文会在这里形成可浏览的文献入口。</p>}</section>
      <section id="runs"><div className="wiki-section-title"><div><small>REPRODUCIBILITY</small><h2>运行与产物</h2></div><span>{data.workflows.length} 次工作流</span></div>{artifactUris.length ? <ArtifactSection uris={artifactUris.slice(0, 8)} projectId={data.project?.id} compact /> : <p className="wiki-empty">完成数据切片和计算后，数据快照、图表与 Reviewer 报告会显示在这里。</p>}</section>
      <section id="progress"><div className="wiki-section-title"><div><small>PROJECT STATE</small><h2>研究进展</h2></div><button onClick={() => onNavigate?.("project")}>查看全部任务 →</button></div><div className="wiki-progress"><strong>{completedItems}<small> / {data.items.length} 项已完成</small></strong><div><i style={{ width: `${data.items.length ? Math.round(completedItems / data.items.length * 100) : 0}%` }} /></div>{data.items.slice(0, 5).map((item) => <p key={item.id}><span className={item.status === "done" ? "done" : ""}>{item.status === "done" ? "✓" : "○"}</span>{item.title}<small>{itemKindLabel(item.kind)}</small></p>)}</div></section>
    </section>
  </article>;
}

function PageInfobox({ page }: { page: WikiPageDetail }) {
  return <aside className="wiki-infobox" aria-label="条目信息框"><strong>{page.title}</strong><dl><div><dt>当前版本</dt><dd>v{page.currentRevision.version}</dd></div><div><dt>历史版本</dt><dd>{page.revisionCount}</dd></div><div><dt>关联产物</dt><dd>{page.currentRevision.artifactUris.length}</dd></div><div><dt>反向链接</dt><dd>{page.backlinks.length}</dd></div><div><dt>最近更新</dt><dd>{formatDate(page.updatedAt)}</dd></div></dl></aside>;
}

function HistoryPanel({ page, preview, onPreview, onRestore, onClose }: { page: WikiPageDetail; preview: WikiPageRevision; onPreview: (revision: WikiPageRevision) => void; onRestore: (revision: WikiPageRevision) => Promise<void>; onClose: () => void }) {
  return <aside className="wiki-history-panel" aria-label="版本历史"><header><div><small>版本历史</small><h2>{page.title}</h2></div><button aria-label="关闭版本历史" onClick={onClose}>×</button></header><div className="wiki-history-content"><nav>{page.revisions.map((revision) => <button className={preview.id === revision.id ? "active" : ""} key={revision.id} onClick={() => onPreview(revision)}><b>v{revision.version}{revision.id === page.currentRevision.id ? " · 当前" : ""}</b><small>{formatDateTime(revision.createdAt)}</small></button>)}</nav><section><header><div><b>版本 {preview.version}</b><small>{formatDateTime(preview.createdAt)}</small></div>{preview.id !== page.currentRevision.id ? <button onClick={() => void onRestore(preview)}>恢复为新版本</button> : null}</header><div className="wiki-revision-preview">{stripLeadingTitle(preview.markdown).split("\n").map((line, index) => <p key={`${index}-${line.slice(0, 8)}`}>{line || " "}</p>)}</div></section></div></aside>;
}

function ArtifactSection({ uris, projectId, compact = false }: { uris: ResourceUri[]; projectId?: string | undefined; compact?: boolean }) {
  if (!uris.length) return null;
  return <section className={`wiki-artifacts ${compact ? "compact" : ""}`} id="artifacts"><div className="wiki-section-title"><div><small>ARTIFACTS</small><h2>关联产物</h2></div><span>{uris.length} 项</span></div><div className="wiki-artifact-grid">{uris.map((uri) => { const href = artifactHttpUrl(uri, projectId); return <article key={uri}><span>{artifactKind(uri)}</span><div><h3>{artifactLabel(uri)}</h3><p title={uri}>{uri}</p></div>{href ? <a href={href} target="_blank" rel="noreferrer">打开 ↗</a> : <button disabled title="该资源需要在对应工具中打开">受管资源</button>}</article>; })}</div></section>;
}

function MilkdownDocument({ markdown, editable, onChange, onOpenWikiLink }: { markdown: string; editable: boolean; onChange: (markdown: string) => void; onOpenWikiLink: (slug: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onOpenWikiLinkRef = useRef(onOpenWikiLink);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onOpenWikiLinkRef.current = onOpenWikiLink; }, [onOpenWikiLink]);
  useEffect(() => {
    if (!root.current) return;
    let cancelled = false;
    const editor = Editor.make().config((ctx) => {
      ctx.set(rootCtx, root.current);
      ctx.set(defaultValueCtx, markdown);
      ctx.set(editorViewOptionsCtx, editable ? { attributes: { "aria-label": "Wiki 正文编辑器" } } : { editable: () => false, attributes: { "aria-label": "Wiki 正文" } });
      ctx.get(listenerCtx).markdownUpdated((_ctx, value, previous) => { if (editable && value !== previous) onChangeRef.current(value); });
    }).use(commonmark).use(history).use(listener);
    void editor.create().then(() => {
      if (cancelled || !root.current) return;
      root.current.querySelectorAll("h1, h2, h3").forEach((heading, index) => { heading.id = `wiki-section-${index}`; });
    });
    const handleClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#wiki/"]');
      if (!anchor) return;
      event.preventDefault();
      onOpenWikiLinkRef.current(decodeURIComponent(anchor.hash.slice("#wiki/".length)));
    };
    root.current.addEventListener("click", handleClick);
    return () => { cancelled = true; root.current?.removeEventListener("click", handleClick); void editor.destroy(); };
  }, [editable, markdown]);
  return <div className={`wiki-milkdown ${editable ? "is-editing" : "is-reading"}`} ref={root} />;
}

const overviewHeadings: Heading[] = [
  { id: "overview", label: "项目概述", level: 2 },
  { id: "contents", label: "知识地图", level: 2 },
  { id: "evidence", label: "证据与文献", level: 2 },
  { id: "runs", label: "运行与产物", level: 2 },
  { id: "progress", label: "研究进展", level: 2 },
];

function extractHeadings(markdown: string): Heading[] {
  const headings: Heading[] = [];
  for (const match of markdown.matchAll(/^(#{1,3})\s+(.+)$/gm)) headings.push({ id: `wiki-section-${headings.length}`, label: match[2]!.replace(/[\[\]*_`]/g, "").trim(), level: match[1]!.length });
  headings.push({ id: "artifacts", label: "关联产物", level: 2 }, { id: "related", label: "关联与来源", level: 2 });
  return headings;
}

function stripLeadingTitle(markdown: string): string { return markdown.replace(/^\s*#\s+[^\n]+\n+/, "").trim(); }
function composeMarkdown(title: string, body: string): string { return `# ${title.trim()}\n\n${body.trim()}\n`; }
function hydrateWikiLinks(markdown: string, pages: WikiPageSummary[]): string {
  return markdown.replace(/\[\[([a-z0-9-]+)\]\]/gi, (_full, slug: string) => { const page = pages.find((item) => item.slug === slug); return page ? `[${page.title}](#wiki/${encodeURIComponent(slug)})` : `[[${slug}]]`; });
}
function prepareReadMarkdown(markdown: string, pages: WikiPageSummary[]): string {
  const withoutDuplicatedArtifacts = markdown.replace(/\s*Artifact[：:]\s*artifact:\/\/\S+/g, "").trim();
  return hydrateWikiLinks(withoutDuplicatedArtifacts, pages);
}
function artifactHttpUrl(uri: string, projectId?: string): string | undefined {
  const connectorFixture = /^artifact:\/\/connector-fixture\/([a-f0-9]{64})$/.exec(uri);
  if (connectorFixture) return `/api/gate4/connector-artifacts/${connectorFixture[1]}`;
  const connectorRun = /^artifact:\/\/connector\/([0-9a-f-]{36})\/(.+)$/.exec(uri);
  if (connectorRun) return `/api/gate4/connector-run-artifacts/${encodeURIComponent(connectorRun[1]!)}/${connectorRun[2]!.split("/").map(encodeURIComponent).join("/")}`;
  const workflow = /^artifact:\/\/workflow\/(workflow-[0-9a-f-]{36})\/(.+)$/.exec(uri);
  if (workflow && projectId) return `/api/gate4/workflow-artifacts/${encodeURIComponent(workflow[1]!)}/${workflow[2]!.split("/").map(encodeURIComponent).join("/")}?projectId=${encodeURIComponent(projectId)}`;
  return undefined;
}
function artifactLabel(uri: string): string { const tail = uri.split("/").at(-1) ?? uri; try { return decodeURIComponent(tail); } catch { return tail; } }
function artifactKind(uri: string): string { const extension = artifactLabel(uri).split(".").at(-1)?.toUpperCase(); return extension && extension.length <= 6 ? extension : "FILE"; }
function projectStatusLabel(status: Gate4Project["status"] | undefined): string { return status === "active" ? "进行中" : status === "paused" ? "已暂停" : status === "archived" ? "已归档" : "加载中"; }
function itemKindLabel(kind: ProjectItem["kind"]): string { return kind === "milestone" ? "里程碑" : kind === "experiment" ? "实验" : "任务"; }
function formatDate(value: string): string { return new Date(value).toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" }); }
function formatDateTime(value: string): string { return new Date(value).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }); }
