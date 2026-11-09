/** Pointer gestures produce simulation orders; camera gestures never issue orders. */
export function attachControls({
  canvas,
  renderer,
  view,
  getState,
  getSelection,
  setSelection,
  getMode,
  getBuild,
  onOrder,
  onPlace,
  onHover,
  onRally,
  onCancel,
  onPause,
  onGroup,
  onHome,
  onHold,
  enabled,
}) {
  const pointers = new Map();
  const keys = new Set();
  const box = document.querySelector("#selection-box");
  let drag = null,
    gesture = null;
  // A brief hold arms a touch selection rectangle. Immediate drag remains pan.
  const touchSelectionHoldMs = 320;
  const dragThresholdPx = 8;
  const world = (x, y) => renderer.screenToWorld(x, y, view);
  function pan(dx, dy) {
    const a = world(0, 0),
      b = world(dx, dy);
    view.x -= b.x - a.x;
    view.y -= b.y - a.y;
    view.x = Math.max(0, Math.min(getState().map.width, view.x));
    view.y = Math.max(0, Math.min(getState().map.height, view.y));
  }
  function pinchData() {
    const [a, b] = [...pointers.values()];
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
  }
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    if (!enabled()) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size > 1) {
      gesture = pinchData();
      if (drag) drag.cancelled = true;
      box.hidden = true;
      return;
    }
    drag = {
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      intent: null,
      startAt: performance.now(),
      touch: e.pointerType === "touch",
      button: e.button,
      shift: e.shiftKey,
      cancelled: false,
    };
    onHover(world(e.clientX, e.clientY));
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!enabled()) return;
    onHover(world(e.clientX, e.clientY));
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size > 1) {
      const next = pinchData();
      if (gesture) {
        pan(next.x - gesture.x, next.y - gesture.y);
        view.zoom = Math.max(
          0.45,
          Math.min(
            2.3,
            (view.zoom * next.distance) / Math.max(1, gesture.distance),
          ),
        );
      }
      gesture = next;
      return;
    }
    if (!drag || drag.cancelled) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > dragThresholdPx)
      drag.moved = true;
    if (drag.moved) {
      // Fix gesture intent once per drag. A camera pan never turns into a
      // selection halfway through the gesture, even if the finger is held down.
      if (!drag.intent) {
        const mode = getMode();
        const canSelect = !getBuild() && (mode === "select" || mode === "box");
        drag.intent =
          canSelect &&
          (mode === "box" ||
            (drag.touch
              ? performance.now() - drag.startAt >= touchSelectionHoldMs
              : drag.button === 0 && !keys.has(" ")))
            ? "select"
            : "pan";
      }
      if (drag.intent === "pan") {
        pan(e.clientX - drag.lastX, e.clientY - drag.lastY);
      } else {
        box.hidden = false;
        Object.assign(box.style, {
          left: `${Math.min(e.clientX, drag.x)}px`,
          top: `${Math.min(e.clientY, drag.y)}px`,
          width: `${Math.abs(e.clientX - drag.x)}px`,
          height: `${Math.abs(e.clientY - drag.y)}px`,
        });
      }
    }
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
  });
  function release(e) {
    pointers.delete(e.pointerId);
    box.hidden = true;
    if (pointers.size || !drag || drag.cancelled || !enabled()) {
      if (!pointers.size) {
        drag = null;
        gesture = null;
      }
      return;
    }
    const end = drag;
    drag = null;
    if (end.moved) {
      if (end.intent === "select") {
        const selected = end.shift ? new Set(getSelection()) : new Set();
        for (const u of getState().units.filter(
          (u) => u.faction === "player" && u.hp > 0,
        )) {
          const p = renderer.worldToScreen(u.x, u.y, view);
          if (
            p.x >= Math.min(e.clientX, end.x) &&
            p.x <= Math.max(e.clientX, end.x) &&
            p.y >= Math.min(e.clientY, end.y) &&
            p.y <= Math.max(e.clientY, end.y)
          )
            selected.add(u.id);
        }
        setSelection(selected);
      }
      return;
    }
    const p = world(e.clientX, e.clientY);
    if (getBuild()) {
      onPlace(p, end.touch);
      return;
    }
    const entity = renderer.hitTest(getState(), e.clientX, e.clientY, view);
    if (getMode() === "rally") {
      onRally(p, entity);
      return;
    }
    const hasUnits = getState().units.some((u) => getSelection().has(u.id));
    if (end.button === 2 || getMode() === "move" || getMode() === "attack") {
      onOrder(p, entity, getMode());
      return;
    }
    if (getMode() === "pan") return;
    // Touch selection is context-first: tap empty ground to command the
    // selected units, rather than clearing them. Desktop retains right-click.
    if (end.touch && hasUnits && !entity && getMode() === "select") {
      onOrder(p, entity, "context");
      return;
    }
    if (getMode() === "box") {
      if (entity?.faction === "player") setSelection(new Set([entity.id]));
      return;
    }
    const hasWorkers = getState().units.some(
      (u) =>
        getSelection().has(u.id) &&
        u.type === "worker" &&
        u.faction === "player",
    );
    if (
      hasWorkers &&
      entity?.faction === "player" &&
      (entity.type === "farm" || entity.progress < 1)
    ) {
      onOrder(p, entity, "context");
    } else if (entity?.faction === "player") {
      const next = end.shift ? new Set(getSelection()) : new Set();
      if (end.shift && next.has(entity.id)) next.delete(entity.id);
      else next.add(entity.id);
      setSelection(next);
    } else if (hasUnits && entity) onOrder(p, entity, "context");
    else if (!entity) setSelection(new Set());
    else setSelection(new Set([entity.id]));
  }
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", (e) => {
    pointers.delete(e.pointerId);
    drag = null;
    gesture = null;
    box.hidden = true;
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (!enabled()) return;
      const before = world(e.clientX, e.clientY);
      view.zoom = Math.max(
        0.45,
        Math.min(2.3, view.zoom * Math.exp(-e.deltaY * 0.001)),
      );
      const after = world(e.clientX, e.clientY);
      view.x += before.x - after.x;
      view.y += before.y - after.y;
    },
    { passive: false },
  );
  window.addEventListener("keydown", (e) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    )
      return;
    const key = e.key.toLowerCase();
    keys.add(key);
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key))
      e.preventDefault();
    if (key === "escape") onCancel();
    if (!enabled()) return;
    if (key === "v") onGroup("workers");
    if (key === "g") onGroup("army");
    if (key === "h") onHome();
    if (key === "j" && !e.repeat) onHold();
    if (key === " " && !e.repeat) onPause();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => {
    keys.clear();
    pointers.clear();
    drag = null;
    box.hidden = true;
  });
  return {
    update(dt) {
      if (!enabled()) return;
      let dx = 0,
        dy = 0;
      if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
      if (keys.has("d") || keys.has("arrowright")) dx += 1;
      if (keys.has("w") || keys.has("arrowup")) dy -= 1;
      if (keys.has("s") || keys.has("arrowdown")) dy += 1;
      if (dx || dy) pan(-dx * 520 * dt, -dy * 520 * dt);
    },
    reset() {
      keys.clear();
      pointers.clear();
      drag = null;
      gesture = null;
      box.hidden = true;
    },
  };
}
