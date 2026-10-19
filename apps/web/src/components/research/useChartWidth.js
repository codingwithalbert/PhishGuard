/*
 * Measures the width available to a chart plot so the SVG viewBox can be
 * generated at that width. This keeps one SVG user unit close to one CSS pixel
 * instead of scaling a fixed drawing (and its text) down on narrow screens.
 *
 * The measured element is the scroll container, not the SVG. Measuring the SVG
 * would feed its own scaled width back into the calculation.
 */
import { useEffect, useRef, useState } from "react";

export const MIN_CHART_WIDTH = 320;

export default function useChartWidth(minWidth = MIN_CHART_WIDTH) {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(null);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    function measure() {
      const nextWidth = Math.max(
        minWidth,
        Math.floor(container.getBoundingClientRect().width)
      );

      setWidth((current) => (current === nextWidth ? current : nextWidth));
    }

    measure();

    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(measure);
      observer.observe(container);

      return () => observer.disconnect();
    }

    window.addEventListener("resize", measure);

    return () => window.removeEventListener("resize", measure);
  }, [minWidth]);

  return [containerRef, width ?? minWidth];
}
