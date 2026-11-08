/** Original, procedural Canvas artwork. Rendering never mutates simulation state. */
const TW = 64;
const TH = 32;
const hash = (x, y = 0) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const PALETTES = {
  player: {
    main: "#347f91",
    light: "#76bac2",
    dark: "#234c62",
    flag: "#a3e4d6",
    edge: "#d9eee1",
  },
  enemy: {
    main: "#ad504c",
    light: "#e08b66",
    dark: "#6d363b",
    flag: "#ffc18d",
    edge: "#f9d7a4",
  },
};

export class Battlefield {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.positions = new Map();
    this.orderMarkers = [];
    this.wrecks = new Map();
    this.resize();
  }

  markOrder(point, kind = "move") {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    this.orderMarkers.push({
      x: point.x,
      y: point.y,
      kind,
      time: performance.now() / 1000,
    });
    if (this.orderMarkers.length > 8) this.orderMarkers.shift();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  worldToScreen(x, y, view) {
    return {
      x: this.width / 2 + (((x - view.x - (y - view.y)) * TW) / 2) * view.zoom,
      y: this.height / 2 + (((x - view.x + (y - view.y)) * TH) / 2) * view.zoom,
    };
  }

  screenToWorld(clientX, clientY, view) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = (clientX - rect.left - this.width / 2) / ((TW / 2) * view.zoom);
    const sy = (clientY - rect.top - this.height / 2) / ((TH / 2) * view.zoom);
    return { x: view.x + (sx + sy) / 2, y: view.y + (sy - sx) / 2 };
  }

  fit(state, view) {
    const home = state.buildings.find(
      (b) => b.faction === "player" && b.type === "townCenter",
    );
    view.x = home ? home.x + home.width / 2 : 9;
    view.y = home ? home.y + home.height / 2 - 1 : 25;
    view.zoom =
      this.height <= 520 && this.width > this.height
        ? 0.9
        : this.width < 600
          ? 0.95
          : clamp(Math.min(this.width / 850, this.height / 580), 1.05, 1.6);
    return view;
  }

  hitTest(state, clientX, clientY, view) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left,
      sy = clientY - rect.top;
    let closest = null,
      distance = Infinity;
    for (const u of state.units) {
      if (u.hp <= 0) continue;
      const p = this.worldToScreen(u.x, u.y, view);
      const d = Math.hypot(p.x - sx, (p.y - sy - 10 * view.zoom) * 0.8);
      if (d < 23 * view.zoom + 7 && d < distance) {
        closest = u;
        distance = d;
      }
    }
    if (closest) return closest;
    const world = this.screenToWorld(clientX, clientY, view);
    for (const b of [...state.buildings].reverse()) {
      if (b.hp <= 0) continue;
      const p = this.worldToScreen(b.x + b.width / 2, b.y + b.height / 2, view);
      const onGround =
        world.x >= b.x &&
        world.x <= b.x + b.width &&
        world.y >= b.y &&
        world.y <= b.y + b.height;
      const roof =
        Math.abs(p.x - sx) < (b.width + b.height) * 13 * view.zoom &&
        sy < p.y &&
        sy > p.y - (b.type === "tower" ? 95 : 85) * view.zoom;
      if (onGround || roof) return b;
    }
    for (const n of state.nodes) {
      if (n.amount <= 0) continue;
      const p = this.worldToScreen(n.x, n.y, view);
      const d = Math.hypot(p.x - sx, (p.y - 15 * view.zoom - sy) * 0.8);
      if (d < 30 * view.zoom + 5 && d < distance) {
        closest = n;
        distance = d;
      }
    }
    return closest;
  }

  draw(
    state,
    view,
    selection = new Set(),
    placementGhost = null,
    frameTime = 0,
  ) {
    const c = this.ctx;
    const selected = selection instanceof Set ? selection : new Set(selection);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = "#152b2b";
    c.fillRect(0, 0, this.width, this.height);
    if (this.cachedMap !== state.map || this.cachedSeed !== state.seed)
      this.buildGround(state);
    const origin = this.worldToScreen(0, 0, view);
    c.save();
    c.translate(origin.x, origin.y);
    c.scale(view.zoom, view.zoom);
    c.drawImage(this.ground, (-state.map.height * TW) / 2 - 20, -20);
    c.restore();
    this.drawWrecks(state, view);

    // Ground order lines and individual slots make group commands legible.
    c.save();
    for (const unit of state.units) {
      if (!selected.has(unit.id) || unit.hp <= 0) continue;
      const type = unit.order?.type;
      if (!["move", "attackMove", "attack", "hold"].includes(type)) continue;
      let target = unit.order;
      if (type === "attack")
        target = [...state.units, ...state.buildings].find(
          (e) => e.id === unit.order.targetId && e.hp > 0,
        );
      if (!target || !Number.isFinite(target.x)) continue;
      const a = this.worldToScreen(unit.x, unit.y, view);
      const b = this.worldToScreen(
        target.x + (target.width || 0) / 2,
        target.y + (target.height || 0) / 2,
        view,
      );
      c.strokeStyle =
        type === "hold"
          ? "#e7d5a680"
          : type.startsWith("attack")
            ? "#f6b58d55"
            : "#b7e8d84a";
      c.lineWidth = 1;
      c.setLineDash([4, 6]);
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
      c.setLineDash([]);
      if (type === "move" || type === "attackMove" || type === "hold")
        this.ellipse(
          b.x,
          b.y,
          6 * view.zoom,
          3 * view.zoom,
          null,
          c.strokeStyle,
        );
    }
    c.restore();

    const entities = [
      ...state.nodes
        .filter((n) => n.amount > 0)
        .map((e) => ({ e, kind: "node", depth: e.x + e.y })),
      ...state.buildings
        .filter((b) => b.hp > 0)
        .map((e) => ({
          e,
          kind: "building",
          depth: e.x + e.y + (e.width + e.height) / 2,
        })),
      ...state.units
        .filter((u) => u.hp > 0)
        .map((e) => ({ e, kind: "unit", depth: e.x + e.y })),
    ].sort((a, b) => a.depth - b.depth || (a.kind === "unit" ? 1 : -1));
    for (const { e, kind } of entities) {
      let ex = e.x,
        ey = e.y;
      if (kind === "building") {
        ex += e.width / 2;
        ey += e.height / 2;
      }
      if (kind === "unit") {
        const old = this.positions.get(e.id);
        if (old && Math.hypot(ex - old.x, ey - old.y) < 3) {
          ex = old.x + (ex - old.x) * 0.46;
          ey = old.y + (ey - old.y) * 0.46;
        }
        this.positions.set(e.id, { x: ex, y: ey });
      }
      const p = this.worldToScreen(ex, ey, view);
      if (
        p.x < -180 * view.zoom ||
        p.x > this.width + 180 * view.zoom ||
        p.y < -100 * view.zoom ||
        p.y > this.height + 170 * view.zoom
      )
        continue;
      c.save();
      c.translate(p.x, p.y);
      c.scale(view.zoom, view.zoom);
      const isSelected = selected.has(e.id);
      if (kind === "node") this.node(e, isSelected);
      else if (kind === "building") this.building(e, state.time, isSelected);
      else this.unit(e, state.time, isSelected);
      if (e.lastHitAt !== undefined && state.time - e.lastHitAt < 0.2) {
        c.save();
        c.globalAlpha = (1 - (state.time - e.lastHitAt) / 0.2) * 0.6;
        this.ellipse(
          0,
          -12,
          kind === "building" ? 28 : 10,
          kind === "building" ? 10 : 5,
          "#ffe6b0",
        );
        c.restore();
      }
      c.restore();
    }
    this.effects(state, view, selected);
    this.drawOrderMarkers(view, frameTime || performance.now() / 1000);
    if (placementGhost) this.ghost(placementGhost, view);
    const vignette = c.createRadialGradient(
      this.width / 2,
      this.height * 0.45,
      this.width * 0.16,
      this.width / 2,
      this.height * 0.45,
      Math.max(this.width, this.height) * 0.72,
    );
    vignette.addColorStop(0, "#061b1700");
    vignette.addColorStop(1, "#041b1748");
    c.fillStyle = vignette;
    c.fillRect(0, 0, this.width, this.height);
  }

  buildGround(state) {
    this.cachedMap = state.map;
    this.cachedSeed = state.seed;
    this.positions.clear();
    const { width, height } = state.map;
    this.ground = document.createElement("canvas");
    this.ground.width = ((width + height) * TW) / 2 + 40;
    this.ground.height = ((width + height) * TH) / 2 + 70;
    const c = this.ground.getContext("2d");
    const ox = (height * TW) / 2 + 20,
      oy = 20;
    const tile = (x, y, inset = 0) => [
      [ox + (x - y) * 32, oy + (x + y) * 16 + inset],
      [ox + (x - y) * 32 + 32 - inset, oy + (x + y) * 16 + 16],
      [ox + (x - y) * 32, oy + (x + y) * 16 + 32 - inset],
      [ox + (x - y) * 32 - 32 + inset, oy + (x + y) * 16 + 16],
    ];
    const terrain = (x, y) => state.map.terrain?.[y]?.[x] || "grass";
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const t = terrain(x, y),
          n = hash(x + (state.seed || 0), y);
        const px = ox + (x - y) * 32,
          py = oy + (x + y) * 16 + 16;
        if (y === height - 1 || x === width - 1) {
          this.poly(
            tile(x, y).map(([a, b]) => [a, b + 12]),
            "#293d35",
            null,
            c,
          );
        }
        const meadow =
          0.5 +
          Math.sin(x * 0.28 + y * 0.18) * 0.2 +
          Math.cos(y * 0.33 - x * 0.11) * 0.16 +
          (n - 0.5) * 0.12;
        let fill = `hsl(${105 + meadow * 7} 25% ${31 + meadow * 3}%)`;
        if (t === "road") fill = `hsl(39 27% ${45 + n * 2}%)`;
        if (t === "water") fill = `hsl(${178 + n * 7} 27% ${25 + n * 6}%)`;
        if (t === "ridge") fill = `hsl(91 10% ${35 + n * 6}%)`;
        this.poly(tile(x, y), fill, fill, c, 1.2);
        if (t === "water") {
          c.strokeStyle = "#77aa9c38";
          c.lineWidth = 1;
          for (let i = 0; i < 3; i++) {
            const a = hash(x * 7 + i, y);
            c.beginPath();
            c.moveTo(px - 16 + a * 19, py - 7 + i * 6);
            c.lineTo(px - 2 + a * 23, py - 7 + i * 6);
            c.stroke();
          }
          if (terrain(x - 1, y) === "grass")
            this.line(
              [
                [px - 27, py - 2],
                [px - 5, py - 13],
              ],
              "#a5bd8f45",
              1,
              c,
            );
          if (terrain(x, y + 1) === "grass")
            this.line(
              [
                [px - 27, py + 2],
                [px - 5, py + 13],
              ],
              "#a5bd8f45",
              1,
              c,
            );
        } else if (t === "ridge") {
          for (let i = 0; i < 2; i++)
            this.rock(
              c,
              px + (i - 0.5) * 21,
              py + i * 3,
              0.7 + n * 0.45,
              false,
            );
        } else {
          for (let i = 0; i < (t === "road" ? 3 : 8); i++) {
            const a = hash(x * 13 + i, y * 3),
              b = hash(x * 3 + i, y * 11);
            const gx = px + (a - b) * 28,
              gy = py + (a + b - 1) * 13;
            if (t === "road") {
              c.fillStyle = "#615a3d24";
              c.fillRect(gx, gy, 2 + n * 3, 1);
            } else {
              c.strokeStyle = i % 3 === 0 ? "#acc47c35" : "#244d3228";
              c.beginPath();
              c.moveTo(gx - 2, gy - 2);
              c.lineTo(gx, gy);
              c.lineTo(gx + 1, gy - 3);
              c.stroke();
              if (n > 0.89 && i < 3) {
                c.fillStyle = "#cfc88088";
                c.fillRect(gx + 4, gy + 2, 1.5, 1.5);
              }
            }
          }
        }
      }
    // Tiny discarded stones and wildflowers soften the regular terrain at no per-frame cost.
    for (let i = 0; i < (width * height) / 8; i++) {
      const x = Math.floor(hash(i, state.seed) * width),
        y = Math.floor(hash(i + 4, state.seed) * height);
      if (terrain(x, y) !== "grass") continue;
      const px = ox + (x - y) * 32,
        py = oy + (x + y) * 16;
      c.fillStyle = "#c6c99566";
      c.beginPath();
      c.ellipse(px + 9, py + 18, 2, 1, -0.2, 0, 7);
      c.fill();
    }
  }

  poly(points, fill, stroke = null, c = this.ctx, lineWidth = 1) {
    c.beginPath();
    c.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) c.lineTo(...points[i]);
    c.closePath();
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = lineWidth;
      c.stroke();
    }
  }

  ellipse(x, y, rx, ry, fill, stroke = null, c = this.ctx) {
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 1.5;
      c.stroke();
    }
  }

  line(points, stroke, width = 1, c = this.ctx) {
    c.beginPath();
    c.moveTo(...points[0]);
    for (const p of points.slice(1)) c.lineTo(...p);
    c.strokeStyle = stroke;
    c.lineWidth = width;
    c.lineJoin = "round";
    c.lineCap = "round";
    c.stroke();
  }

  prism(cx, cy, w, d, h, top, left = "#aca991", right = "#777b6b") {
    const p = [
      [cx, cy - d],
      [cx + w, cy],
      [cx, cy + d],
      [cx - w, cy],
    ];
    this.poly(
      [p[3], p[2], [cx, cy + d - h], [cx - w, cy - h]],
      left,
      "#263b3d44",
    );
    this.poly(
      [p[2], p[1], [cx + w, cy - h], [cx, cy + d - h]],
      right,
      "#263b3d44",
    );
    this.poly(
      p.map(([x, y]) => [x, y - h]),
      top,
      "#dbe0c222",
    );
  }

  roof(x, y, w, d, h, palette) {
    this.poly(
      [
        [x - w, y],
        [x, y + d],
        [x + w, y],
        [x, y - d - h],
      ],
      palette.main,
      "#173c4355",
    );
    this.poly(
      [
        [x - w, y],
        [x, y - d - h],
        [x, y + d - h * 0.4],
      ],
      palette.light,
      "#173c4344",
    );
    this.poly(
      [
        [x, y - d - h],
        [x + w, y],
        [x, y + d - h * 0.4],
      ],
      palette.dark,
      "#173c4344",
    );
    this.line(
      [
        [x - w, y + 1],
        [x, y + d + 1],
        [x + w, y + 1],
      ],
      "#c5c5a8",
      2,
    );
    for (let i = 1; i < 5; i++) {
      const f = i / 5;
      this.line(
        [
          [x - w * (1 - f), y - (d + h) * f],
          [x, y + d - (2 * d + h * 0.4) * f],
        ],
        "#d2e7d222",
        1,
      );
      this.line(
        [
          [x + w * (1 - f), y - (d + h) * f],
          [x, y + d - (2 * d + h * 0.4) * f],
        ],
        "#082d3b44",
        1,
      );
    }
  }

  flag(x, y, p, time, scale = 1) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.scale(scale, scale);
    this.line(
      [
        [0, 7],
        [0, -32],
      ],
      "#d1c09a",
      2,
    );
    const wave = Math.sin(time * 3 + x) * 2;
    this.poly(
      [
        [1, -31],
        [20, -28 + wave],
        [16, -20 + wave],
        [1, -22],
      ],
      p.main,
      "#e5dbc355",
    );
    this.poly(
      [
        [5, -28],
        [8, -25],
        [5, -23],
        [3, -26],
      ],
      p.flag,
    );
    c.restore();
  }

  building(b, time, selected) {
    const c = this.ctx,
      p = PALETTES[b.faction] || PALETTES.enemy;
    const w = b.width * 32,
      d = b.height * 16,
      progress = b.progress ?? 1;
    this.ellipse(
      5,
      7,
      Math.max(30, w * 0.85),
      Math.max(15, d * 0.8),
      "#122f2670",
    );
    if (selected) {
      this.poly(
        [
          [0, -d - 4],
          [w + 5, 0],
          [0, d + 5],
          [-w - 5, 0],
        ],
        "#a9e1c214",
        b.faction === "player" ? "#afeed2" : "#f4a178",
        c,
        2,
      );
      if (b.type === "tower") {
        c.save();
        c.setLineDash([4, 6]);
        this.ellipse(0, 0, 6 * 32, 6 * 16, null, "#d0e9bd42");
        c.restore();
      }
    }
    if (progress < 1) {
      this.prism(0, 0, w * 0.88, d * 0.88, 5, "#a79e76", "#817b62", "#6b705a");
      this.prism(
        0,
        -3,
        w * 0.69,
        d * 0.69,
        7 + 23 * progress,
        "#c7c4a0",
        "#b3ab8b",
        "#8d9278",
      );
      const top = -22 - progress * 34;
      this.line(
        [
          [-w * 0.7, 0],
          [-w * 0.7, top],
          [0, top + d * 0.6],
          [0, d * 0.7],
        ],
        "#cab183",
        3,
      );
      this.line(
        [
          [w * 0.7, 0],
          [w * 0.7, top],
          [0, top + d * 0.6],
        ],
        "#90764f",
        3,
      );
      this.line(
        [
          [-w * 0.7, top * 0.35],
          [0, top * 0.8 + d * 0.6],
          [w * 0.7, top * 0.35],
        ],
        "#cab183",
        2,
      );
      this.line(
        [
          [-w * 0.7, top],
          [0, d * 0.7],
        ],
        "#8c754c",
        2,
      );
      this.healthBar(0, top - 10, 48, progress, "#e8bf74");
      return;
    }
    if (b.type === "farm") {
      this.poly(
        [
          [0, -d],
          [w, 0],
          [0, d],
          [-w, 0],
        ],
        "#76684a",
        "#bc9b63",
        c,
        2,
      );
      for (let row = -2; row <= 2; row++) {
        const cy = row * 5;
        for (let col = -3; col <= 3; col++) {
          const cx = col * 10 + row * 4;
          if (Math.abs(cx) / w + Math.abs(cy) / d > 0.82) continue;
          this.line(
            [
              [cx, cy + 3],
              [cx + Math.sin(time * 1.2 + col) * 1.2, cy - 9],
            ],
            "#c9aa59",
            2,
          );
          this.line(
            [
              [cx - 4, cy - 4],
              [cx, cy - 7],
              [cx + 3, cy - 5],
            ],
            "#e0c47b",
            1.5,
          );
        }
      }
      for (const [fx, fy] of [
        [0, -d],
        [w, 0],
        [0, d],
        [-w, 0],
      ])
        this.line(
          [
            [fx, fy + 1],
            [fx, fy - 10],
          ],
          "#baa078",
          2,
        );
      this.line(
        [
          [-w, -5],
          [0, d - 5],
          [w, -5],
        ],
        "#baa078",
        1.5,
      );
      this.prism(-19, -12, 13, 7, 15, "#c6b28b", "#c3b18b", "#918a65");
      this.roof(-19, -27, 17, 8, 9, p);
    } else if (b.type === "tower") {
      this.prism(0, 0, 25, 13, 8, "#c3c1a1", "#acae96", "#8b9886");
      this.prism(0, -8, 17, 9, 55, "#d4d2b4", "#c4c5a8", "#909f91");
      for (let i = 0; i < 4; i++)
        this.line(
          [
            [-16, -16 - i * 11],
            [0, -8 - i * 11],
            [16, -16 - i * 11],
          ],
          "#667e7155",
        );
      this.prism(0, -62, 24, 12, 10, "#d4d6b9", "#c3c7ac", "#94a392");
      for (const [x, y] of [
        [-18, -64],
        [-5, -58],
        [9, -61],
        [18, -66],
      ])
        this.prism(x, y, 5, 3, 9, "#e0dfc2", "#c9ccb2", "#9ea993");
      this.poly(
        [
          [-7, -55],
          [-1, -52],
          [-1, -36],
          [-7, -39],
        ],
        p.main,
      );
      this.poly(
        [
          [4, -38],
          [9, -41],
          [9, -30],
          [4, -27],
        ],
        "#2b4846",
      );
      this.flag(1, -69, p, time, 0.8);
    } else if (b.type === "barracks") {
      this.prism(0, 0, w * 0.87, d * 0.88, 5, "#a69f7a", "#8d9576", "#697e69");
      this.prism(0, -5, w * 0.7, d * 0.72, 28, "#cfc8a7", "#c9bc95", "#989d80");
      this.roof(0, -34, w * 0.82, d * 0.87, 17, p);
      this.poly(
        [
          [-20, -22],
          [-7, -15],
          [-7, 5],
          [-20, -1],
        ],
        "#394d43",
      );
      this.line(
        [
          [-24, -25],
          [-24, -1],
        ],
        "#8a6e48",
        3,
      );
      this.line(
        [
          [-4, -15],
          [-4, 9],
        ],
        "#8a6e48",
        3,
      );
      this.prism(23, 8, 10, 5, 11, "#a9966a", "#9c875f", "#756c4b");
      for (const x of [25, 30, 34])
        this.line(
          [
            [x, -1],
            [x - 3, -23],
          ],
          "#c6ccbd",
          1.6,
        );
      this.poly(
        [
          [17, -11],
          [24, -9],
          [24, 0],
          [20, 4],
          [16, -1],
        ],
        p.main,
        "#d9d9b9",
      );
      this.flag(-24, -48, p, time, 0.85);
    } else {
      this.prism(0, 0, w * 0.9, d * 0.9, 6, "#b2aa88", "#99a088", "#788d79");
      this.prism(
        0,
        -6,
        w * 0.72,
        d * 0.72,
        30,
        "#ded4ae",
        "#d3c8a4",
        "#9dab90",
      );
      this.roof(0, -38, w * 0.84, d * 0.83, 19, p);
      this.prism(6, -38, 21, 11, 29, "#d9d5b6", "#d9d0ad", "#9aab96");
      this.roof(6, -69, 29, 15, 18, p);
      this.poly(
        [
          [-31, -20],
          [-15, -12],
          [-15, 7],
          [-31, -1],
        ],
        "#3f5145",
      );
      this.poly(
        [
          [-28, -19],
          [-18, -14],
          [-18, 5],
          [-28, 0],
        ],
        "#6e674a",
      );
      this.line(
        [
          [-22, -14],
          [-22, 2],
        ],
        "#bdae76",
        1.3,
      );
      this.poly(
        [
          [20, -25],
          [29, -29],
          [29, -18],
          [20, -13],
        ],
        "#314d4a",
      );
      this.line(
        [
          [24, -26],
          [24, -16],
        ],
        "#e1c784",
        1.5,
      );
      this.poly(
        [
          [1, -59],
          [9, -55],
          [9, -45],
          [1, -49],
        ],
        "#304a47",
      );
      this.flag(6, -88, p, time);
      this.prism(-43, 5, 10, 6, 10, "#c9bd91", "#9e956f", "#7d8664");
      this.prism(-37, 10, 8, 4, 7, "#c1b187", "#a59973", "#7b8464");
      this.line(
        [
          [42, 5],
          [42, -17],
        ],
        "#6d7451",
        2,
      );
      this.ellipse(42, -19, 6, 4, "#dabf73");
    }
    const h =
      b.type === "tower"
        ? 112
        : b.type === "farm"
          ? 53
          : b.type === "townCenter"
            ? 130
            : 88;
    if (selected || b.hp < b.maxHp)
      this.healthBar(
        0,
        -h,
        Math.min(64, w),
        b.hp / b.maxHp,
        b.faction === "player" ? "#99d8b2" : "#e69475",
      );
    if (b.queue?.length) {
      this.ellipse(w * 0.7, 8, 8, 5, "#253d3ce8", "#edcd8b");
      c.font = "bold 9px sans-serif";
      c.textAlign = "center";
      c.fillStyle = "#f3dfb9";
      c.fillText(String(b.queue.length), w * 0.7, 11);
    }
  }

  healthBar(x, y, width, fraction, color) {
    const c = this.ctx;
    c.fillStyle = "#152a29dd";
    c.fillRect(x - width / 2 - 1, y - 1, width + 2, 6);
    c.fillStyle = color;
    c.fillRect(x - width / 2, y, width * clamp(fraction, 0, 1), 4);
  }

  tree(x, y, size, variant = 0) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.scale(size, size);
    this.ellipse(6, 3, 18, 8, "#173c2b50");
    this.poly(
      [
        [-3, 0],
        [2, 1],
        [5, -31],
        [-1, -35],
      ],
      "#716d46",
    );
    this.line(
      [
        [1, -15],
        [-9, -27],
      ],
      "#666b43",
      2.5,
    );
    if (variant > 0.52) {
      this.poly(
        [
          [-22, -18],
          [0, -55],
          [24, -19],
          [12, -13],
          [-7, -11],
        ],
        "#295f45",
      );
      this.poly(
        [
          [-18, -30],
          [0, -66],
          [19, -30],
          [7, -24],
          [-7, -23],
        ],
        "#38764d",
      );
      this.poly(
        [
          [-12, -43],
          [0, -74],
          [12, -43],
          [1, -36],
        ],
        "#598657",
      );
      this.poly(
        [
          [0, -71],
          [1, -38],
          [13, -44],
        ],
        "#35744c",
      );
    } else {
      this.ellipse(-9, -30, 16, 16, "#356747");
      this.ellipse(11, -33, 17, 16, "#2e6646");
      this.ellipse(0, -46, 18, 20, "#4b8052");
      this.ellipse(-8, -49, 10, 12, "#618f5a");
      this.ellipse(9, -53, 11, 11, "#578955");
      this.ellipse(14, -29, 11, 9, "#37734c");
      this.ellipse(-12, -34, 9, 7, "#57834b");
    }
    c.restore();
  }

  rock(c, x, y, scale, gold) {
    c.save();
    c.translate(x, y);
    c.scale(scale, scale);
    this.ellipse(4, 2, 17, 7, "#23473666", null, c);
    this.poly(
      [
        [-18, -3],
        [-11, -19],
        [3, -26],
        [19, -12],
        [21, 0],
        [4, 8],
      ],
      "#82928c",
      "#3c625955",
      c,
    );
    this.poly(
      [
        [-11, -19],
        [3, -26],
        [3, -6],
        [-18, -3],
      ],
      "#a7afa0",
      null,
      c,
    );
    this.poly(
      [
        [3, -26],
        [19, -12],
        [3, -6],
      ],
      "#95a49a",
      null,
      c,
    );
    this.poly(
      [
        [3, -6],
        [19, -12],
        [21, 0],
        [4, 8],
      ],
      "#657f78",
      null,
      c,
    );
    if (gold) {
      this.line(
        [
          [-8, -14],
          [-2, -16],
          [1, -9],
          [7, -11],
        ],
        "#e0bd62",
        3,
        c,
      );
      this.poly(
        [
          [9, -19],
          [15, -14],
          [10, -11],
          [6, -15],
        ],
        "#e5c878",
        "#a1884a",
        c,
      );
      this.poly(
        [
          [-8, -2],
          [-1, -5],
          [2, -1],
          [-4, 3],
        ],
        "#d3b868",
        null,
        c,
      );
    }
    c.restore();
  }

  node(n, selected) {
    const c = this.ctx;
    if (selected) this.ellipse(0, 0, 31, 15, "#bde9bc18", "#d4e7b6");
    const key =
      typeof n.id === "number"
        ? n.id
        : String(n.id)
            .split("")
            .reduce((a, v) => a + v.charCodeAt(0), 0);
    if (n.type === "wood") {
      this.tree(-15, -6, 0.66 + hash(key) * 0.18, hash(key, 2));
      this.tree(14, -2, 0.72 + hash(key, 4) * 0.13, hash(key, 3));
      this.tree(-3, 8, 0.82 + hash(key, 1) * 0.15, hash(key));
    } else if (n.type === "stone" || n.type === "gold") {
      this.rock(c, -12, -3, 0.9, n.type === "gold");
      this.rock(c, 14, 0, 0.7, n.type === "gold");
      this.rock(c, -2, 8, 0.75, n.type === "gold");
    } else {
      this.ellipse(3, 3, 25, 10, "#24452b66");
      for (let i = 0; i < 5; i++) {
        const x = Math.cos(i * 2.1) * 15,
          y = Math.sin(i * 2.1) * 6;
        this.ellipse(x, y - 6, 10, 9, i % 2 ? "#749054" : "#5b8348");
        for (let j = 0; j < 3; j++)
          this.ellipse(
            x + hash(i, j) * 12 - 6,
            y - 8 + hash(j, i) * 5,
            2,
            2,
            "#d6a66a",
          );
      }
    }
    if (selected) {
      c.font = "bold 10px sans-serif";
      c.textAlign = "center";
      c.fillStyle = "#f3e4ba";
      c.shadowColor = "#152e29";
      c.shadowBlur = 4;
      c.fillText(`${Math.ceil(n.amount)} ${n.type}`, 0, 25);
      c.shadowBlur = 0;
    }
  }

  unit(u, time, selected) {
    const c = this.ctx,
      p = PALETTES[u.faction] || PALETTES.enemy;
    const active = u.order && !["idle", "stop"].includes(u.order.type);
    const walk = active
      ? Math.sin(time * 9 + (Number(u.id) || String(u.id).length) * 2)
      : 0;
    const bob = active ? Math.abs(walk) * 0.8 : Math.sin(time * 2) * 0.2;
    this.ellipse(2, 1, 9, 4.5, "#102f275e");
    if (selected)
      this.ellipse(
        0,
        0,
        12,
        6,
        "#b0eddc18",
        u.faction === "player" ? "#b4efdb" : "#ffb896",
      );
    c.save();
    c.translate(0, -bob);
    this.line(
      [
        [-3, -8],
        [-4 - walk * 2, -2],
      ],
      "#33423d",
      3,
    );
    this.line(
      [
        [3, -8],
        [4 + walk * 2, -2],
      ],
      "#33423d",
      3,
    );
    this.line(
      [
        [-5 - walk * 2, -1],
        [-2 - walk * 2, -1],
      ],
      "#cec9af",
      2,
    );
    this.line(
      [
        [2 + walk * 2, -1],
        [5 + walk * 2, -1],
      ],
      "#cec9af",
      2,
    );
    if (u.type === "worker") {
      this.poly(
        [
          [-5, -20],
          [3, -20],
          [6, -8],
          [-6, -8],
        ],
        "#c4b07c",
        "#6e7055",
      );
      this.poly(
        [
          [-5, -18],
          [-1, -16],
          [-1, -9],
          [-5, -10],
        ],
        p.main,
      );
      this.ellipse(0, -25, 4.5, 5, "#d9bf8d");
      this.poly(
        [
          [-7, -26],
          [0, -30],
          [7, -26],
          [4, -24],
          [-7, -24],
        ],
        "#c6b175",
        "#8b885d",
      );
      this.line(
        [
          [6, -15],
          [10, -12 + walk * 2],
        ],
        "#d3b88b",
        2.5,
      );
      const gathering = ["gather", "build"].includes(u.order?.type);
      this.line(
        [
          [8, -5],
          [12 + (gathering ? walk * 4 : 0), -23],
        ],
        "#9b825a",
        2,
      );
      this.line(
        [
          [8, -23],
          [17, -20],
        ],
        "#bcc5af",
        2.5,
      );
      if (u.carry?.amount || u.carried || u.cargo?.amount)
        this.prism(-8, -10, 4, 3, 7, "#d6b178", "#b3915d", "#8d784d");
    } else if (u.type === "archer" || u.type === "enemyArcher") {
      this.poly(
        [
          [-6, -21],
          [4, -21],
          [8, -6],
          [-8, -6],
        ],
        p.dark,
        "#263e3f",
      );
      this.poly(
        [
          [-3, -20],
          [3, -20],
          [5, -8],
          [-5, -8],
        ],
        p.main,
      );
      this.ellipse(0, -25, 4, 5, "#d3ba8b");
      this.poly(
        [
          [-6, -25],
          [-3, -31],
          [3, -30],
          [6, -24],
          [0, -27],
        ],
        p.main,
        "#c1d7ba44",
      );
      this.line(
        [
          [5, -18],
          [10, -16],
        ],
        "#d3ba8b",
        2.5,
      );
      c.beginPath();
      c.moveTo(9, -25);
      c.quadraticCurveTo(19, -15, 9, -5);
      c.strokeStyle = "#d1ab69";
      c.lineWidth = 2;
      c.stroke();
      this.line(
        [
          [9, -25],
          [10, -5],
        ],
        "#e8dab2",
        0.7,
      );
      this.line(
        [
          [-6, -27],
          [-10, -10],
        ],
        "#8d7352",
        3,
      );
      this.line(
        [
          [-8, -27],
          [-4, -26],
        ],
        "#dfd2a4",
        1,
      );
    } else {
      this.poly(
        [
          [-5, -22],
          [5, -22],
          [7, -8],
          [-7, -8],
        ],
        p.main,
        "#243c3e",
      );
      this.poly(
        [
          [-5, -21],
          [5, -21],
          [4, -14],
          [-4, -14],
        ],
        "#b4c2b5",
        "#5c837e",
      );
      this.ellipse(0, -26, 5, 5, "#d1bc91");
      this.poly(
        [
          [-6, -26],
          [-4, -31],
          [3, -32],
          [6, -27],
          [6, -24],
          [-6, -24],
        ],
        "#bfcac0",
        "#5f7b78",
      );
      this.line(
        [
          [-3, -25],
          [3, -25],
        ],
        "#344e4d",
        1,
      );
      this.poly(
        [
          [-10, -19],
          [-3, -17],
          [-4, -8],
          [-8, -5],
          [-12, -11],
        ],
        p.main,
        "#d4d7b9",
        c,
        1.3,
      );
      this.line(
        [
          [-8, -17],
          [-8, -8],
        ],
        "#d6dfbf",
        1.3,
      );
      this.line(
        [
          [7, -14],
          [12, -20 + walk],
        ],
        "#d8bd8c",
        2.5,
      );
      this.line(
        [
          [12, -16],
          [14, -31 + walk],
        ],
        "#dce1ce",
        2,
      );
      this.line(
        [
          [9, -20],
          [16, -19],
        ],
        "#d4bb7c",
        2,
      );
    }
    c.restore();
    if (selected || u.hp < u.maxHp || time - (u.lastAttackAt ?? -10) < 3)
      this.healthBar(
        0,
        -39,
        24,
        u.hp / u.maxHp,
        u.faction === "player" ? "#b4e2ba" : "#efa080",
      );
    if (selected && ["idle", "hold"].includes(u.order?.type)) {
      c.fillStyle = "#f4d893";
      c.beginPath();
      c.arc(13, -23, 2, 0, 7);
      c.fill();
      if (u.order.type === "hold") {
        this.ellipse(0, 0, 16, 8, null, "#f4d893");
        this.line(
          [
            [-4, -8],
            [4, -8],
          ],
          "#f4d893",
          2,
        );
      }
    }
  }

  drawWrecks(state, view) {
    if (this.wreckMap !== state.map) {
      this.wreckMap = state.map;
      this.wrecks.clear();
    }
    for (const e of state.events)
      if (e.type === "death" && !this.wrecks.has(e.id))
        this.wrecks.set(e.id, e);
    const c = this.ctx;
    for (const [id, e] of this.wrecks) {
      const age = state.time - e.time;
      if (age > 6) {
        this.wrecks.delete(id);
        continue;
      }
      const p = this.worldToScreen(e.x, e.y, view),
        z = view.zoom;
      c.save();
      c.translate(p.x, p.y);
      c.scale(z, z);
      c.globalAlpha = Math.min(1, (6 - age) / 2);
      this.ellipse(0, 0, e.width ? 32 : 12, e.width ? 13 : 5, "#17282065");
      for (let i = 0; i < (e.width ? 7 : 3); i++) {
        const x = (hash(id + i, e.x) - 0.5) * (e.width ? 65 : 18),
          y = (hash(i, e.y) - 0.5) * 15;
        this.poly(
          [
            [x - 5, y],
            [x - 2, y - 5],
            [x + 5, y - 3],
            [x + 7, y + 1],
            [x, y + 3],
          ],
          e.width ? (i % 2 ? "#8b8871" : "#a3a083") : "#787b69",
        );
      }
      c.restore();
    }
  }

  impact(point, zoom, age, large = false) {
    const c = this.ctx;
    const duration = large ? 0.9 : 0.4;
    if (age < 0 || age > duration) return;
    c.save();
    c.globalAlpha *= 1 - age / duration;
    for (let i = 0; i < (large ? 7 : 4); i++) {
      const a = i * 2.4,
        r = (4 + age * (large ? 45 : 30)) * zoom;
      this.line(
        [
          [
            point.x + Math.cos(a) * r,
            point.y - 12 * zoom + Math.sin(a) * r * 0.6,
          ],
          [
            point.x + Math.cos(a) * (r + 5 * zoom),
            point.y - 12 * zoom + Math.sin(a) * (r + 5 * zoom) * 0.6,
          ],
        ],
        large ? "#d1b58c" : "#ffe3a0",
        large ? 4 * zoom : 1.7 * zoom,
      );
    }
    c.restore();
  }

  effects(state, view, selected) {
    const c = this.ctx;
    for (const e of state.events || []) {
      const age = state.time - e.time;
      if (
        age < 0 ||
        age > 1.1 ||
        !Number.isFinite(e.x) ||
        !Number.isFinite(e.y)
      )
        continue;
      const p = this.worldToScreen(e.x, e.y, view),
        z = view.zoom;
      c.save();
      c.globalAlpha = clamp(1 - age / 0.8, 0, 1);
      if (
        (e.ranged || ["shot", "projectile"].includes(e.type)) &&
        Number.isFinite(e.targetX) &&
        Number.isFinite(e.targetY)
      ) {
        const target = this.worldToScreen(e.targetX, e.targetY, view),
          f = clamp(age / 0.32, 0, 1);
        const x = p.x + (target.x - p.x) * f,
          y = p.y + (target.y - p.y) * f - Math.sin(f * Math.PI) * 32 * z;
        if (age < 0.32)
          this.line(
            [
              [
                x - (target.x - p.x) * 0.035,
                y - (target.y - p.y) * 0.035 - 15 * z,
              ],
              [x, y - 15 * z],
            ],
            "#eee0a3",
            1.6 * z,
          );
        this.impact(target, z, age - 0.24);
      } else if (["hit", "damage", "attack"].includes(e.type)) {
        const hit = Number.isFinite(e.targetX)
          ? this.worldToScreen(e.targetX, e.targetY, view)
          : p;
        for (let i = 0; i < 4; i++) {
          const a = i * 1.7 + age * 3,
            r = age * 22 * z;
          this.line(
            [
              [hit.x + Math.cos(a) * r, hit.y - 13 * z + Math.sin(a) * r * 0.6],
              [
                hit.x + Math.cos(a) * (r + 4 * z),
                hit.y - 13 * z + Math.sin(a) * (r + 4 * z) * 0.6,
              ],
            ],
            "#ffdb8b",
            2 * z,
          );
        }
      } else if (["death", "destroyed"].includes(e.type)) {
        this.ellipse(p.x, p.y, age * 28 * z, age * 12 * z, "#ceb98555");
        this.impact(p, z, age, !!e.width);
      } else if (["order", "move"].includes(e.type))
        this.ellipse(
          p.x,
          p.y,
          (8 + age * 15) * z,
          (4 + age * 7) * z,
          null,
          "#b9e5c6",
        );
      if (e.type === "attack" && selected?.has(e.targetId) && age > 0.18) {
        const hit = this.worldToScreen(e.targetX, e.targetY, view);
        c.fillStyle = "#ffe3b4";
        c.font = `bold ${Math.max(10, 11 * z)}px Arial`;
        c.textAlign = "center";
        c.fillText(`−${e.damage}`, hit.x, hit.y - (30 + age * 18) * z);
      }
      c.restore();
    }
  }

  drawOrderMarkers(view, now) {
    this.orderMarkers = this.orderMarkers.filter(
      (marker) => now - marker.time < 1.15,
    );
    const c = this.ctx;
    for (const marker of this.orderMarkers) {
      const age = Math.max(0, now - marker.time),
        p = this.worldToScreen(marker.x, marker.y, view);
      const attack = marker.kind.startsWith("attack"),
        color = attack ? "#f4c18a" : "#b5f2de";
      const r = 16 + Math.max(0, 1 - age * 4) * 16;
      c.save();
      c.translate(p.x, p.y);
      c.scale(view.zoom, view.zoom);
      c.globalAlpha = clamp((1.15 - age) * 2, 0, 1);
      this.ellipse(0, 0, 12 + age * 13, 6 + age * 6.5, null, color);
      this.line(
        [
          [-r, -3],
          [-r - 6, 0],
          [-r, 3],
        ],
        color,
        2,
      );
      this.line(
        [
          [r, -3],
          [r + 6, 0],
          [r, 3],
        ],
        color,
        2,
      );
      this.line(
        [
          [-5, -r * 0.5],
          [0, -r * 0.5 - 3],
          [5, -r * 0.5],
        ],
        color,
        2,
      );
      this.line(
        [
          [-5, r * 0.5],
          [0, r * 0.5 + 3],
          [5, r * 0.5],
        ],
        color,
        2,
      );
      if (attack) {
        this.line(
          [
            [-4, -4],
            [4, 4],
          ],
          color,
          1.8,
        );
        this.line(
          [
            [4, -4],
            [-4, 4],
          ],
          color,
          1.8,
        );
      } else this.ellipse(0, 0, 2.5, 1.3, color);
      c.restore();
    }
  }

  ghost(g, view) {
    const p = this.worldToScreen(
      g.x + (g.width || 2) / 2,
      g.y + (g.height || 2) / 2,
      view,
    );
    const c = this.ctx,
      w = (g.width || 2) * 32,
      d = (g.height || 2) * 16;
    c.save();
    c.translate(p.x, p.y);
    c.scale(view.zoom, view.zoom);
    this.poly(
      [
        [0, -d],
        [w, 0],
        [0, d],
        [-w, 0],
      ],
      g.ok ? "#aee7b54d" : "#e67f7455",
      g.ok ? "#d2f2bd" : "#ffd0a7",
      c,
      2,
    );
    c.globalAlpha = 0.52;
    this.building(
      {
        ...g,
        faction: "player",
        progress: 1,
        hp: 1,
        maxHp: 1,
        width: g.width || 2,
        height: g.height || 2,
      },
      0,
      false,
    );
    c.restore();
  }
}
