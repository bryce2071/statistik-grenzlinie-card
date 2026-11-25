# Statistik-Grafik mit Grenzlinie

Die normale Statistik-Grafik von Home Assistant (`statistics-graph`) – mit einer roten Linie bei der
eingestellten Obergrenze der Achse (`max_y_axis`), **aber nur, wenn im gezeigten Zeitraum ein Wert
darüber liegt**. Bleibt alles darunter, sieht die Grafik aus wie bisher.

Gedacht für Tages-Säulen mit fester Achse (z. B. 10 kWh): Mit `fit_y_data: true` werden Ausreißer nicht
abgeschnitten, und die Linie zeigt, wo die gewohnte Obergrenze liegt.

*English: Home Assistant's statistics graph with a red line at the configured y-axis maximum – shown only
when a value in the visible period exceeds it. German user interface.*

## Installation

1. **Einstellungen → Marketplace → Über Link hinzufügen** und
   `https://github.com/bryce2071/statistik-grenzlinie-card` eintragen (Typ *Dashboard*), dann
   **Statistik-Grafik mit Grenzlinie** herunterladen. Die Ressource trägt der Marketplace selbst ein.
2. Browser bzw. App einmal neu laden. Danach steht die Karte in der Kartenauswahl.

## Beispiel

```yaml
type: custom:statistik-grenzlinie-card
entities:
  - sensor.waschmaschine_energie
chart_type: bar
period: day
days_to_show: 14
stat_types:
  - change
max_y_axis: 10
fit_y_data: true
```

## Optionen

Alle Optionen der Statistik-Grafik gelten unverändert (`entities`, `period`, `days_to_show`,
`chart_type`, `stat_types`, `min_y_axis`, `max_y_axis`, `fit_y_data`, …). Dazu:

| Feld | Bedeutung |
|---|---|
| `grenze` | optional, Linie bei diesem Wert statt bei `max_y_axis` |
| `grenze_farbe` | optional, Farbe der Linie – sonst die Fehlerfarbe des Themes (rot) |
| `grenze_text` | optional, `false` blendet die Beschriftung an der Linie aus, ein Text ersetzt sie |
| `unit` | optional, Einheit der Beschriftung – sonst die der ersten Entität |

Bei gestapelten Säulen zählt die Summe des Stapels.

## Hinweise

- Die Linie wird in die Grafik von Home Assistant eingesetzt (ECharts, ab Home Assistant 2025.2). Ändert
  ein späteres Update deren Aufbau, fehlt nur die Linie – die Grafik selbst bleibt (Hinweis in der
  Browser-Konsole).
- Wer die Datei vorher von Hand eingebunden hatte (`/local/statistik-grenzlinie-card.js`), entfernt diese
  Ressource (**Einstellungen → Dashboards → ⋮ → Ressourcen**), sonst lädt der Browser die ältere Fassung.
- Einstellungen nur im Code-Editor (YAML).

## Lizenz

MIT
