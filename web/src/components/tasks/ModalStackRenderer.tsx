import { useModalStack } from "./ModalStackProvider";
import { TaskCard } from "./TaskCard";

export function ModalStackRenderer() {
  const { stack, popTo, onRootUpdated } = useModalStack();

  if (stack.length === 0) return null;

  return (
    <>
      {stack.map((entry, idx) => {
        const offsetFromDeepest = stack.length - 1 - idx;
        return (
          <TaskCard
            key={`${entry.task.id}-${entry.depth}`}
            taskId={entry.task.id}
            open={true}
            onClose={() => popTo(entry.depth)}
            onUpdated={onRootUpdated}
            isStacked
            stackDepth={offsetFromDeepest}
            isActive={idx === stack.length - 1}
          />
        );
      })}
    </>
  );
}
