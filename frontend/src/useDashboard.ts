import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { errorText, type DashboardState } from "./model";

export function useDashboard(paused: boolean) {
  const [data, setData] = useState<DashboardState>();
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const loaded = useRef(false);
  const refreshingRef = useRef(false);
  const version = useRef(0);

  const refresh = useCallback(async (scan = true) => {
    if (refreshingRef.current) return false;
    refreshingRef.current = true;
    setRefreshing(true);
    const requestVersion = version.current;
    try {
      const result = await (loaded.current && scan ? api.refresh() : api.load());
      if (version.current === requestVersion) {
        setData(result);
        setLoadError("");
      }
      loaded.current = true;
      return true;
    } catch (error) {
      if (version.current === requestVersion) setLoadError(errorText(error));
      return false;
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !document.querySelector("dialog[open]")) void refresh();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [paused, refresh]);

  const running = data?.outbox.some((run) => run.status === "running");
  useEffect(() => {
    if (!running || paused) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !document.querySelector("dialog[open]")) void refresh(false);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [running, paused, refresh]);

  async function apply(pending: Promise<DashboardState>) {
    const requestVersion = ++version.current;
    const result = await pending;
    if (version.current === requestVersion) {
      setData(result);
      setLoadError("");
    }
    return result;
  }

  return { data, refreshing, loadError, refresh, apply };
}
