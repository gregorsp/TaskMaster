import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Box, type SxProps, type Theme } from "@mui/material";

interface MarkdownProps {
  children: string;
  color?: string;
  onToggleTask?: (next: string) => void;
  sx?: SxProps<Theme>;
}

const markdownStyles = {
  fontSize: "0.875rem",
  lineHeight: 1.43,
  "& p": { my: 1 },
  "& ul, & ol": { pl: 2.5, my: 1 },
  "& li": { my: 0.25 },
  "& li.task-list-item": { listStyle: "none", ml: 0 },
  "& ul.contains-task-list": { pl: 0.25 },
  "& h1, & h2, & h3, & h4, & h5, & h6": { fontWeight: 600, fontSize: "inherit", my: 1 },
  "& code": { fontFamily: "monospace", bgcolor: "rgba(127,127,127,0.15)", px: 0.5, borderRadius: 0.5, fontSize: "0.85em" },
  "& pre": { bgcolor: "rgba(127,127,127,0.15)", p: 1.5, borderRadius: 1, overflowX: "auto", my: 1, "& code": { bgcolor: "transparent", p: 0 } },
  "& a": { color: "primary.main" },
  "& blockquote": { borderLeft: "3px solid", borderColor: "divider", pl: 1.5, my: 1 },
  "& hr": { my: 1.5, borderColor: "divider" },
  "& img": { maxWidth: "100%" },
  "& table": { borderCollapse: "collapse", my: 1, "& th, & td": { border: "1px solid", borderColor: "divider", px: 1, py: 0.5 } },
  "& input[type='checkbox']": { accentColor: "primary.main", cursor: "pointer", mr: 0.75 },
} satisfies SxProps<Theme>;

function toClass(className: string | string[] | undefined): string | undefined {
  if (Array.isArray(className)) return className.join(" ");
  return className;
}

function toggleTaskLine(text: string, line: number): string {
  const lines = text.split("\n");
  const index = line - 1;
  if (index < 0 || index >= lines.length) return text;
  const current = lines[index];
  const match = current.match(/^(\s*[-*+]\s+)\[([ xX])\]/);
  if (!match) return text;
  const next = match[2].toLowerCase() === "x" ? " " : "x";
  lines[index] = `${match[1]}[${next}]${current.slice(match[0].length)}`;
  return lines.join("\n");
}

export function Markdown({ children, color = "text.secondary", onToggleTask, sx }: MarkdownProps) {
  const components = useMemo<Components>(() => {
    if (!onToggleTask) return {};
    return {
      li(props) {
        const { node, className, ...rest } = props;
        const isTaskItem = String(className ?? "").split(" ").includes("task-list-item");
        if (!isTaskItem || !node?.position) {
          return <li className={toClass(className)} onClick={(e) => e.stopPropagation()} {...rest} />;
        }
        const line = node.position.start.line;
        return (
          <li
            className={toClass(className)}
            style={{ cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              const next = toggleTaskLine(children, line);
              if (next !== children) onToggleTask(next);
            }}
          >
            {rest.children}
          </li>
        );
      },
      input(props) {
        const { node: _node, disabled: _disabled, ...rest } = props;
        if (rest.type === "checkbox") {
          return <input {...rest} readOnly />;
        }
        return <input {...rest} />;
      },
    };
  }, [onToggleTask, children]);

  return (
    <Box sx={[{ color }, markdownStyles, ...(Array.isArray(sx) ? sx : [sx])]}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </Box>
  );
}
