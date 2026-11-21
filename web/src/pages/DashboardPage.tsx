import { TaskListPane } from "../components/tasks/TaskListPane";

/** Hauptaufgabenliste. Die GTD-Unterknöpfe und der Weekly Review leben auf der GTD-Seite. */
export function DashboardPage() {
  return <TaskListPane title="Aufgaben" />;
}
