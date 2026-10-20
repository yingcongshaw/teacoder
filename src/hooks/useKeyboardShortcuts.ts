import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";

export default function useKeyboardShortcuts() {
  const closeTab = useAppStore((s) => s.closeTab);
  const openTabIds = useAppStore((s) => s.openTabIds);
  const sessions = useAppStore((s) => s.sessions);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setModalOpen = useAppStore((s) => s.setNewSessionModalOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);

  const openTabIdsRef = useRef(openTabIds);
  openTabIdsRef.current = openTabIds;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === "t") {
        e.preventDefault();
        setModalOpen(true);
        return;
      }

      if (ctrl && e.key === "w") {
        e.preventDefault();
        const tabId = activeTabIdRef.current;
        if (!tabId) return;
        closeTab(tabId);
        return;
      }

      if (ctrl && e.key === "Tab") {
        e.preventDefault();
        const currentIds = openTabIdsRef.current;
        if (currentIds.length === 0) return;
        const currentIdx = currentIds.indexOf(activeTabIdRef.current || "");
        const dir = e.shiftKey ? -1 : 1;
        const nextIdx =
          (currentIdx + dir + currentIds.length) % currentIds.length;
        setActiveTab(currentIds[nextIdx]);
        return;
      }

      if (ctrl && e.key === "p") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeTab, setActiveTab, setModalOpen, setSearchOpen]);
}
