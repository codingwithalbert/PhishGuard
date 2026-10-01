import { useEffect, useRef } from "react";
import useMotionPreference from "../hooks/useMotionPreference";

// Shared geometry keeps the static and WebGL compositions equally substantial.
const shieldOutline = [
  [0, 1.9], [1.55, 1.25], [1.55, 0.05], [1.1, -0.95],
  [0, -1.9], [-1.1, -0.95], [-1.55, 0.05], [-1.55, 1.25]
];
const nodePositions = [
  [-0.8, 0.65, 0.22], [0.8, 0.65, 0.22], [0, -0.85, 0.22],
  [-2.4, 1.55, -0.2], [0, 2.65, -0.25], [2.4, 1.55, -0.2],
  [2.6, -0.65, 0], [1.3, -2.4, -0.2], [-1.3, -2.4, -0.2],
  [-2.6, -0.65, 0]
];
const connections = [
  [0, 1], [1, 2], [2, 0], [3, 0], [4, 0], [4, 1],
  [5, 1], [6, 1], [7, 2], [8, 2], [9, 0], [3, 4],
  [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 3]
];

/* Decorative auth-only enhancement. No Three.js code loads until eligible. */
function CyberScene() {
  const hostRef = useRef(null);
  const reducedMotion = useMotionPreference();

  useEffect(() => {
    const host = hostRef.current;
    if (!host || reducedMotion) {
      return;
    }

    const desktop = window.matchMedia("(min-width: 1024px)");
    let inView = false;
    let stopped = false;
    let session = null;
    let failed = false;

    const canRender = () => desktop.matches && inView && !document.hidden;

    function createSession() {
      let disposed = false;
      let renderer;
      let resizeObserver;
      let frame = 0;
      let lastTime = null;
      let elapsed = 0;
      let renderScene;
      let resume;
      const resources = new Set();

      function dispose() {
        if (disposed) {
          return;
        }
        disposed = true;
        cancelAnimationFrame(frame);
        resizeObserver?.disconnect();
        delete host.dataset.ready;
        for (const resource of resources) {
          resource.dispose();
        }
        if (renderer) {
          renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
          renderer.dispose();
          renderer.forceContextLoss();
          renderer.domElement.remove();
        }
      }

      function onContextLost(event) {
        event.preventDefault();
        failed = true;
        dispose();
      }

      function update() {
        if (disposed) {
          return;
        }
        if (!canRender()) {
          cancelAnimationFrame(frame);
          frame = 0;
          lastTime = null;
        } else {
          resume?.();
        }
      }

      async function initialize() {
        try {
          const THREE = await import("three");
          if (disposed || stopped || !desktop.matches) {
            return;
          }

          const tokens = getComputedStyle(host);
          const accent = tokens.getPropertyValue("--color-accent").trim();
          const muted = tokens.getPropertyValue("--color-border-strong").trim();
          const surface = tokens.getPropertyValue("--color-surface").trim();
          renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
          renderer.domElement.className = "cyber-scene-canvas";
          renderer.domElement.setAttribute("aria-hidden", "true");
          renderer.domElement.setAttribute("tabindex", "-1");
          renderer.domElement.addEventListener("webglcontextlost", onContextLost);
          host.appendChild(renderer.domElement);

          const scene = new THREE.Scene();
          const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 30);
          camera.position.z = 9;
          const group = new THREE.Group();
          scene.add(group);

          function track(resource) {
            resources.add(resource);
            return resource;
          }

          const shape = new THREE.Shape();
          shieldOutline.forEach(([x, y], index) => {
            if (index === 0) shape.moveTo(x, y);
            else shape.lineTo(x, y);
          });
          shape.closePath();
          const shieldGeometry = track(new THREE.ExtrudeGeometry(shape, {
            depth: 0.12, bevelEnabled: false, steps: 1, curveSegments: 1
          }));
          group.add(new THREE.Mesh(shieldGeometry, track(new THREE.MeshBasicMaterial({
            color: surface, transparent: true, opacity: 0.75
          }))));
          group.add(new THREE.LineSegments(
            track(new THREE.EdgesGeometry(shieldGeometry)),
            track(new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.7 }))
          ));

          // Ten fixed nodes: three within the shield and seven around it.
          const nodeGeometry = track(new THREE.SphereGeometry(0.065, 8, 6));
          const nodeMaterial = track(new THREE.MeshBasicMaterial({ color: accent }));
          nodePositions.forEach((position) => {
            const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
            node.position.set(...position);
            group.add(node);
          });
          const points = connections.flatMap(([a, b]) => [
            new THREE.Vector3(...nodePositions[a]), new THREE.Vector3(...nodePositions[b])
          ]);
          group.add(new THREE.LineSegments(
            track(new THREE.BufferGeometry().setFromPoints(points)),
            track(new THREE.LineBasicMaterial({ color: muted }))
          ));

          renderScene = () => {
            if (!disposed && canRender()) {
              renderer.render(scene, camera);
              host.dataset.ready = "true";
            }
          };

          function tick(time) {
            frame = 0;
            if (disposed || !canRender()) {
              lastTime = null;
              return;
            }
            if (lastTime === null) lastTime = time;
            const delta = time - lastTime;
            // At most 30 renders per second; hidden time never advances motion.
            if (delta >= 1000 / 30) {
              elapsed = Math.min(700, elapsed + Math.min(delta, 50));
              lastTime = time;
              const remaining = Math.pow(1 - elapsed / 700, 3);
              group.rotation.y = -0.12 - 0.18 * remaining;
              group.rotation.x = 0.04 + 0.08 * remaining;
              renderScene();
            }
            if (elapsed < 700) frame = requestAnimationFrame(tick);
          }

          resume = () => {
            if (frame || disposed || !canRender()) return;
            if (elapsed < 700) frame = requestAnimationFrame(tick);
            else renderScene();
          };

          function resize() {
            if (disposed) return;
            const { width, height } = host.getBoundingClientRect();
            if (!width || !height) return;
            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            if (elapsed >= 700) renderScene();
          }
          resizeObserver = new ResizeObserver(resize);
          resizeObserver.observe(host);
          resize();
          update();
        } catch {
          failed = true;
          dispose();
        }
      }

      initialize();
      return { dispose, update };
    }

    function reconcile() {
      if (stopped) return;
      if (!desktop.matches) {
        session?.dispose();
        session = null;
      } else if (!session && !failed && canRender()) {
        session = createSession();
      } else {
        session?.update();
      }
    }

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      reconcile();
    });
    intersectionObserver.observe(host);
    desktop.addEventListener("change", reconcile);
    document.addEventListener("visibilitychange", reconcile);

    return () => {
      stopped = true;
      session?.dispose();
      intersectionObserver.disconnect();
      desktop.removeEventListener("change", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, [reducedMotion]);

  return (
    <div className="cyber-scene" ref={hostRef} aria-hidden="true">
      <svg
        className="cyber-scene-fallback"
        viewBox="-2.85 -2.85 5.7 5.7"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <g transform="scale(1 -1)">
          <polygon
            points={shieldOutline.map(([x, y]) => `${x},${y}`).join(" ")}
            fill="var(--color-surface)"
            fillOpacity="0.75"
            stroke="currentColor"
            strokeOpacity="0.7"
            strokeWidth="0.018"
            strokeLinejoin="round"
          />
          <g stroke="var(--color-border-strong)" strokeWidth="0.012">
            {connections.map(([a, b]) => (
              <line
                key={`${a}-${b}`}
                x1={nodePositions[a][0]}
                y1={nodePositions[a][1]}
                x2={nodePositions[b][0]}
                y2={nodePositions[b][1]}
              />
            ))}
          </g>
          <g fill="currentColor">
            {nodePositions.map(([x, y], index) => (
              <circle key={index} cx={x} cy={y} r="0.065" />
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}

export default CyberScene;
