import {
  createContext,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";

interface FloatingWindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FloatingWindowManagerValue {
  bringToFront: (windowId: string) => void;
  zIndexFor: (windowId: string) => number;
}

interface FloatingWindowProviderProps {
  children: ReactNode;
}

interface FloatingWindowProps {
  windowId: string;
  title: string;
  centerLabel?: string;
  open: boolean;
  defaultRect?: FloatingWindowRect;
  minSize?: Pick<FloatingWindowRect, "width" | "height">;
  maxSizeRatio?: Pick<FloatingWindowRect, "width" | "height">;
  storageKey?: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

const DEFAULT_WINDOW_RECT: FloatingWindowRect = {
  x: 120,
  y: 80,
  width: 520,
  height: 700
};

const MIN_WINDOW_RECT = {
  width: 420,
  height: 500
};

const MAX_WINDOW_RATIO = {
  width: 0.9,
  height: 0.9
};

const BASE_Z_INDEX = 1000;

const FloatingWindowManagerContext = createContext<FloatingWindowManagerValue | null>(null);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readRect(storageKey: string, fallback: FloatingWindowRect): FloatingWindowRect {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) {
      return fallback;
    }

    const parsed = JSON.parse(stored) as Partial<FloatingWindowRect>;
    if (
      typeof parsed.x === "number" &&
      typeof parsed.y === "number" &&
      typeof parsed.width === "number" &&
      typeof parsed.height === "number"
    ) {
      return parsed as FloatingWindowRect;
    }
  } catch {
    // Ignore invalid persisted state.
  }

  return fallback;
}

function saveRect(storageKey: string, rect: FloatingWindowRect): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(rect));
  } catch {
    // Ignore storage failures.
  }
}

function iconForButton(kind: "minimize" | "maximize" | "close") {
  if (kind === "close") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 6l12 12" />
        <path d="M18 6L6 18" />
      </svg>
    );
  }

  if (kind === "maximize") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="5" y="5" width="14" height="14" rx="2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12h14" />
    </svg>
  );
}

export function FloatingWindowProvider({ children }: FloatingWindowProviderProps) {
  const [order, setOrder] = useState<string[]>([]);

  const bringToFront = useCallback((windowId: string) => {
    setOrder((current) => {
      const next = current.filter((id) => id !== windowId);
      next.push(windowId);
      return next;
    });
  }, []);

  const zIndexFor = useCallback(
    (windowId: string) => BASE_Z_INDEX + Math.max(0, order.indexOf(windowId)),
    [order]
  );

  const value = useMemo(() => ({ bringToFront, zIndexFor }), [bringToFront, zIndexFor]);

  return (
    <FloatingWindowManagerContext.Provider value={value}>
      {children}
    </FloatingWindowManagerContext.Provider>
  );
}

export function useFloatingWindowManager(): FloatingWindowManagerValue {
  const context = useContext(FloatingWindowManagerContext);
  if (!context) {
    throw new Error("useFloatingWindowManager must be used inside FloatingWindowProvider");
  }
  return context;
}

export function FloatingWindow({
  windowId,
  title,
  centerLabel,
  open,
  defaultRect = DEFAULT_WINDOW_RECT,
  minSize = MIN_WINDOW_RECT,
  maxSizeRatio = MAX_WINDOW_RATIO,
  storageKey = `floating-window:${windowId}`,
  icon,
  onClose,
  children
}: FloatingWindowProps) {
  const { bringToFront, zIndexFor } = useFloatingWindowManager();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ x: number; y: number; pointerX: number; pointerY: number } | null>(null);
  const resizeStateRef = useRef<{ rect: FloatingWindowRect; pointerX: number; pointerY: number; edge: "right" | "bottom" | "corner" } | null>(null);
  const restoreRectRef = useRef<FloatingWindowRect | null>(null);
  const [rect, setRect] = useState<FloatingWindowRect>(() => readRect(storageKey, defaultRect));
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    bringToFront(windowId);
  }, [bringToFront, open, windowId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    saveRect(storageKey, rect);
  }, [open, rect, storageKey]);

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      return;
    }

    const handleResize = () => {
      if (maximized) {
        return;
      }

      const maxWidth = window.innerWidth - 16;
      const maxHeight = window.innerHeight - 16;
      setRect((current) => ({
        x: clamp(current.x, 8, Math.max(8, maxWidth - current.width)),
        y: clamp(current.y, 8, Math.max(8, maxHeight - current.height)),
        width: clamp(current.width, minSize.width, maxWidth),
        height: clamp(current.height, minSize.height, maxHeight)
      }));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [maximized, minSize.height, minSize.width, open]);

  const clampedRect = useMemo(() => {
    if (typeof window === "undefined") {
      return rect;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxWidth = Math.max(minSize.width, Math.floor(viewportWidth * maxSizeRatio.width));
    const maxHeight = Math.max(minSize.height, Math.floor(viewportHeight * maxSizeRatio.height));
    const width = clamp(rect.width, minSize.width, maxWidth);
    const height = clamp(rect.height, minSize.height, maxHeight);
    const x = clamp(rect.x, 8, Math.max(8, viewportWidth - width - 8));
    const y = clamp(rect.y, 8, Math.max(8, viewportHeight - height - 8));

    return { x, y, width, height };
  }, [maxSizeRatio.height, maxSizeRatio.width, minSize.height, minSize.width, rect]);

  const applyRect = useCallback((nextRect: FloatingWindowRect) => {
    if (typeof window === "undefined") {
      setRect(nextRect);
      return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxWidth = Math.max(minSize.width, Math.floor(viewportWidth * maxSizeRatio.width));
    const maxHeight = Math.max(minSize.height, Math.floor(viewportHeight * maxSizeRatio.height));
    const width = clamp(nextRect.width, minSize.width, maxWidth);
    const height = clamp(nextRect.height, minSize.height, maxHeight);
    const x = clamp(nextRect.x, 8, Math.max(8, viewportWidth - width - 8));
    const y = clamp(nextRect.y, 8, Math.max(8, viewportHeight - height - 8));
    setRect({ x, y, width, height });
  }, [maxSizeRatio.height, maxSizeRatio.width, minSize.height, minSize.width]);

  const beginDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (maximized) {
      return;
    }

    bringToFront(windowId);
    dragStateRef.current = {
      x: clampedRect.x,
      y: clampedRect.y,
      pointerX: event.clientX,
      pointerY: event.clientY
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [bringToFront, clampedRect.x, clampedRect.y, maximized, windowId]);

  const beginResize = useCallback((edge: "right" | "bottom" | "corner") => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (maximized) {
      return;
    }

    bringToFront(windowId);
    resizeStateRef.current = {
      rect: clampedRect,
      pointerX: event.clientX,
      pointerY: event.clientY,
      edge
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [bringToFront, clampedRect, maximized, windowId]);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (dragStateRef.current) {
        const drag = dragStateRef.current;
        const dx = event.clientX - drag.pointerX;
        const dy = event.clientY - drag.pointerY;
        applyRect({
          x: drag.x + dx,
          y: drag.y + dy,
          width: clampedRect.width,
          height: clampedRect.height
        });
      }

      if (resizeStateRef.current) {
        const resize = resizeStateRef.current;
        const dx = event.clientX - resize.pointerX;
        const dy = event.clientY - resize.pointerY;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const maxWidth = Math.max(minSize.width, Math.floor(viewportWidth * maxSizeRatio.width));
        const maxHeight = Math.max(minSize.height, Math.floor(viewportHeight * maxSizeRatio.height));
        let nextRect = resize.rect;

        if (resize.edge === "right" || resize.edge === "corner") {
          nextRect = { ...nextRect, width: clamp(resize.rect.width + dx, minSize.width, maxWidth) };
        }

        if (resize.edge === "bottom" || resize.edge === "corner") {
          nextRect = { ...nextRect, height: clamp(resize.rect.height + dy, minSize.height, maxHeight) };
        }

        applyRect(nextRect);
      }
    };

    const clearInteraction = () => {
      dragStateRef.current = null;
      resizeStateRef.current = null;
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", clearInteraction);
    window.addEventListener("pointercancel", clearInteraction);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", clearInteraction);
      window.removeEventListener("pointercancel", clearInteraction);
    };
  }, [applyRect, clampedRect.height, clampedRect.width, maxSizeRatio.height, maxSizeRatio.width, minSize.height, minSize.width]);

  if (!open) {
    return null;
  }

  const windowStyle: CSSProperties = maximized
    ? {
        left: "10vw",
        top: "10vh",
        width: "80vw",
        height: "80vh",
        zIndex: zIndexFor(windowId)
      }
    : {
        left: `${clampedRect.x}px`,
        top: `${clampedRect.y}px`,
        width: `${clampedRect.width}px`,
        height: `${clampedRect.height}px`,
        zIndex: zIndexFor(windowId)
      };

  const windowNode = (
    <section
      ref={shellRef}
      className={`floating-window ${minimized ? "is-minimized" : ""} ${maximized ? "is-maximized" : ""}`.trim()}
      style={windowStyle}
      onPointerDownCapture={() => bringToFront(windowId)}
      aria-label={title}
    >
      <div
        className="floating-window__header"
        onPointerDown={beginDrag}
        role="toolbar"
        aria-label={title}
      >
        <div className="floating-window__header-left">
          {icon ? <span className="floating-window__icon">{icon}</span> : null}
          <strong>{title}</strong>
        </div>
        <div className="floating-window__header-center" title={centerLabel}>
          {centerLabel}
        </div>
        <div className="floating-window__header-actions">
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setMinimized((value) => !value)}
            aria-label="Minimize"
          >
            {iconForButton("minimize")}
          </button>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              if (!maximized) {
                restoreRectRef.current = clampedRect;
                setMaximized(true);
              } else {
                setMaximized(false);
                if (restoreRectRef.current) {
                  setRect(restoreRectRef.current);
                }
              }
            }}
            aria-label="Maximize"
          >
            {iconForButton("maximize")}
          </button>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClose}
            aria-label="Close"
          >
            {iconForButton("close")}
          </button>
        </div>
      </div>

      {!minimized ? (
        <div className="floating-window__body">
          {children}
        </div>
      ) : null}

      {!maximized ? (
        <>
          <button
            type="button"
            className="floating-window__resize floating-window__resize--right"
            aria-label="Resize horizontally"
            onPointerDown={beginResize("right")}
          />
          <button
            type="button"
            className="floating-window__resize floating-window__resize--bottom"
            aria-label="Resize vertically"
            onPointerDown={beginResize("bottom")}
          />
          <button
            type="button"
            className="floating-window__resize floating-window__resize--corner"
            aria-label="Resize window"
            onPointerDown={beginResize("corner")}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <path d="M2 10L10 2" />
              <path d="M5 10L10 5" />
              <path d="M8 10L10 8" />
            </svg>
          </button>
        </>
      ) : null}
    </section>
  );

  return typeof document !== "undefined" ? createPortal(windowNode, document.body) : windowNode;
}
