/*
 * Statistik-Grenzlinie-Karte für Home Assistant  –  v1.0.0
 * Zeigt die normale Statistik-Grafik von Home Assistant (statistics-graph) und zieht eine rote
 * Linie bei der eingestellten kWh-Anzeige (max_y_axis) – aber nur, wenn im gezeigten Zeitraum
 * ein Wert darüber liegt. Bleibt alles darunter, sieht die Grafik aus wie bisher.
 *
 * Alle Optionen der Statistik-Grafik gelten unverändert, dazu:
 * type: custom:statistik-grenzlinie-card
 * max_y_axis: 10            # eingestellte Anzeige – hier liegt die rote Linie
 * fit_y_data: true          # damit höhere Werte nicht abgeschnitten werden
 * grenze: 10                # optional, Linie woanders als bei max_y_axis
 * grenze_farbe: "#db4437"   # optional, sonst die Fehlerfarbe des Themes (rot)
 * grenze_text: false        # optional, Beschriftung an der Linie ausblenden (oder eigener Text)
 *
 * Die Linie wird in die Grafik von Home Assistant eingesetzt. Ändert ein Update deren Aufbau,
 * fehlt nur die Linie – die Grafik selbst bleibt (Hinweis in der Browser-Konsole).
 *
 * Quelle: https://github.com/bryce2071/statistik-grenzlinie-card (MIT-Lizenz)
 */
(() => {
  const TAG = "statistik-grenzlinie-card";
  const VERSION = "1.0.0";
  if (customElements.get(TAG)) return;

  const LINE_ID = "statistik-grenzlinie";
  const HOOK = "__statistikGrenzlinie";
  const EPS = 1e-9;

  const ensureArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
  const toMs = (v) =>
    v instanceof Date ? v.getTime() : typeof v === "number" ? v : typeof v === "string" && v ? Date.parse(v) : NaN;
  const pointOf = (p) =>
    Array.isArray(p) ? p : p && typeof p === "object" && Array.isArray(p.value) ? p.value : null;

  // Höchster Wert je Zeitpunkt; Reihen im selben Stapel werden zusammengezählt
  const peakOf = (series) => {
    const sums = new Map();
    const xs = new Set();
    let peak = -Infinity;
    series.forEach((s, i) => {
      if (!s || (s.type !== "bar" && s.type !== "line") || !Array.isArray(s.data)) return;
      const group = s.stack ? `stapel:${s.stack}` : `reihe:${i}`;
      s.data.forEach((p) => {
        const v = pointOf(p);
        if (!v || v[1] === null || v[1] === undefined || v[1] === "") return;
        const x = toMs(v[0]);
        const y = Number(v[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        xs.add(x);
        const key = `${group}|${x}`;
        const total = (sums.get(key) || 0) + y;
        sums.set(key, total);
        if (total > peak) peak = total;
      });
    });
    return { peak, xs: [...xs].sort((a, b) => a - b) };
  };

  // Eigene Reihe für die Linie: zeichnet quer über die ganze Diagrammfläche, ohne Tooltip
  const lineSeries = (xs, limit, look) => ({
    id: LINE_ID,
    name: look.name,
    type: "custom",
    data: xs.map((x) => [x, limit]),
    encode: { x: 0, y: 1 },
    silent: true,
    tooltip: { show: false },
    animation: false,
    z: 10,
    renderItem: (params, api) => {
      // Ein Datenpunkt je Balken, damit beim Zoomen immer einer sichtbar ist – gezeichnet wird einmal
      if (params.dataIndexInside !== 0) return null;
      const area = params.coordSys;
      const y = Math.round(api.coord([api.value(0), api.value(1)])[1]);
      const children = [
        {
          type: "line",
          silent: true,
          shape: { x1: area.x, y1: y, x2: area.x + area.width, y2: y },
          style: { stroke: look.color, lineWidth: 2 },
        },
      ];
      if (look.label) {
        children.push({
          type: "text",
          silent: true,
          x: area.x + area.width - 4,
          y: y - 3,
          style: {
            text: look.label,
            fill: look.color,
            font: look.font,
            align: "right",
            verticalAlign: "bottom",
            stroke: look.background,
            lineWidth: 3,
            strokeFirst: true,
          },
        });
      }
      return { type: "group", silent: true, children };
    },
  });

  // Getter/Setter einer Lit-Eigenschaft in der Prototyp-Kette finden
  const findAccessor = (obj, name) => {
    for (let o = Object.getPrototypeOf(obj); o; o = Object.getPrototypeOf(o)) {
      const d = Object.getOwnPropertyDescriptor(o, name);
      if (d) return typeof d.get === "function" && typeof d.set === "function" ? d : null;
    }
    return null;
  };

  // Diagramme (ha-chart-base) in den Shadow-Roots der inneren Karte suchen
  const findCharts = (root, out = []) => {
    if (!root || typeof root.querySelectorAll !== "function") return out;
    root.querySelectorAll("*").forEach((el) => {
      if (el.localName === "ha-chart-base") out.push(el);
      else if (el.shadowRoot) findCharts(el.shadowRoot, out);
    });
    return out;
  };

  // Daten des Diagramms abfangen: was Home Assistant hineinreicht, bekommt bei Bedarf die Linie dazu
  const hookChart = (chart, owner) => {
    const known = chart[HOOK];
    if (known) {
      if (known.owner !== owner) {
        known.owner = owner;
        known.apply();
      }
      return true;
    }
    const acc = findAccessor(chart, "data");
    if (!acc) return false;
    const state = {
      owner,
      raw: acc.get.call(chart),
      apply() {
        const next = state.owner._withLine(state.raw);
        if (next !== acc.get.call(chart)) acc.set.call(chart, next);
      },
    };
    Object.defineProperty(chart, "data", {
      configurable: true,
      enumerable: true,
      get() {
        return acc.get.call(this);
      },
      set(value) {
        state.raw = value;
        acc.set.call(this, state.owner._withLine(value));
      },
    });
    chart[HOOK] = state;
    state.apply();
    return true;
  };

  class StatistikGrenzlinieCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._charts = new Set();
      this._memo = new WeakMap();
      this._lastScan = 0;
    }

    setConfig(config) {
      if (!config || !Array.isArray(config.entities) || !config.entities.length) {
        throw new Error("Bitte 'entities' angeben, wie bei der Statistik-Grafik.");
      }
      const { type, grenze, grenze_farbe, grenze_text, ...rest } = config;
      let limit = NaN;
      if (grenze !== undefined && grenze !== null && grenze !== "") {
        limit = Number(grenze);
        if (!Number.isFinite(limit)) throw new Error("'grenze' muss eine Zahl sein.");
      } else if (config.max_y_axis !== undefined && config.max_y_axis !== null && config.max_y_axis !== "") {
        limit = Number(config.max_y_axis);
      }
      this._config = config;
      this._limit = limit;
      this._color = typeof grenze_farbe === "string" && grenze_farbe.trim() ? grenze_farbe.trim() : null;
      this._text = grenze_text === false ? false : typeof grenze_text === "string" ? grenze_text : true;
      this._look = null;
      this._memo = new WeakMap();

      const inner = { ...rest, type: "statistics-graph" };
      const key = JSON.stringify(inner);
      if (this._card && key === this._innerKey) {
        this._refreshLines();
        return;
      }
      this._innerKey = key;
      this._innerConfig = inner;
      this._build();
    }

    set hass(hass) {
      this._hass = hass;
      if (this._card) this._card.hass = hass;
      const themes = hass && hass.themes;
      const themeKey = themes ? `${themes.theme}|${themes.darkMode}` : "";
      if (this._themeKey !== undefined && themeKey !== this._themeKey) {
        // Farben des neuen Themes erst nach dem Umschalten lesen
        requestAnimationFrame(() => requestAnimationFrame(() => this._refreshLines()));
      }
      this._themeKey = themeKey;
      if (Date.now() - this._lastScan > 2000) this._scan();
    }

    get hass() {
      return this._hass;
    }

    set preview(value) {
      this._preview = value;
      if (this._card) this._card.preview = value;
    }

    get preview() {
      return this._preview;
    }

    set layout(value) {
      this._layout = value;
      if (this._card) this._card.layout = value;
    }

    get layout() {
      return this._layout;
    }

    connectedCallback() {
      if (this._card) this._scanSoon(true);
    }

    disconnectedCallback() {
      clearTimeout(this._scanTimer);
      this._scanTimer = null;
    }

    getCardSize() {
      return this._card && typeof this._card.getCardSize === "function" ? this._card.getCardSize() : 5;
    }

    getGridOptions() {
      return this._card && typeof this._card.getGridOptions === "function"
        ? this._card.getGridOptions()
        : { columns: 12, min_columns: 6, min_rows: 3 };
    }

    static getStubConfig() {
      return {
        entities: [],
        chart_type: "bar-stack",
        period: "day",
        days_to_show: 14,
        stat_types: ["change"],
        max_y_axis: 10,
        fit_y_data: true,
      };
    }

    // ---------- innere Statistik-Grafik ----------

    async _build() {
      const token = (this._buildToken = {});
      let helpers;
      try {
        helpers = await window.loadCardHelpers();
      } catch (err) {
        console.warn(`${TAG}: Kartenhilfen von Home Assistant nicht verfügbar`, err);
        return;
      }
      if (token !== this._buildToken) return;
      const card = helpers.createCardElement(this._innerConfig);
      card.addEventListener(
        "ll-upgrade",
        (ev) => {
          ev.stopPropagation();
          if (this._hass) card.hass = this._hass;
          this._scanSoon(true);
        },
        { once: true },
      );
      card.addEventListener(
        "ll-rebuild",
        (ev) => {
          ev.stopPropagation();
          if (this._card === card) this._build();
        },
        { once: true },
      );
      if (this._hass) card.hass = this._hass;
      if (this._preview !== undefined) card.preview = this._preview;
      if (this._layout !== undefined) card.layout = this._layout;
      card.classList.add("innen");
      if (!this._style) {
        this._style = document.createElement("style");
        this._style.textContent = ":host{display:block;height:100%}.innen{display:block;height:100%}";
      }
      this._charts.clear();
      this._card = card;
      this.shadowRoot.replaceChildren(this._style, card);
      this._scanSoon(true);
    }

    // ---------- Linie ----------

    _scan() {
      this._lastScan = Date.now();
      if (!this._card || !this.isConnected) return 0;
      for (const chart of this._charts) if (!chart.isConnected) this._charts.delete(chart);
      let found = 0;
      findCharts(this._card.shadowRoot).forEach((chart) => {
        if (hookChart(chart, this)) {
          this._charts.add(chart);
          found += 1;
        } else if (!this._warned) {
          this._warned = true;
          console.warn(`${TAG}: Die Grafik hat einen neuen Aufbau – die Grenzlinie kann nicht eingesetzt werden.`);
        }
      });
      return found;
    }

    // nach dem Aufbau eine Weile nachsehen, bis das Diagramm da ist (Statistiken laden asynchron)
    _scanSoon(burst) {
      if (burst) this._burstUntil = Date.now() + 30000;
      if (this._scanTimer) return;
      this._scanTimer = setTimeout(() => {
        this._scanTimer = null;
        const found = this._scan();
        if (!found && this.isConnected && Date.now() < (this._burstUntil || 0)) this._scanSoon(false);
      }, 400);
    }

    _refreshLines() {
      this._look = null;
      this._memo = new WeakMap();
      for (const chart of this._charts) {
        const state = chart[HOOK];
        if (state && state.owner === this) state.apply();
      }
    }

    _withLine(raw) {
      if (!Array.isArray(raw)) return raw;
      const series = raw.some((s) => s && s.id === LINE_ID) ? raw.filter((s) => !(s && s.id === LINE_ID)) : raw;
      const limit = this._limit;
      if (!Number.isFinite(limit)) return series;
      const { peak, xs } = peakOf(series);
      if (!(peak > limit + EPS) || !xs.length) return series;
      const look = this._lineLook();
      const key = `${limit}|${look.color}|${look.label}|${look.background}|${look.font}`;
      const memo = this._memo.get(raw);
      if (memo && memo.key === key) return memo.out;
      const out = [...series, lineSeries(xs, limit, look)];
      this._memo.set(raw, { key, out });
      return out;
    }

    _lineLook() {
      if (this._look) return this._look;
      const cs = getComputedStyle(this);
      const cssVar = (name) => cs.getPropertyValue(name).trim();
      const resolve = (value, depth = 0) => {
        const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value || "");
        if (!m || depth > 3) return value || "";
        return cssVar(m[1]) || (m[2] ? resolve(m[2].trim(), depth + 1) : "");
      };
      const color = resolve(this._color || "var(--error-color)") || "#db4437";
      const background = cssVar("--ha-card-background") || cssVar("--card-background-color") || "#ffffff";
      const family = cssVar("--ha-font-family-body") || cs.fontFamily || "sans-serif";
      const value = `${this._fmt(this._limit)}${this._unit() ? ` ${this._unit()}` : ""}`;
      const label = this._text === false ? "" : this._text === true ? value : this._text;
      this._look = { color, background, font: `500 11px ${family}`, label, name: `Grenze ${value}` };
      return this._look;
    }

    _unit() {
      if (this._config && this._config.unit) return this._config.unit;
      const first = this._config && this._config.entities && this._config.entities[0];
      const id = typeof first === "string" ? first : first && first.entity;
      const st = id && this._hass && this._hass.states && this._hass.states[id];
      return (st && st.attributes && st.attributes.unit_of_measurement) || "";
    }

    _fmt(value) {
      const hass = this._hass || {};
      const loc = hass.locale || {};
      let lang = loc.language || hass.language || "de";
      if (loc.number_format === "comma_decimal") lang = "en-US";
      else if (loc.number_format === "decimal_comma") lang = "de";
      else if (loc.number_format === "space_comma") lang = "fr";
      try {
        return new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(value);
      } catch (e) {
        return String(value);
      }
    }
  }

  customElements.define(TAG, StatistikGrenzlinieCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: TAG,
    name: "Statistik-Grafik mit Grenzlinie",
    description: "Statistik-Grafik mit roter Linie bei der eingestellten Obergrenze, sobald ein Wert darüber liegt.",
  });
  console.info(`%c STATISTIK-GRENZLINIE-CARD %c ${VERSION} `, "color:#fff;background:#db4437;font-weight:600", "color:#db4437");
})();
