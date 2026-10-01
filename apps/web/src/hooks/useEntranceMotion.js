import { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import useMotionPreference from "./useMotionPreference";

/* Explicit targets only: never animate alerts or every descendant/card. */
function useEntranceMotion({
  selector,
  enabled = true,
  activationKey = "initial",
  duration = 0.25,
  stagger = 0,
  offset = 8
}) {
  const scopeRef = useRef(null);
  const reducedMotion = useMotionPreference();

  useLayoutEffect(() => {
    if (!enabled || reducedMotion || !scopeRef.current) {
      return;
    }

    const scope = scopeRef.current;
    let context;

    try {
      context = gsap.context(() => {}, scope);
      context.add(() => {
        const targets = selector ? scope.querySelectorAll(selector) : [scope];
        if (!targets.length) {
          return;
        }

        gsap.fromTo(
          targets,
          { y: offset, opacity: 0.85 },
          {
            y: 0,
            opacity: 1,
            duration,
            stagger,
            ease: "power2.out",
            clearProps: "transform,opacity"
          }
        );
      });
    } catch {
      // Enhancement failure must never hide or disable the underlying UI.
      context?.revert();
    }

    return () => context?.revert();
  }, [selector, enabled, activationKey, duration, stagger, offset, reducedMotion]);

  return scopeRef;
}

export default useEntranceMotion;
