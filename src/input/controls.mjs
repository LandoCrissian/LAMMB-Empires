/** Pointer gestures produce simulation orders; camera gestures never issue orders. */
export const TOUCH_SELECTION_HOLD_MS = 320;

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
  onAssault,
  onRetreat,
  enabled,
}) {
  const pointers = new Map();
  const keys = new Set();
  const box = document.querySelector("#selection-box");
  let drag = null,
    gesture = null,
    holdTimer = null,
    lastTap = null;
  const dragThresholdPx = 8;
  const doubleTapMs = 350;
  const world = (x, y) => renderer.screenToWorld(x, y, view);
  function cancelHold() {
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
  }
  function hideBox() {
    box.hidden = true;
    box.classList.remove("armed");
    delete box.dataset.phase;
  }
  function resetPointers() {
    cancelHold();
    const captured = [...pointers.keys()];
    pointers.clear();
    drag = null;
    gesture = null;
    lastTap = null;
    hideBox();
    delete canvas.dataset.gesture;
    for (const id of captured)
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  function drawBox(endX, endY, armed = false) {
    box.hidden = false;
    box.classList.toggle("armed", armed);
    box.dataset.phase = armed ? "armed" : "dragging";
    canvas.dataset.gesture = armed ? "selection-ready" : "select";
    Object.assign(box.style, {
      left: `${armed ? drag.x - 13 : Math.min(endX, drag.x)}px`,
      top: `${armed ? drag.y - 13 : Math.min(endY, drag.y)}px`,
      width: `${armed ? 26 : Math.abs(endX - drag.x)}px`,
      height: `${armed ? 26 : Math.abs(endY - drag.y)}px`,
    });
  }
  function ownUnits() {
    return getState().units.filter((u) => u.faction === "player" && u.hp > 0);
  }
  function sameTypeSelection(entity) {
    const rect = canvas.getBoundingClientRect();
    const next = new Set();
    for (const unit of ownUnits()) {
      if (unit.type !== entity.type) continue;
      const p = renderer.worldToScreen(unit.x, unit.y, view);
      if (
        p.x >= rect.left &&
        p.x <= rect.right &&
        p.y >= rect.top &&
        p.y <= rect.bottom &&
        document.elementFromPoint(p.x, p.y) === canvas
      )
        next.add(unit.id);
    }
    next.add(entity.id);
    setSelection(next);
  }
  function clampCamera() {
    view.x = Math.max(0, Math.min(getState().map.width, view.x));
    view.y = Math.max(0, Math.min(getState().map.height, view.y));
  }
  function pan(dx, dy) {
    const a = world(0, 0),
      b = world(dx, dy);
    view.x -= b.x - a.x;
    view.y -= b.y - a.y;
    clampCamera();
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
      cancelHold();
      gesture = pinchData();
      if (drag) drag.cancelled = true;
      lastTap = null;
      hideBox();
      canvas.dataset.gesture = "pinch";
      return;
    }
    drag = {
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      intent: null,
      touch: e.pointerType === "touch",
      button: e.button,
      shift: e.shiftKey,
      cancelled: false,
      held: false,
      mode: getMode(),
      build: getBuild(),
    };
    if (drag.touch && !drag.build && drag.mode === "select") {
      const started = drag;
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (
          drag !== started ||
          !enabled() ||
          pointers.size !== 1 ||
          drag.cancelled ||
          drag.moved ||
          getMode() !== drag.mode ||
          getBuild()
        )
          return;
        drag.intent = "select";
        drag.held = true;
        drawBox(drag.x, drag.y, true);
      }, TOUCH_SELECTION_HOLD_MS);
    }
    if (!drag.touch && e.button !== 0) lastTap = null;
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
        const anchor = world(next.x, next.y);
        view.zoom = Math.max(
          0.45,
          Math.min(
            2.3,
            (view.zoom * next.distance) / Math.max(1, gesture.distance),
          ),
        );
        const after = world(next.x, next.y);
        view.x += anchor.x - after.x;
        view.y += anchor.y - after.y;
        clampCamera();
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
            (!drag.touch && drag.button === 0 && !keys.has(" ")))
            ? "select"
            : drag.touch || drag.button === 1 || mode === "pan" || keys.has(" ")
              ? "pan"
              : "cancel";
        cancelHold();
        lastTap = null;
      }
      if (drag.intent === "pan") {
        canvas.dataset.gesture = "pan";
        pan(e.clientX - drag.lastX, e.clientY - drag.lastY);
      } else if (drag.intent === "select") drawBox(e.clientX, e.clientY);
    }
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
  });
  function release(e) {
    if (!pointers.delete(e.pointerId)) return;
    cancelHold();
    hideBox();
    if (pointers.size || !drag || drag.cancelled || !enabled()) {
      if (!pointers.size) {
        drag = null;
        gesture = null;
        delete canvas.dataset.gesture;
      }
      return;
    }
    const end = drag;
    drag = null;
    delete canvas.dataset.gesture;
    if (getMode() !== end.mode || getBuild() !== end.build) return;
    // A missing/coalesced move event must never turn a drag into a tap order.
    if (
      !end.moved &&
      Math.hypot(e.clientX - end.x, e.clientY - end.y) > dragThresholdPx
    ) {
      lastTap = null;
      return;
    }
    if (end.moved) {
      if (end.intent === "select") {
        const units = ownUnits();
        const selected = end.shift
          ? new Set(
              units.filter((u) => getSelection().has(u.id)).map((u) => u.id),
            )
          : new Set();
        for (const u of units) {
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
      lastTap = null;
      return;
    }
    // Releasing an armed hold without dragging cannot become a move order.
    if (end.held) {
      lastTap = null;
      return;
    }
    const p = world(e.clientX, e.clientY);
    if (getBuild()) {
      lastTap = null;
      onPlace(p, end.touch);
      return;
    }
    const entity = renderer.hitTest(getState(), e.clientX, e.clientY, view);
    if (getMode() === "rally") {
      lastTap = null;
      onRally(p, entity);
      return;
    }
    const hasUnits = ownUnits().some((u) => getSelection().has(u.id));
    if (
      end.button === 2 ||
      ["move", "attack", "assault", "retreat", "gather", "assist"].includes(
        getMode(),
      )
    ) {
      lastTap = null;
      onOrder(p, entity, getMode());
      return;
    }
    if (getMode() === "pan") return;
    // Touch selection is context-first: tap empty ground to command the
    // selected units, rather than clearing them. Desktop retains right-click.
    if (end.touch && hasUnits && !entity && getMode() === "select") {
      lastTap = null;
      onOrder(p, entity, "context");
      return;
    }
    if (getMode() === "box") {
      lastTap = null;
      if (entity?.faction === "player") setSelection(new Set([entity.id]));
      return;
    }
    const sameTypeTap =
      !end.shift && entity?.faction === "player" && ownUnits().includes(entity);
    if (sameTypeTap) {
      const now = performance.now();
      if (
        lastTap?.id === entity.id &&
        lastTap.touch === end.touch &&
        now - lastTap.time <= doubleTapMs &&
        Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <= 24
      ) {
        sameTypeSelection(entity);
        lastTap = null;
        return;
      }
      lastTap = {
        id: entity.id,
        time: now,
        x: e.clientX,
        y: e.clientY,
        touch: end.touch,
      };
    } else lastTap = null;
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
  canvas.addEventListener("pointercancel", resetPointers);
  canvas.addEventListener("lostpointercapture", (e) => {
    if (pointers.has(e.pointerId)) resetPointers();
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
      e.target instanceof HTMLTextAreaElement ||
      e.target?.isContentEditable
    )
      return;
    const key = e.key.toLowerCase();
    keys.add(key);
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key))
      e.preventDefault();
    if (key === "escape") {
      resetPointers();
      if (enabled() && getMode() === "select" && !getBuild())
        setSelection(new Set());
      else onCancel();
      return;
    }
    if (!enabled()) return;
    if (key === "v") onGroup("workers");
    if (key === "g") onGroup("army");
    if (key === "h") onHome();
    if (key === "j" && !e.repeat) onHold();
    if (key === "k" && !e.repeat) onAssault?.();
    if (key === "r" && !e.repeat) onRetreat?.();
    if (key === " " && !e.repeat) onPause();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => {
    keys.clear();
    resetPointers();
  });
  return {
    // HUD/minimap input invalidates an unfinished field gesture without
    // interrupting held camera keys such as WASD.
    cancelGesture: resetPointers,
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
      resetPointers();
    },
  };
}
