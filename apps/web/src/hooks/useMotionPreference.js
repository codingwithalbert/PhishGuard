import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";

function subscribe(callback) {
  const media = window.matchMedia(query);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(query).matches;
}

/* A stable/static experience is the conservative server-rendering default. */
function useMotionPreference() {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}

export default useMotionPreference;
