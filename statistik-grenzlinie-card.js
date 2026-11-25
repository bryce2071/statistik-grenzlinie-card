/*
 * Statistik-Grenzlinie-Karte für Home Assistant  –  v1.1.0
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
 * Bearbeiten-Dialog (seit 1.1.0): oben der Editor der Statistik-Grafik von Home Assistant,
 * darunter die Einstellungen der Grenzlinie.
 *
 * Quelle: https://github.com/bryce2071/statistik-grenzlinie-card (MIT-Lizenz)
 */
(() => {
  const TAG = "statistik-grenzlinie-card";
  const EDITOR_TAG = `${TAG}-editor`;
  const VERSION = "1.1.0";
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

    static getConfigElement() {
      return document.createElement(EDITOR_TAG);
    }

    static getStubConfig(hass) {
      const states = (hass && hass.states) || {};
      const id = Object.keys(states).find(
        (e) =>
          e.startsWith("sensor.") &&
          states[e].attributes &&
          states[e].attributes.state_class === "total_increasing" &&
          states[e].attributes.unit_of_measurement === "kWh",
      );
      return {
        entities: id ? [id] : [],
        chart_type: "bar",
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

  // ---------- Bearbeiten-Dialog ----------
  // Oben der Editor der Statistik-Grafik von Home Assistant (bekommt die Einstellungen ohne die eigenen
  // Felder), darunter ein Formular für die Grenzlinie.

  const EIGENE = ["grenze", "grenze_farbe", "grenze_text"];
  const ROT = "#db4437";

  const mitFrist = (versprechen, ms) =>
    Promise.race([versprechen, new Promise((_, nein) => setTimeout(() => nein(new Error("Zeit abgelaufen")), ms))]);

  let statistikVersprechen = null;
  const statistikKlasse = () => {
    if (!statistikVersprechen) {
      statistikVersprechen = (async () => {
        if (!customElements.get("hui-statistics-graph-card") && window.loadCardHelpers) {
          const helpers = await window.loadCardHelpers();
          helpers.createCardElement({ type: "statistics-graph", entities: [] });
        }
        await customElements.whenDefined("hui-statistics-graph-card");
        return customElements.get("hui-statistics-graph-card");
      })();
    }
    return statistikVersprechen;
  };

  const hexZuRgb = (s) => {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(s || "").trim());
    if (!m) return undefined;
    const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const rgbZuHex = (rgb) =>
    Array.isArray(rgb) && rgb.length === 3
      ? "#" + rgb.map((n) => Math.max(0, Math.min(255, Math.round(Number(n) || 0))).toString(16).padStart(2, "0")).join("")
      : undefined;

  const ED_STYLE = `
    :host { display: block; }
    [hidden] { display: none !important; }
    h3 { margin: 20px 0 4px; font-size: 1em; font-weight: 500; color: var(--primary-color); }
    .hinweis { font-size: .85em; color: var(--secondary-text-color); margin: 0 2px 8px; line-height: 1.4; }
    .fehlt { font-size: .9em; color: var(--secondary-text-color); padding: 8px 2px; }
  `;
  const ED_LABEL = {
    grenze: "Linie bei (optional)",
    grenze_farbe: "Farbe der Linie",
    beschriftung: "Beschriftung an der Linie",
    grenze_text: "Eigener Text (optional)",
  };
  const ED_HILFE = {
    grenze: "Leer = bei der eingestellten Obergrenze der Y-Achse.",
    grenze_text: "Leer = der Wert der Grenze, z. B. „3 kWh“.",
  };
  const ED_SCHEMA = [
    { name: "grenze", selector: { number: { mode: "box", step: "any" } } },
    {
      name: "",
      type: "grid",
      schema: [
        { name: "grenze_farbe", selector: { color_rgb: {} } },
        { name: "beschriftung", selector: { boolean: {} } },
      ],
    },
    { name: "grenze_text", selector: { text: {} } },
  ];

  class StatistikGrenzlinieCardEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._cfg = {};
    }

    set hass(hass) {
      this._hass = hass;
      if (this._innen) this._innen.hass = hass;
      if (this._form) this._form.hass = hass;
    }

    set lovelace(l) {
      this._lovelace = l;
      if (this._innen) this._innen.lovelace = l;
    }

    setConfig(config) {
      this._cfg = { ...(config || {}) };
      this._zeichnen();
    }

    connectedCallback() {
      if (this._gestartet) return;
      this._gestartet = true;
      this._aufbauen();
    }

    // Einstellungen für die eingebaute Statistik-Grafik: alles außer den eigenen Feldern
    _innenConfig() {
      const rest = {};
      Object.keys(this._cfg).forEach((k) => {
        if (k !== "type" && !EIGENE.includes(k)) rest[k] = this._cfg[k];
      });
      const c = { type: "statistics-graph", ...rest };
      if (!Array.isArray(c.entities)) c.entities = [];
      return c;
    }

    async _aufbauen() {
      const root = this.shadowRoot;
      root.innerHTML = `<style>${ED_STYLE}</style>
        <div class="innen"></div>
        <h3>Grenzlinie</h3>
        <div class="hinweis">Die Linie erscheint nur, wenn im gezeigten Zeitraum ein Wert darüber liegt. Damit höhere Säulen nicht
        abgeschnitten werden, oben die Y-Achse an die Daten anpassen lassen (fit_y_data).</div>
        <div class="eigene"></div>`;
      let Klasse = null;
      try {
        Klasse = await mitFrist(statistikKlasse(), 15000);
      } catch (e) {
        Klasse = null;
      }
      const innen = root.querySelector(".innen");
      if (Klasse && typeof Klasse.getConfigElement === "function") {
        try {
          const ed = await Klasse.getConfigElement();
          ed.hass = this._hass;
          if (this._lovelace) ed.lovelace = this._lovelace;
          ed.addEventListener("config-changed", (ev) => {
            ev.stopPropagation();
            this._innenGeaendert((ev.detail && ev.detail.config) || {});
          });
          ed.addEventListener("GUImode-changed", (ev) => ev.stopPropagation());
          innen.appendChild(ed);
          this._innen = ed;
        } catch (e) {
          this._innen = null;
        }
      }
      if (!this._innen) {
        innen.innerHTML = `<div class="fehlt">Der Editor der Statistik-Grafik ließ sich nicht laden – Entitäten, Zeitraum und Achse bitte im Code-Editor einstellen.</div>`;
      }
      try {
        await mitFrist(customElements.whenDefined("ha-form"), 15000);
        const f = document.createElement("ha-form");
        f.computeLabel = (s) => ED_LABEL[s.name] || s.name;
        f.computeHelper = (s) => ED_HILFE[s.name] || "";
        f.hass = this._hass;
        f.schema = ED_SCHEMA;
        f.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          this._eigeneGeaendert({ ...((ev.detail && ev.detail.value) || {}) });
        });
        root.querySelector(".eigene").appendChild(f);
        this._form = f;
      } catch (e) {
        this._form = null;
      }
      this._innenJson = null;
      this._zeichnen();
    }

    _zeichnen() {
      if (this._innen) {
        const ic = this._innenConfig();
        const j = JSON.stringify(ic);
        if (j !== this._innenJson) {
          this._innenJson = j;
          let fehler = "";
          try {
            this._innen.setConfig(ic);
          } catch (e) {
            fehler = (e && e.message) || String(e);
          }
          // Kann der eingebaute Editor die Einstellungen nicht darstellen, ihn ausblenden statt mit altem Stand weiterzuarbeiten
          this._innen.hidden = !!fehler;
          const box = this.shadowRoot.querySelector(".innen");
          let hinweis = box && box.querySelector(".fehlt");
          if (fehler && box && !hinweis) {
            hinweis = document.createElement("div");
            hinweis.className = "fehlt";
            box.appendChild(hinweis);
          }
          if (hinweis) {
            hinweis.hidden = !fehler;
            hinweis.textContent = fehler
              ? `Diese Einstellungen kann der Editor der Statistik-Grafik nicht darstellen (${fehler}) – bitte im Code-Editor bearbeiten.`
              : "";
          }
        }
      }
      if (this._form) {
        const c = this._cfg;
        const d = {
          grenze_farbe: hexZuRgb(c.grenze_farbe || ROT),
          beschriftung: c.grenze_text !== false,
          grenze_text: typeof c.grenze_text === "string" ? c.grenze_text : "",
        };
        if (c.grenze !== undefined && c.grenze !== null && c.grenze !== "") d.grenze = Number(c.grenze);
        if (JSON.stringify(this._form.data) !== JSON.stringify(d)) this._form.data = d;
      }
    }

    _innenGeaendert(neu) {
      this._innenJson = JSON.stringify(neu);
      const aus = { type: this._cfg.type };
      Object.keys(neu).forEach((k) => {
        if (k !== "type" && !EIGENE.includes(k)) aus[k] = neu[k];
      });
      EIGENE.forEach((k) => {
        if (this._cfg[k] !== undefined) aus[k] = this._cfg[k];
      });
      this._senden(aus);
    }

    _eigeneGeaendert(v) {
      const c = { ...this._cfg };
      const g = v.grenze === undefined || v.grenze === null || v.grenze === "" ? NaN : Number(v.grenze);
      if (Number.isFinite(g)) c.grenze = g;
      else delete c.grenze;
      const hex = rgbZuHex(v.grenze_farbe);
      if (hex && (c.grenze_farbe || hex !== ROT)) c.grenze_farbe = hex;
      else if (!hex && !(c.grenze_farbe && !hexZuRgb(c.grenze_farbe))) delete c.grenze_farbe;
      if (v.beschriftung === false) c.grenze_text = false;
      else if (v.grenze_text) c.grenze_text = v.grenze_text;
      else delete c.grenze_text;
      // die eigenen Felder stehen am Ende
      const aus = {};
      Object.keys(c).forEach((k) => {
        if (!EIGENE.includes(k)) aus[k] = c[k];
      });
      EIGENE.forEach((k) => {
        if (c[k] !== undefined) aus[k] = c[k];
      });
      this._senden(aus);
    }

    _senden(c) {
      this._cfg = c;
      this._zeichnen();
      this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: c }, bubbles: true, composed: true }));
    }
  }

  if (!customElements.get(EDITOR_TAG)) customElements.define(EDITOR_TAG, StatistikGrenzlinieCardEditor);
  customElements.define(TAG, StatistikGrenzlinieCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: TAG,
    name: "Statistik-Grafik mit Grenzlinie",
    description: "Statistik-Grafik mit roter Linie bei der eingestellten Obergrenze, sobald ein Wert darüber liegt.",
  });
  console.info(`%c STATISTIK-GRENZLINIE-CARD %c ${VERSION} `, "color:#fff;background:#db4437;font-weight:600", "color:#db4437");
})();
