import { Fragment, type ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const pattern = /(https?:\/\/[^\s)]+|`[^`]+`|\*\*[^*]+\*\*|\$[^$]+\$)/g;
  return text.split(pattern).filter(Boolean).map((part, index) => {
    if (/^https?:\/\//.test(part)) return <a key={index} href={part} target="_blank" rel="noreferrer">{part}</a>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("$") && part.endsWith("$")) return <span className="scientific-inline-math" key={index}>{part.slice(1, -1)}</span>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export function ScientificMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let code: string[] | undefined;
  let paragraph: string[] = [];
  let list: string[] = [];
  const flushParagraph = () => { if (paragraph.length) { blocks.push(<p key={`p-${blocks.length}`}>{inline(paragraph.join(" "))}</p>); paragraph = []; } };
  const flushList = () => { if (list.length) { blocks.push(<ul key={`ul-${blocks.length}`}>{list.map((item, index) => <li key={index}>{inline(item)}</li>)}</ul>); list = []; } };
  for (const line of lines) {
    if (line.startsWith("```")) {
      flushParagraph(); flushList();
      if (code) { blocks.push(<pre key={`code-${blocks.length}`}><code>{code.join("\n")}</code></pre>); code = undefined; } else code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) { flushParagraph(); flushList(); const level = Math.min(heading[1]!.length + 1, 5); const Tag = `h${level}` as "h2"; blocks.push(<Tag key={`h-${blocks.length}`}>{inline(heading[2]!)}</Tag>); continue; }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) { flushParagraph(); list.push(bullet[1]!); continue; }
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    paragraph.push(line.trim());
  }
  if (code) blocks.push(<pre key={`code-${blocks.length}`}><code>{code.join("\n")}</code></pre>);
  flushParagraph(); flushList();
  return <div className="scientific-markdown">{blocks}</div>;
}
