export interface SourceHistoryEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

export interface SourceBackedCanvasNode {
  id: string;
  body: string;
  sourceEntryId?: string;
}

export interface DurableSourceEntry {
  id: string;
  text: string;
}

export interface IncompleteCanvasSource {
  nodeId: string;
  sourceEntryId: string;
}

/**
 * Canvas text may replace a history entry only when it is a byte-for-byte copy
 * of the durable source. Preview nodes must never hide their full transcript.
 */
export function reconcileCanvasSourceCoverage(input: {
  history: SourceHistoryEntry[];
  nodes: SourceBackedCanvasNode[];
  getDurableEntry(id: string): DurableSourceEntry | undefined;
}): { history: SourceHistoryEntry[]; incompleteSources: IncompleteCanvasSource[] } {
  const fullyCovered = new Set<string>();
  const incompleteSources: IncompleteCanvasSource[] = [];

  for (const node of input.nodes) {
    if (!node.sourceEntryId) continue;
    const source = input.getDurableEntry(node.sourceEntryId);
    if (!source) continue;
    if (node.body === source.text) fullyCovered.add(source.id);
    else incompleteSources.push({ nodeId: node.id, sourceEntryId: source.id });
  }

  return {
    history: input.history.filter((entry) => !fullyCovered.has(entry.id)),
    incompleteSources,
  };
}
