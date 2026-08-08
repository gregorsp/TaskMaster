import { Avatar, Stack, Tooltip } from "@mui/material";
import type { TaskAssignee } from "../../api/tasksApi";

export function hashColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 50%, 40%)`;
}

interface Props {
  assignees: TaskAssignee[];
  size?: number;
  max?: number;
}

export function AssigneeAvatars({ assignees, size = 22, max = 4 }: Props) {
  if (!assignees.length) return null;
  const shown = assignees.slice(0, max);
  const extra = assignees.length - shown.length;
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
      {shown.map((a) => (
        <Tooltip key={a.id} title={a.displayName}>
          <Avatar
            src={a.profilePicture ?? undefined}
            sx={{ width: size, height: size, fontSize: size * 0.5, bgcolor: hashColor(a.id) }}
          >
            {a.displayName?.charAt(0)?.toUpperCase()}
          </Avatar>
        </Tooltip>
      ))}
      {extra > 0 && (
        <Tooltip title={assignees.slice(max).map((a) => a.displayName).join(", ")}>
          <Avatar
            sx={{ width: size, height: size, fontSize: size * 0.5, bgcolor: "action.disabledBackground", color: "text.secondary" }}
          >
            +{extra}
          </Avatar>
        </Tooltip>
      )}
    </Stack>
  );
}
