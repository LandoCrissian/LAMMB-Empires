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
  workshop: "Siege Workshop",
  ram: "Siege Ram",
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
  workshop: "⚙",
  ram: "▰",
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
    this.compact = null;
    // Resize changes presentation offsets only; the tactical camera stays fixed.
    this.dockObserver = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty(
        "--dock-height",
        `${entry.target.getBoundingClientRect().height}px`,
      );
    });
    this.dockObserver.observe(document.querySelector(".command-dock"));
    this.panels = {
      regular: { objectives: true, minimap: true },
      compact: { objectives: false, minimap: false },
    };
    el("toggle-objective").addEventListener("click", () =>
      this.togglePanel("objectives"),
    );
    el("toggle-minimap").addEventListener("click", () =>
      this.togglePanel("minimap"),
    );
    document.querySelector("#game-ui").addEventListener("click", (e) => {
      const tab = e.target.closest("[data-tab]");
      if (tab) {
        this.tab = tab.dataset.tab;
        document
          .querySelectorAll("[data-tab]")
          .forEach((b) => b.classList.toggle("active", b === tab));
        this.lastActions = "";
        onAction(`tab-${this.tab}`);
      }
      const button = e.target.closest("[data-action]");
      if (button && !button.disabled) onAction(button.dataset.action);
    });
  }
  setLayout(compact) {
    this.compact = compact;
    this.applyPanels();
  }
  togglePanel(panel) {
    const preferences = this.panels[this.compact ? "compact" : "regular"];
    preferences[panel] = !preferences[panel];
    this.applyPanels();
  }
  applyPanels() {
    const preferences = this.panels[this.compact ? "compact" : "regular"];
    document.body.classList.toggle(
      "objectives-closed",
      !preferences.objectives,
    );
    document.body.classList.toggle("minimap-closed", !preferences.minimap);
    el("mission").hidden = !preferences.objectives;
    el("map-card").hidden = !preferences.minimap;
    el("toggle-objective").setAttribute(
      "aria-expanded",
      String(preferences.objectives),
    );
    el("toggle-minimap").setAttribute(
      "aria-expanded",
      String(preferences.minimap),
    );
  }
  toast(text, { urgent = false, passive = false } = {}) {
    const now = performance.now();
    if (passive && !urgent && now < (this.urgentToastUntil || 0)) return;
    el("toast").textContent = text;
    el("toast").classList.add("visible");
    el("toast").classList.toggle("urgent", urgent);
    this.lastToast = now;
    this.toastDuration = urgent ? 6500 : 3600;
    this.urgentToastUntil = urgent ? now + this.toastDuration : 0;
  }
  render(state, selection, mode, buildType, ghost, rallyGhost = null) {
    const touch =
      navigator.maxTouchPoints > 0 ||
      matchMedia("(any-pointer: coarse)").matches;
    const selected = [
      ...state.units,
      ...state.buildings,
      ...state.nodes,
    ].filter((e) => selection.has(e.id) && e.hp !== 0);
    const own = selected.filter((e) => e.faction === "player");
    const units = own.filter((e) => state.units.includes(e));
    const workers = units.filter((e) => e.type === "worker");
    const price = (cost) =>
      this.compact
        ? Object.entries(cost || {})
            .map(([key, value]) => `${value}${key[0]}`)
            .join(" · ")
        : costText(cost);
    const producer =
      own.length === 1 &&
      state.buildings.includes(own[0]) &&
      own[0].progress === 1 &&
      ["townCenter", "barracks", "workshop"].includes(own[0].type)
        ? own[0]
        : null;
    const resourcesHTML =
      ["wood", "stone", "food", "gold"]
        .map(
          (key) =>
            `<div class="resource" data-resource="${key}"><span class="resource-icon" aria-hidden="true">${symbols[key]}</span><div><b>${Math.floor(state.resources[key])}</b><small>${key}</small></div></div>`,
        )
        .join("") +
      `<div class="resource"><span class="resource-icon" aria-hidden="true">♙</span><div><b>${population(state)}/${POPULATION_CAP}</b><small>Population</small></div></div>`;
    if (resourcesHTML !== this.lastResources) {
      el("resources").innerHTML = resourcesHTML;
      this.lastResources = resourcesHTML;
    }
    const matchTime = timeText(state.time);
    if (el("match-time").textContent !== matchTime)
      el("match-time").textContent = matchTime;
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
    const milestonesHTML = [
      [ready("farm"), "Establish a food supply"],
      [ready("barracks"), "Raise your barracks"],
      [army.length >= 8, "Field eight soldiers"],
    ]
      .map(
        ([done, text]) =>
          `<div class="milestone${done ? " done" : ""}"><span>${done ? "✓" : ""}</span>${text}</div>`,
      )
      .join("");
    if (milestonesHTML !== this.lastMilestones) {
      el("milestones").innerHTML = milestonesHTML;
      this.lastMilestones = milestonesHTML;
    }
    const until = (state.ai?.nextRaid || 180) - state.time;
    const timer = `${state.ai?.wave ? "Next" : "First"} raid in ${timeText(until)}`;
    if (el("raid-timer").textContent !== timer)
      el("raid-timer").textContent = timer;
    const raidText =
      until <= 30
        ? `⚑ Raid assembling · ${timeText(until)}`
        : `${state.ai?.wave ? "Next" : "First"} raid · ${timeText(until)}`;
    if (el("field-status").textContent !== raidText)
      el("field-status").textContent = raidText;
    document.body.classList.toggle("raid-imminent", until <= 30);
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
                retreat: "Retreating to regroup",
                idle: "Ready for an assignment",
                attack: "Defending the settlement",
              }[entity.order.type] || "Following orders"
            : `${entity.type === "ram" ? "Siege / escort" : UNIT_TYPES[entity.type]?.range > 2 ? "Ranged" : "Melee"} · ${entity.order.type === "assault" ? `Assault · ${entity.order.phase || "regroup"}` : entity.order.type === "retreat" ? "Retreating / regrouping" : entity.order.type === "hold" ? "Holding fire line" : entity.order.type === "idle" ? "Ready / defensive" : "Following orders"}`;
      if (entity.queue?.length)
        detail = entity.spawnBlocked
          ? `${labels[entity.queue[0].unitType]} ready · Clear the production exit`
          : `Training ${labels[entity.queue[0].unitType]} · ${Math.ceil(entity.queue[0].remaining)}s (${entity.queue.length} queued)${entity.rally ? " · Rally set" : ""}`;
      else if (producer?.id === entity.id)
        detail = entity.rally
          ? `Rally: ${entity.rally.type === "gather" ? "gather supplies" : "move to flag"}`
          : "Ready · Set a production rally";
      hp = entity.maxHp ? `${Math.ceil(entity.hp)} / ${entity.maxHp}` : "";
      health = entity.maxHp ? entity.hp / entity.maxHp : 0;
    } else if (selected.length > 1) {
      title = this.compact
        ? `${selected.length} selected`
        : `${selected.length} units selected`;
      symbol = "⚔";
      const count = (type) => units.filter((u) => u.type === type).length;
      detail = [
        [workers.length, "workers"],
        [count("swordsman"), "melee"],
        [count("archer"), "archers"],
        [count("ram"), "rams"],
        [own.length - units.length, "buildings"],
      ]
        .filter(([n]) => n)
        .map(([n, role]) => `${n} ${role}`)
        .join(" · ");
      const tactical = units.filter((u) =>
        ["assault", "retreat"].includes(u.order.type),
      );
      if (tactical.length)
        detail += ` · ${tactical[0].order.type === "retreat" ? "Retreating" : tactical[0].order.phase || "Regrouping"}`;
      health = 1;
    }
    const queue = producer?.queue?.length
      ? `<div class="queue-list" aria-label="Training queue">${producer.queue.map((q, i) => `<span>${i + 1}. ${labels[q.unitType]}${i === 0 ? ` · ${Math.ceil(q.remaining)}s` : ""}</span>`).join("")}</div>`
      : "";
    const info = `<div class="portrait" aria-hidden="true">${symbol}</div><div class="selection-details"><h3>${title}</h3><p>${detail}</p>${queue}</div>${health ? `<div class="health-track"><span style="width:${Math.max(0, health * 100)}%"></span></div><p class="selection-hp">${hp}</p>` : ""}`;
    if (info !== this.lastSelection) {
      el("selection-info").innerHTML = info;
      this.lastSelection = info;
    }
    const soldiers = units.filter((u) => u.type !== "worker");
    const recruit = (type, building = null) => {
      const queued = (
        building
          ? building.queue
          : state.buildings
              .filter((b) => b.faction === "player")
              .flatMap((b) => b.queue)
      ).filter((q) => q.unitType === type).length;
      const def = UNIT_TYPES[type];
      return action(
        `train-${type}`,
        `${labels[type]}${queued ? ` (${queued})` : ""}`,
        symbols[type],
        !ready(def.producer)
          ? `Needs ${labels[def.producer]}`
          : price(def.cost),
        {
          label: labels[type],
          disabled:
            population(state) >= POPULATION_CAP ||
            !canAfford(state.resources, def.cost) ||
            !ready(def.producer),
        },
      );
    };
    const selectedMode = (type, title, symbol, text, disabled = false) =>
      action(`mode-${type}`, title, symbol, text, {
        active: mode === type,
        disabled,
      });
    el("select-area").classList.toggle("active", mode === "box");
    el("select-area").setAttribute("aria-pressed", String(mode === "box"));
    el("deselect").disabled = !selected.length;
    el("pan-control").classList.toggle("active", mode === "pan");
    el("pan-control").setAttribute("aria-pressed", String(mode === "pan"));
    el("actions").dataset.context = producer
      ? "production"
      : soldiers.length
        ? "military"
        : workers.length
          ? "workers"
          : "empty";
    let actions = "";
    if (mode === "rally") {
      actions =
        action(
          "confirm-rally",
          "Confirm Rally",
          "⚑",
          rallyGhost
            ? rallyGhost.ok
              ? rallyGhost.type === "gather"
                ? "Gather at this source"
                : "Move to this destination"
              : rallyGhost.reason || "Invalid destination"
            : "Tap a destination or resource",
          { disabled: !rallyGhost?.ok },
        ) + action("cancel", "Cancel", "×", "Keep the current rally");
    } else if (buildType) {
      actions =
        action(
          "confirm-build",
          "Place building",
          "✓",
          ghost
            ? ghost.ok
              ? price(BUILDING_TYPES[buildType].cost)
              : ghost.reason || "Invalid location"
            : "Tap a location on the field",
          { disabled: !ghost?.ok },
        ) + action("cancel", "Cancel", "×", "Return to command");
    } else if (this.tab === "build") {
      actions = ["farm", "barracks", "tower", "workshop"]
        .map((type) =>
          action(
            `build-${type}`,
            type === "workshop" ? "Workshop" : labels[type],
            symbols[type],
            price(BUILDING_TYPES[type].cost),
            {
              label: labels[type],
              disabled: !canAfford(state.resources, BUILDING_TYPES[type].cost),
            },
          ),
        )
        .join("");
    } else if (this.tab === "train") {
      actions = ["worker", "swordsman", "archer", "ram"]
        .map((type) => recruit(type))
        .join("");
    } else if (producer) {
      actions =
        Object.keys(UNIT_TYPES)
          .filter((type) => UNIT_TYPES[type].producer === producer.type)
          .map((type) => recruit(type, producer))
          .join("") +
        action(
          "set-rally",
          "Set Rally",
          "⚑",
          producer.type === "townCenter" ? "Move / gather" : "Future recruits",
          { label: "Set Rally Point" },
        ) +
        action("clear-rally", "Clear Rally", "×", "Idle at exit", {
          disabled: !producer.rally,
        });
    } else if (units.length) {
      if (!soldiers.length) {
        actions =
          selectedMode("gather", "Gather", "♧", "Tap a source") +
          action("construct", "Construct", "⚒", "Choose a building") +
          (state.buildings.some(
            (b) => b.faction === "player" && b.progress < 1 && b.hp > 0,
          )
            ? selectedMode("assist", "Assist", "+", "Tap construction")
            : "") +
          selectedMode("move", "Move", "➤", "Choose ground") +
          action("stop", "Stop", "◇", "End assignment");
      } else {
        actions =
          selectedMode("move", "Move", "➤", "Choose ground") +
          selectedMode("attack", "Attack", "⚔", "Target / advance") +
          action("hold", "Hold", "⊙", "Range only · J", {
            label: "Hold Position",
            active: soldiers.every((u) => u.order.type === "hold"),
          }) +
          selectedMode("assault", "Assault", "⚑", "Together · K", false) +
          selectedMode("retreat", "Retreat", "↩", "Regroup · R", false) +
          action("stop", "Stop", "◇", "Defend freely");
      }
    } else {
      actions = `<p class="command-empty">${selected.length ? "Select friendly units to issue orders." : "Tap a unit to command. Hold and drag, or choose Area, to select a group."}</p>`;
    }
    if (actions !== this.lastActions) {
      el("actions").innerHTML = actions;
      this.lastActions = actions;
    }
    el("hint").textContent =
      mode === "box"
        ? "Select Area armed: drag a rectangle over friendly units. Tap Select Area again to cancel."
        : mode === "rally"
          ? rallyGhost
            ? rallyGhost.ok
              ? "Preview ready. Confirm Rally to save this producer's instruction."
              : rallyGhost.reason || "Choose a reachable destination."
            : "Tap a reachable destination. Town Center workers can rally to deposits or farms."
          : mode === "assault"
            ? "Tap an enemy or approach point. Infantry lead, archers support, and rams stay with the force."
            : mode === "retreat"
              ? "Tap reachable ground to regroup. Retreat keeps normal speed and units remain vulnerable."
              : mode === "gather"
                ? "Tap a resource deposit or a completed friendly farm."
                : mode === "assist"
                  ? "Tap an unfinished friendly building to help construct it."
                  : buildType
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
                                ? "Tap ground to move, or an enemy to attack. Hold then drag to select several."
                                : "Right-click to command, or choose Move / Attack then tap."
                              : touch
                                ? "Tap a unit to select. Hold then drag to select several; drag immediately to pan."
                                : "Select a unit. Drag a selection box; WASD to explore.";
    if (performance.now() - this.lastToast > (this.toastDuration || 3600))
      el("toast").classList.remove("visible");
  }
}
