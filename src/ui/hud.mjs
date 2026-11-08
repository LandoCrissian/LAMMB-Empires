import { BUILDING_TYPES, UNIT_TYPES } from "../sim/config.mjs";
import { population } from "../sim/world.mjs";
import { POPULATION_CAP, canAfford } from "../sim/rules.mjs";

export const labels = {
  townCenter: "Town Center",
  worker: "Worker",
  swordsman: "Swordsman",
  archer: "Archer",
  infantry: "Ember infantry",
  raider: "Ember infantry",
  farm: "Farm",
  barracks: "Barracks",
  tower: "Watchtower",
  wood: "Timber grove",
  stone: "Stone outcrop",
  gold: "Gold vein",
  food: "Wild provisions",
};
const symbols = {
  townCenter: "♜",
  worker: "⚒",
  swordsman: "⚔",
  archer: "➶",
  farm: "♧",
  barracks: "⚑",
  tower: "♜",
  wood: "♠",
  stone: "◆",
  food: "♧",
  gold: "●",
};
export const timeText = (n) =>
  `${Math.floor(Math.max(0, n) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(Math.max(0, n) % 60)
    .toString()
    .padStart(2, "0")}`;
export const costText = (cost) =>
  Object.entries(cost || {})
    .map(([key, n]) => `${n} ${key}`)
    .join(" · ");
const el = (id) => document.getElementById(id);
function action(
  name,
  text,
  symbol,
  description,
  { disabled = false, active = false, label = text } = {},
) {
  return `<button class="action${active ? " active" : ""}" data-action="${name}" aria-label="${label}" ${disabled ? "disabled" : ""}><strong><span class="action-symbol" aria-hidden="true">${symbol}</span>${text}</strong><small>${description}</small></button>`;
}
export class HUD {
  constructor(onAction) {
    this.tab = "orders";
    this.onAction = onAction;
    this.lastActions = "";
    this.lastSelection = "";
    this.lastToast = 0;
    document.querySelector("#game-ui").addEventListener("click", (e) => {
      const tab = e.target.closest("[data-tab]");
      if (tab) {
        this.tab = tab.dataset.tab;
        document
          .querySelectorAll("[data-tab]")
          .forEach((b) => b.classList.toggle("active", b === tab));
        this.lastActions = "";
        onAction("refresh");
      }
      const button = e.target.closest("[data-action]");
      if (button && !button.disabled) onAction(button.dataset.action);
    });
  }
  toast(text) {
    el("toast").textContent = text;
    el("toast").classList.add("visible");
    this.lastToast = performance.now();
  }
  render(state, selection, mode, buildType, ghost) {
    const touch = navigator.maxTouchPoints > 0;
    const selected = [
      ...state.units,
      ...state.buildings,
      ...state.nodes,
    ].filter((e) => selection.has(e.id) && e.hp !== 0);
    const own = selected.filter((e) => e.faction === "player");
    const units = own.filter((e) => state.units.includes(e));
    const workers = units.filter((e) => e.type === "worker");
    el("resources").innerHTML =
      ["wood", "stone", "food", "gold"]
        .map(
          (key) =>
            `<div class="resource" data-resource="${key}"><span class="resource-icon" aria-hidden="true">${symbols[key]}</span><div><b>${Math.floor(state.resources[key])}</b><small>${key}</small></div></div>`,
        )
        .join("") +
      `<div class="resource"><span class="resource-icon" aria-hidden="true">♙</span><div><b>${population(state)}/${POPULATION_CAP}</b><small>Population</small></div></div>`;
    el("match-time").textContent = timeText(state.time);
    const ready = (type) =>
      state.buildings.some(
        (b) =>
          b.faction === "player" &&
          b.type === type &&
          b.progress >= 1 &&
          b.hp > 0,
      );
    const army = state.units.filter(
      (u) => u.faction === "player" && u.type !== "worker" && u.hp > 0,
    );
    el("milestones").innerHTML = [
      [ready("farm"), "Establish a food supply"],
      [ready("barracks"), "Raise your barracks"],
      [army.length >= 8, "Field eight soldiers"],
    ]
      .map(
        ([done, text]) =>
          `<div class="milestone${done ? " done" : ""}"><span>${done ? "✓" : ""}</span>${text}</div>`,
      )
      .join("");
    const until = (state.ai?.nextRaid || 180) - state.time;
    el("raid-timer").textContent =
      `${state.ai?.wave ? "Next" : "First"} raid in ${timeText(until)}`;
    let title = "Your expedition",
      symbol = "⚑",
      detail = "Select a unit or building.",
      hp = "",
      health = 0;
    if (selected.length === 1) {
      const entity = selected[0];
      title = labels[entity.type] || entity.type;
      symbol = symbols[entity.type] || "⚔";
      const role =
        entity.faction === "enemy"
          ? "Ember faction"
          : entity.faction === "player"
            ? "Verdant expedition"
            : "Resource deposit";
      detail = role;
      if (entity.amount !== undefined)
        detail = `${Math.floor(entity.amount)} supplies remaining`;
      if (entity.type === "farm")
        detail = `${Math.ceil(entity.foodRemaining || 0)} food remaining · Assign workers`;
      if (entity.progress !== undefined && entity.progress < 1)
        detail = `Constructing · ${Math.floor(entity.progress * 100)}%`;
      if (entity.order)
        detail =
          entity.type === "worker"
            ? {
                gather: "Gathering supplies",
                build: "Building settlement",
                move: "Moving to position",
                idle: "Ready for an assignment",
                attack: "Defending the settlement",
              }[entity.order.type] || "Following orders"
            : `${UNIT_TYPES[entity.type]?.range > 2 ? "Ranged" : "Melee"} · ${entity.order.type === "idle" ? "Holding position" : "Following orders"}`;
      if (entity.queue?.length)
        detail = `Training ${labels[entity.queue[0].unitType]} · ${Math.ceil(entity.queue[0].remaining)}s (${entity.queue.length} queued)`;
      hp = entity.maxHp ? `${Math.ceil(entity.hp)} / ${entity.maxHp}` : "";
      health = entity.maxHp ? entity.hp / entity.maxHp : 0;
    } else if (selected.length > 1) {
      title = `${selected.length} units selected`;
      symbol = "⚔";
      detail = `${workers.length} workers · ${units.length - workers.length} soldiers`;
      health = 1;
    }
    const info = `<div class="portrait" aria-hidden="true">${symbol}</div><div class="selection-details"><h3>${title}</h3><p>${detail}</p></div>${health ? `<div class="health-track"><span style="width:${Math.max(0, health * 100)}%"></span></div><p class="selection-hp">${hp}</p>` : ""}`;
    if (info !== this.lastSelection) {
      el("selection-info").innerHTML = info;
      this.lastSelection = info;
    }
    let actions = "";
    if (buildType) {
      actions =
        action(
          "confirm-build",
          "Place building",
          "✓",
          ghost
            ? ghost.ok
              ? costText(BUILDING_TYPES[buildType].cost)
              : ghost.reason || "Invalid location"
            : "Tap a location on the field",
          { disabled: !ghost?.ok },
        ) + action("cancel", "Cancel", "×", "Return to command");
    } else if (this.tab === "build") {
      actions = ["farm", "barracks", "tower"]
        .map((type) =>
          action(
            `build-${type}`,
            labels[type],
            symbols[type],
            costText(BUILDING_TYPES[type].cost),
            {
              disabled: !canAfford(state.resources, BUILDING_TYPES[type].cost),
            },
          ),
        )
        .join("");
    } else if (this.tab === "train") {
      actions = ["worker", "swordsman", "archer"]
        .map((type) => {
          const queued = state.buildings
            .filter((b) => b.faction === "player")
            .flatMap((b) => b.queue)
            .filter((item) => item.unitType === type).length;
          return action(
            `train-${type}`,
            `${labels[type]}${queued ? ` (${queued})` : ""}`,
            symbols[type],
            `${costText(UNIT_TYPES[type].cost)}${type !== "worker" && !ready("barracks") ? " · Needs barracks" : ""}`,
            {
              label: labels[type],
              disabled:
                population(state) >= POPULATION_CAP ||
                !canAfford(state.resources, UNIT_TYPES[type].cost) ||
                !ready(type === "worker" ? "townCenter" : "barracks"),
            },
          );
        })
        .join("");
    } else {
      actions =
        action("mode-move", "Move", "➤", "Choose a destination", {
          active: mode === "move",
          disabled: !units.length,
        }) +
        action("mode-attack", "Attack", "⚔", "Target or attack-move", {
          active: mode === "attack",
          disabled: !units.length,
        }) +
        action("stop", "Stop", "◇", "Hold this position", {
          disabled: !units.length,
        }) +
        action("mode-pan", "Pan", "✥", "Drag to explore", {
          active: mode === "pan",
        });
    }
    if (actions !== this.lastActions) {
      el("actions").innerHTML = actions;
      this.lastActions = actions;
    }
    el("hint").textContent = buildType
      ? `${labels[buildType]} · ${ghost ? (ghost.ok ? "Valid location. Confirm to begin construction." : ghost.reason || "Choose open ground near your settlement.") : "Choose a location near your settlement."}`
      : mode === "attack"
        ? "Tap an enemy to focus fire, or ground to attack-move."
        : mode === "move"
          ? "Tap the field to move your selected units."
          : mode === "pan"
            ? "Drag to explore. Tap Pan again to select units."
            : workers.length
              ? "Tap trees, stone, gold or a farm to gather. Build to expand."
              : army.length && units.length
                ? touch
                  ? "Choose Move or Attack, then tap the field."
                  : "Right-click to command, or choose Move / Attack then tap."
                : touch
                  ? "Select a unit. Drag the field to explore."
                  : "Select a unit. Drag a selection box; WASD to explore.";
    if (performance.now() - this.lastToast > 3600)
      el("toast").classList.remove("visible");
  }
}
