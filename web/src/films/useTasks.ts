import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { TaskView } from "../api/types";
import { onStudioEvent } from "../app/useStudio";

const byNewest = (a: TaskView, b: TaskView) => b.startedAt.localeCompare(a.startedAt);

/** `t` in place of its old copy, newest first. */
export function mergeTask(list: TaskView[], t: TaskView): TaskView[] {
  return [t, ...list.filter((x) => x.id !== t.id)].sort(byNewest);
}

/**
 * The film's finishing tasks, kept live by SSE task events and reloaded when
 * the stream reconnects. `onSettled` hears each task that ends while watched,
 * so the film page can list its new outputs.
 */
export function useTasks(run: string, onSettled: (t: TaskView) => void = () => {}): TaskView[] {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const settled = useRef(onSettled);
  settled.current = onSettled;

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<TaskView[]>(`/api/tasks?run=${encodeURIComponent(run)}`)
        .then((list) => alive && setTasks(list))
        .catch(() => {});
    setTasks([]);
    load();
    const stop = onStudioEvent((e) => {
      if (e.event === "hello") load();
      if (e.event !== "task" || e.data.run !== run) return;
      setTasks((prev) => mergeTask(prev, e.data));
      if (e.data.state !== "running") settled.current(e.data);
    });
    return () => {
      alive = false;
      stop();
    };
  }, [run]);

  return tasks;
}
