import { createGame, stepGame, command, placement } from "./sim/world.mjs";
import { BUILDING_TYPES } from "./sim/config.mjs";
import { fixedStepClock } from "./sim/rules.mjs";
import { Battlefield } from "./render/battlefield.mjs";
import { attachControls } from "./input/controls.mjs";
import { HUD, labels, timeText } from "./ui/hud.mjs";

const $ = (id) => document.getElementById(id);
const canvas = $("battlefield"),
  renderer = new Battlefield(canvas);
let state = createGame(5280),
  selection = new Set(),
  started = false,
  paused = false;
let mode = "select",
  buildType = null,
  ghost = null,
  lastFrame = performance.now(),
  hudElapsed = 0,
  observedEvent = 0,
  finished = false;
const view = { x: 8, y: 24, zoom: 1 };
renderer.resize();
renderer.fit(state, view);
const clock = fixedStepClock({ step: 0.05, maxSteps: 5 });
const hud = new HUD(handleAction);
const isInteractive = () =>
  started &&
  !paused &&
  state.status === "playing" &&
  !document.querySelector("dialog[open]");
function refresh() {
  hud.render(state, selection, mode, buildType, ghost);
}
function feedback(result, success) {
  if (!result?.ok) hud.toast(result?.reason || "That order is unavailable.");
  else if (success) hud.toast(success);
  refresh();
  return result?.ok;
}
function setSelection(ids) {
  selection = ids;
  mode = "select";
  buildType = null;
  ghost = null;
  refresh();
}
function home() {
  const tc = state.buildings.find(
    (b) => b.type === "townCenter" && b.faction === "player",
  );
  if (tc) {
    view.x = tc.x + tc.width / 2;
    view.y = tc.y + tc.height / 2;
  }
}
function group(type) {
  setSelection(
    new Set(
      state.units
        .filter(
          (u) =>
            u.faction === "player" &&
            u.hp > 0 &&
            (type === "workers" ? u.type === "worker" : u.type !== "worker"),
        )
        .map((u) => u.id),
    ),
  );
}
function cancel() {
  mode = "select";
  buildType = null;
  ghost = null;
  refresh();
}
function preview(p) {
  if (!buildType) return;
  const x = Math.floor(p.x),
    y = Math.floor(p.y),
    d = BUILDING_TYPES[buildType];
  const result = placement(state, buildType, x, y);
  ghost = {
    type: buildType,
    x,
    y,
    width: d.width,
    height: d.height,
    ...result,
  };
}
function build(p, touch = false) {
  preview(p);
  if (touch) {
    refresh();
    return;
  }
  confirmBuild();
}
function confirmBuild() {
  if (!buildType || !ghost) return;
  let ids = state.units
    .filter(
      (u) =>
        u.type === "worker" && u.faction === "player" && selection.has(u.id),
    )
    .map((u) => u.id);
  if (!ids.length)
    ids = state.units
      .filter((u) => u.type === "worker" && u.faction === "player")
      .sort(
        (a, b) =>
          Math.hypot(a.x - ghost.x, a.y - ghost.y) -
          Math.hypot(b.x - ghost.x, b.y - ghost.y),
      )
      .slice(0, 2)
      .map((u) => u.id);
  const type = buildType;
  if (
    feedback(
      command(state, {
        type: "build",
        buildingType: type,
        x: ghost.x,
        y: ghost.y,
        workerIds: ids,
      }),
      `${labels[type]} construction ordered.`,
    )
  ) {
    cancel();
    hud.tab = "build";
    refresh();
  }
}
function order(p, entity, orderMode) {
  const ids = state.units
    .filter((u) => u.faction === "player" && selection.has(u.id) && u.hp > 0)
    .map((u) => u.id);
  if (!ids.length) {
    hud.toast("Select workers or soldiers first.");
    return;
  }
  let next;
  if (entity?.faction === "enemy" && orderMode !== "move")
    next = { type: "attack", targetId: entity.id };
  else if (
    (state.nodes.includes(entity) || entity?.type === "farm") &&
    orderMode !== "attack" &&
    orderMode !== "move"
  )
    next = { type: "gather", targetId: entity.id };
  else if (
    entity?.faction === "player" &&
    entity.progress < 1 &&
    orderMode !== "attack"
  )
    next = { type: "build", targetId: entity.id };
  else
    next = {
      type: orderMode === "attack" ? "attackMove" : "move",
      x: Math.max(0.5, Math.min(state.map.width - 0.5, p.x)),
      y: Math.max(0.5, Math.min(state.map.height - 0.5, p.y)),
    };
  // Context gathering/building applies only to workers in a mixed selection.
  const allowed = ["gather", "build"].includes(next.type)
    ? ids.filter(
        (id) => state.units.find((u) => u.id === id)?.type === "worker",
      )
    : ids;
  if (feedback(command(state, { type: "order", ids: allowed, order: next }))) {
    renderer.markOrder?.(
      p,
      next.type === "attack" || next.type === "attackMove" ? "attack" : "move",
    );
    mode = "select";
    refresh();
  }
}
function pause() {
  if (!started || state.status !== "playing") return;
  paused = true;
  clock.reset();
  $("pause-dialog").showModal();
}
function resume() {
  $("pause-dialog").close();
  paused = false;
  lastFrame = performance.now();
  clock.reset();
}
function restart() {
  for (const dialog of document.querySelectorAll("dialog[open]"))
    dialog.close();
  state = createGame(5280);
  selection = new Set();
  mode = "select";
  buildType = null;
  ghost = null;
  paused = false;
  finished = false;
  observedEvent = 0;
  clock.reset();
  controls.reset();
  renderer.fit(state, view);
  home();
  hud.tab = "orders";
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === "orders"));
  lastFrame = performance.now();
  refresh();
  hud.toast("A new expedition. Gather, build, and hold the Frontier.");
}
function handleAction(action) {
  if (action === "refresh") {
    refresh();
    return;
  }
  if (!isInteractive()) return;
  if (action === "workers" || action === "army") group(action);
  if (action === "home") home();
  if (action === "zoom-in") view.zoom = Math.min(2.3, view.zoom * 1.2);
  if (action === "zoom-out") view.zoom = Math.max(0.45, view.zoom / 1.2);
  if (action === "cancel") cancel();
  if (action === "confirm-build") confirmBuild();
  if (action.startsWith("mode-")) {
    buildType = null;
    ghost = null;
    mode = mode === action.slice(5) ? "select" : action.slice(5);
  }
  if (action === "stop")
    feedback(command(state, { type: "stop", ids: [...selection] }));
  if (action.startsWith("build-")) {
    if (
      !state.units.some((u) => u.type === "worker" && u.faction === "player")
    ) {
      hud.toast("You need a worker to construct a building.");
      return;
    }
    buildType = action.slice(6);
    ghost = null;
    mode = "select";
  }
  if (action.startsWith("train-")) {
    const unitType = action.slice(6),
      kind = unitType === "worker" ? "townCenter" : "barracks";
    const producers = state.buildings
      .filter(
        (b) =>
          b.faction === "player" &&
          b.type === kind &&
          b.progress >= 1 &&
          b.hp > 0,
      )
      .sort(
        (a, b) =>
          selection.has(b.id) - selection.has(a.id) ||
          a.queue.length - b.queue.length,
      );
    if (!producers.length) {
      hud.toast(`Complete a ${labels[kind]} first.`);
      return;
    }
    feedback(
      command(state, {
        type: "recruit",
        unitType,
        buildingId: producers[0].id,
      }),
      `${labels[unitType]} added to training queue.`,
    );
  }
  refresh();
}
const controls = attachControls({
  canvas,
  renderer,
  view,
  getState: () => state,
  getSelection: () => selection,
  setSelection,
  getMode: () => mode,
  getBuild: () => buildType,
  onOrder: order,
  onPlace: build,
  onHover: preview,
  onCancel: cancel,
  onPause: pause,
  onGroup: group,
  onHome: home,
  enabled: isInteractive,
});
$("play").addEventListener("click", () => {
  started = true;
  $("entry").hidden = true;
  $("game-ui").hidden = false;
  renderer.fit(state, view);
  home();
  refresh();
  hud.toast("Welcome, commander. Select workers to begin gathering.");
});
$("pause").addEventListener("click", pause);
$("resume").addEventListener("click", resume);
$("restart").addEventListener("click", restart);
$("restart-paused").addEventListener("click", restart);
$("pause-dialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  resume();
});
$("result-dialog").addEventListener("cancel", (e) => e.preventDefault());
$("help").addEventListener("click", () => {
  paused = true;
  clock.reset();
  $("help-dialog").showModal();
});
function closeHelp() {
  $("help-dialog").close();
  paused = false;
  clock.reset();
  lastFrame = performance.now();
}
document
  .querySelectorAll("[data-close]")
  .forEach((b) => b.addEventListener("click", closeHelp));
$("help-dialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeHelp();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && isInteractive()) pause();
});
let narrowViewport = window.innerWidth < 600;
window.addEventListener("resize", () => {
  renderer.resize();
  const nextNarrow = window.innerWidth < 600;
  if (nextNarrow !== narrowViewport) renderer.fit(state, view);
  narrowViewport = nextNarrow;
});
const mini = $("minimap"),
  mc = mini.getContext("2d");
function minimap() {
  const sx = mini.width / state.map.width,
    sy = mini.height / state.map.height;
  mc.fillStyle = "#49634a";
  mc.fillRect(0, 0, mini.width, mini.height);
  for (let y = 0; y < state.map.height; y++)
    for (let x = 0; x < state.map.width; x++) {
      const terrain = state.map.terrain[y]?.[x];
      mc.fillStyle =
        terrain === "water"
          ? "#5a9699"
          : terrain === "ridge"
            ? "#85846a"
            : terrain === "road"
              ? "#c0a678"
              : "#536f50";
      mc.fillRect(x * sx, y * sy, sx + 0.2, sy + 0.2);
    }
  for (const n of state.nodes)
    if (n.amount > 0) {
      mc.fillStyle =
        n.type === "wood"
          ? "#284b35"
          : n.type === "gold"
            ? "#e5bd68"
            : "#b7b2a0";
      mc.fillRect(n.x * sx - 1, n.y * sy - 1, 2.4, 2.4);
    }
  for (const b of state.buildings)
    if (b.hp > 0) {
      mc.fillStyle = b.faction === "player" ? "#9de0d1" : "#ef9c78";
      mc.fillRect(b.x * sx, b.y * sy, b.width * sx, b.height * sy);
    }
  for (const u of state.units)
    if (u.hp > 0) {
      mc.fillStyle = u.faction === "player" ? "#d3f3dc" : "#ffaf8b";
      mc.fillRect(u.x * sx - 1, u.y * sy - 1, 2, 2);
    }
  mc.strokeStyle = "#ead5a4";
  mc.lineWidth = 1;
  mc.beginPath();
  const bounds = [
    [0, 90],
    [canvas.clientWidth, 90],
    [canvas.clientWidth, canvas.clientHeight - 180],
    [0, canvas.clientHeight - 180],
  ].map(([x, y]) => renderer.screenToWorld(x, y, view));
  bounds.forEach((p, i) =>
    i ? mc.lineTo(p.x * sx, p.y * sy) : mc.moveTo(p.x * sx, p.y * sy),
  );
  mc.closePath();
  mc.stroke();
}
mini.addEventListener("pointerdown", (e) => {
  if (!isInteractive()) return;
  const rect = mini.getBoundingClientRect();
  view.x = ((e.clientX - rect.left) / rect.width) * state.map.width;
  view.y = ((e.clientY - rect.top) / rect.height) * state.map.height;
});
function result() {
  finished = true;
  cancel();
  const victory = state.status === "victory";
  $("result-eyebrow").textContent = victory
    ? "THE FRONTIER IS YOURS"
    : "THE MARCHES WILL REMEMBER";
  $("result-title").textContent = victory
    ? "An empire begins."
    : "Your settlement has fallen.";
  $("result-copy").textContent = victory
    ? "The Ember stronghold has fallen. Your people have secured a home in the Verdant Marches."
    : "The Ember legion destroyed your Town Center. Build earlier, guard your workers, and keep archers behind your front line.";
  $("result-stats").textContent =
    `Expedition time ${timeText(state.time)}  ·  Enemy raids ${state.ai?.wave || 0}  ·  Soldiers remaining ${state.units.filter((u) => u.faction === "player" && u.type !== "worker" && u.hp > 0).length}`;
  $("result-dialog").showModal();
}
function frame(now) {
  // A queued animation timestamp can precede a resume handler's performance.now().
  const dt = Math.max(0, Math.min(0.1, (now - lastFrame) / 1000));
  lastFrame = now;
  if (isInteractive()) {
    controls.update(dt);
    clock.advance(dt, (step) => stepGame(state, step));
  }
  renderer.draw(state, view, selection, ghost, now / 1000);
  if (started) {
    hudElapsed += dt;
    if (hudElapsed > 0.15) {
      if (buildType && ghost)
        Object.assign(ghost, placement(state, buildType, ghost.x, ghost.y));
      hudElapsed = 0;
      const living = new Set(
        [...state.units, ...state.buildings, ...state.nodes]
          .filter((e) => e.hp !== 0)
          .map((e) => e.id),
      );
      selection = new Set([...selection].filter((id) => living.has(id)));
      refresh();
      minimap();
      const news = state.events.filter(
        (e) =>
          e.id > observedEvent &&
          e.text &&
          !["gather", "hit", "attack", "delivery"].includes(e.type),
      );
      if (news.length) hud.toast(news[news.length - 1].text);
      if (state.events.length)
        observedEvent = state.events[state.events.length - 1].id;
    }
    if (state.status !== "playing" && !finished) result();
  }
  requestAnimationFrame(frame);
}
if (new URLSearchParams(location.search).has("test")) {
  window.frontierDebug = Object.freeze({
    snapshot: () => structuredClone(state),
    worldToScreen: (x, y) => renderer.worldToScreen(x, y, view),
    camera: () => ({ ...view }),
  });
}
requestAnimationFrame(frame);
