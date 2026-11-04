# Everyse Factory Operations Copilot — v0.1 (Interactive MVP Demo)

A working web app for **Galaxy Taps Pvt Ltd, Bhiwadi**. It shows three things:

1. **Production data capture.** Supervisors record shift output per stage, either by hand or by importing an Excel/CSV sheet.
2. **Production intelligence.** KPIs against plan, stage flow and bottleneck detection, order delivery risk, and an automatic daily management brief.
3. **Operational memory.** Exceptions become owned corrective actions. Resolved incidents, with root cause and fix, come back automatically when a similar problem recurs.
4. **AI copilot (mock execution).** Users chat with a copilot that plans and carries out work: briefs, corrective actions, re-sequencing late orders, chasing missing reports, and recurring routines. Each capability is set to *Ask first* or *Autonomous*, and every run is recorded in **History → AI action log**.

Everything runs locally and **deterministically**. There is no LLM or paid API: every number and recommendation is computed from recorded data with fixed rules.

> ⚠️ **Demo data.** On first run the app generates realistic **synthetic** data: 40 working days, about 22 orders, about 1,800 shift entries and 8 incidents. All of it is labelled *demo* in the UI. Products, customers, people and incidents are fictional and are **not Galaxy Taps records**.

---

## Quick start

Requires **Node.js 22+**.

```bash
npm install
npm run dev          # API on :3001 + web app on http://localhost:5173
```

Open **http://localhost:5173**.

Single-process production mode, with the API serving the built app on one port:

```bash
npm run build
npm start            # http://localhost:3001
```

| Script | What it does |
|---|---|
| `npm run dev` | API (auto-reload) + Vite dev server |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm start` | Serve API + built app on `PORT` (default 3001) |
| `npm test` | Unit + API tests (Vitest, 60 tests) |
| `npm run seed` | Regenerate demo data anchored to today (`DEMO_DATE=YYYY-MM-DD` to pin) |

Data lives in `data/db.json`, which is created on first run. Delete it, or use **Settings → Reset demo data**, to start fresh.

---

## 10-minute demo walkthrough

The demo data is built around one story: **plating has a nickel-bath problem.**

1. **Overview.** Finished output is about 69% of plan. The **Stage flow** highlights *Plating* as the bottleneck, with about 3,400 units waiting (2.1 days of capacity) and rejection at 8.3% against a 4% limit. An export order to Dubai is overdue. Click any bar in the 14-day chart to jump to that day.
2. **Exceptions & Actions.** Open the *Plating rejection* exception and click **Show similar past incidents**. The app recalls *ISS-0001* from five weeks earlier: same bath contamination, fixed by carbon treatment. Click **Assign corrective action**, then **Create action**. Open an action and try **Mark resolved** without a resolution: it is refused, because resolutions become the plant's memory.
3. **Production Updates → Record shift output.** Choose *Shift C*, a stage and an order. The form shows how many units the previous stage has delivered. Save an entry, then try to enter more units than are available, or the same order, stage and shift twice. Both are blocked with a plain-language reason.
4. **Production Updates → Import Excel / CSV.** Click **Demo: sample Shift C sheet (.xlsx)**. It is a plant-style sheet with a title row and headers like *WO No, Process, OK Qty, Rejection, Breakdown Min*. Upload it. The preview maps the columns, marks about 19 rows ready, and flags **1 row with a typo**: an extra zero in Packing that exceeds the order quantity. Import it, then go back to Overview: finished output rises **only** by the Packing rows.
5. **Daily Brief.** A management summary with priorities. Each priority cites the matching past fix ("Last time (ISS-0001): carbon treatment…"). Use **Copy for WhatsApp**, **Download .md**, **Print / PDF** or **Save to history**.
6. **Orders & Stages.** Each order's position across the six stages, projected finish and risk status. Click an order for stage-by-stage progress and its full record.
7. **History.** 30-day trends, stage performance, downtime by reason, the searchable **incident memory**, and saved briefs.
8. **AI Copilot.** Click *How did production go today?*: it reads the data and answers on its own. Ask it to *Assign an owner to the top exception*: it shows a step-by-step plan and waits for **Approve & run**. Tick *Always run this autonomously* and that capability flips to autonomous. Decline *Expedite the orders at risk*. Open **Ask Copilot** (bottom-right, on any page) and send the brief: it runs autonomously and you watch each step execute. Finish on **History → AI action log**, which lists every autonomous, approved and declined action with its full step trail.

---

## What's in v0.1

| Screen | Purpose |
|---|---|
| **Overview — Analytics** | Finished output vs plan, attainment, rejection, downtime, orders at risk, stage flow with WIP queues and bottleneck, 14-day trend, top exceptions |
| **Overview — Factory View** | Interactive isometric map of the stages (conceptual layout): status-coloured zones, data-driven bottleneck highlight, WIP crates sized by queue, flow animation, clickable zones with Overview / Work orders / Exceptions panel, zoom & focus |
| **Production Updates** | Manual shift entry with live availability check; Excel/CSV import with column mapping, row-level validation, duplicate skip/replace and templates; filterable entry log with edit, delete and CSV export |
| **Orders & Stages** | Order list with stage chain, status, due and projected dates; create/edit orders, including new products; order detail |
| **Exceptions & Actions** | Rule-based exceptions with suggested first response and similar past incidents; corrective-action tracker (owner, due date, overdue flag, root cause, resolution) |
| **Daily Brief** | Deterministic management brief for any date: copy, WhatsApp format, Markdown download, print, save |
| **History** | Range performance, stage totals, downtime reasons, incident memory search, saved briefs |
| **AI Copilot** | Chat (full page, plus a slide-over on every page) with step-by-step plan cards, approval/decline, and per-capability autonomy (*Ask first* or *Autonomous*); recent actions |
| **History → AI action log** | Every copilot action: request, plan steps, mode (Autonomous / Approved by user / Declined), result; filter and search |
| **Settings & data** | Plant name, stage daily plans, reject limits, alert thresholds; JSON backup, reset demo data, clear all data |
| **Planned modules** | *PO Price Verification* and *Assembly Material Planning*: visible in the sidebar as planned, **not implemented** |

**Not in scope for v0.1:** PO price verification, BOM automation, ERP integration and advanced scheduling. There is no authentication either: this is a single-plant local demo.

---

## Factory View

Toggle **Analytics | Factory View** next to the date on the Overview page; the choice is kept in the URL (`/?view=factory`) and never changes the selected date.

- **Same data as Analytics.** It renders the same `/api/overview` response. `src/factory/model.ts` is a pure adapter that only classifies and arranges those figures — no separate metrics. Tests (`tests/factory.test.ts`) assert the zone figures equal the Analytics stage figures.
- **Bottleneck is data-driven** — whichever stage `findBottleneck` returns gets the amber pulse, andon beacon, amber WIP pile and callout; change the date and it follows.
- **Honest about what we know.** Zone positions, equipment and conveyors are schematic; Raw material, Finished goods and Dispatch are labelled illustrative; no machine telemetry is shown; stages without a report show “No report”. Flow animation illustrates daily figures, not live tracking, and is disabled under *prefers-reduced-motion*.
- Built with plain SVG + React (no 3D engine): `src/factory/` — `layout.ts` (conceptual floor plan & schematic props), `iso.ts` (projection & palette), `FactoryZone`, `FactoryFlow`, `FactoryScene`, `FactoryDetailPanel`, `FactoryView`.

## Engineering & QC (drawings → inspection)

Sidebar → **Engineering & QC**: *Drawings Library*, *AI Drawing Review*, *QC Inspection Plans*, *Inspection Results*. The workflow is **Drawing received → simulated AI review → human approval → QC plan (four-eyes approval) → measurements → Pass / Fail / Needs review → nonconformance in Exceptions & Actions**.

- **Guided demo:** the amber bar at the top of every Engineering page walks through the bath-spout Rev B scenario (11 steps). **Next step** either opens the right screen or performs that step. The bar works out its step from saved data, so it survives reloads. **Reset scenario** resets only the Engineering data.
- **Real files:** uploads (drag & drop or browse) are stored as bytes under `data/files/` with metadata in `data/db.json`. PDFs render with pdf.js (zoom, fit, page switching). Images preview natively. DWG / DXF / STEP / IGES show file metadata and an explicit "preview not supported" message. The sample PDFs are genuine generated vector drawings.
- **Honest simulation:** extraction is a seeded **simulated AI** result behind a `DrawingExtractor` interface (`shared/engSeed.ts`), only for the demo spout drawing. Uploaded documents never get invented values; characteristics are entered manually. The annotated schematic is labelled illustrative. The Designer Portal and Shared Folder connectors are demo connectors feeding the same `ingest()` path a real webhook would use. CAD/PDM is shown as planned.
- **Rules enforced server-side:**
  - Every characteristic must be human-confirmed before a revision can be approved.
  - Approved revisions are locked.
  - A new revision never overwrites the previous one: older plans are flagged for re-approval, then superseded when the new revision is approved.
  - Plans require an approved revision and an approver different from the author.
  - Inspections require an approved plan.
- **Deterministic compliance** (`shared/eng.ts`): limits are compared in integer micro-units, and boundaries are inclusive. 120.00 ±0.20 accepts 119.80–120.20 and fails 120.34. Missing tolerances, GD&T, unknown units, missing values and unapproved drawings or plans produce **Needs review**, never a pass. One failed sample raises an NCR (an `Issue` with `inspectionId`) but does **not** reject the batch: disposition stays with QA.
- **Traceability:** OEM → part → drawing → revision → approved plan → batch / WO → inspection → failed measurement → NCR. Historical inspections stay linked to the revision and plan used at the time.

## AI copilot (mock execution)

The copilot is a **demonstration of the human + AI workflow**, not a live AI:

- **Intent matching** is rule-based (keywords). Plans are built from **real plant data** via read-only API calls, so the numbers, exceptions, owners and past fixes it cites are genuine.
- **Execution is simulated.** WhatsApp messages, assignments, re-sequencing and routines are *not* performed. Steps animate and the result is written to the action log, marked as simulated.
- **Autonomy** is set per capability and stored server-side. *Answer production questions* is read-only, so it always runs. The others default to autonomous (brief, missing reports) or ask first (corrective actions, re-sequencing, routines).
- Built so a real agent can replace `src/ai/flows.ts` later: the plan/step/approval/log contract (`shared/ai.ts`, `/api/ai/*`) stays the same.

## Data-integrity rules

A unit passes through every stage (Forging → Machining → Polishing → Plating → Assembly & Testing → Packing), so stage quantities are throughput and **must never be summed**.

- **Factory output = good units completing Packing.** No screen, report or brief adds stage figures together. The UI labels stage figures "throughput, not additive".
- **Flow constraint, checked cumulatively at every date:** a stage cannot process (good + rejected) more units of an order than the previous stage has delivered as good output **by that date**.
- **Forging** may exceed the order quantity only by the configured allowance (default 15%, to replace downstream rejects). **Packing** can never exceed the order quantity.
- **One record per order + stage + shift + date.** A second submission is rejected; edit the existing entry instead. Imports either *skip* or *replace* duplicates.
- **Edits and deletes are re-validated.** For example, you cannot delete a Forging entry that Machining has already consumed.
- **Imports are validated in process order** (date, then stage) against a scratch copy, then re-validated inside the write transaction. A single file can carry Forging and Machining for the same order, and nothing stale is committed.
- The synthetic data is produced by a flow simulation and satisfies the same rules. A test enforces this.

## Calculations

| Metric | Definition |
|---|---|
| Plan attainment | Packing good ÷ Packing daily plan (working days Mon–Sat) |
| Stage attainment | Stage good ÷ stage daily plan |
| Rejection rate | Rejects ÷ (good + rejects); the overall figure is weighted by units processed |
| WIP waiting before a stage | Cumulative good of the previous stage − cumulative processed at this stage |
| Bottleneck | Stage with the largest WIP relative to its daily plan, flagged when ≥ 1.5 days (about 1 day is normal shift-to-shift flow) |
| Projected finish | Packing work on orders ahead of this one (overdue first, then priority, then due date) plus its own remainder, at the recent 5-day packing rate (bounded 25–100% of plan), plus transit through stages not yet reached |

**Exception rules:** a stage under the shortfall threshold (default 85% of plan); rejection above the stage limit (with at least 50 units processed); downtime above 60 min per stage-day; a bottleneck; overdue or projected-late orders; and missing stage reports. All thresholds are editable in Settings.

## Excel / CSV import

- **Production:** required columns are *Date, Shift, Work Order, Stage, Good Qty*. Optional: *Reject Qty, Downtime (min), Downtime Reason, Supervisor, Remarks*.
- **Work orders:** required columns are *Work Order, Product Code, Quantity, Due Date*. Optional: *Product Name* (needed for new products), *Customer, Release Date, Priority, Remarks*.
- Header aliases are recognised, such as *OK Qty, Rejection, WO No, Process, Breakdown Min*. So are stage aliases (*CNC, VMC, Buffing, Chrome plating, Leak testing, Packaging*) and shift aliases (*1/2/3, Shift B*).
- Dates can be `21-10-2026`, `21/10/26`, `2026-10-21`, `21-Oct-2026` or native Excel dates. A title row above the header is fine.
- Download the templates from the Import tab.

## Going live with Galaxy Taps data

1. Confirm the stage list, daily plans and reject limits with the plant, and set them in **Settings**.
2. **Settings → Download backup**, then **Clear all data**.
3. Import open work orders, then recent shift sheets, or have supervisors enter each shift.

### Assumptions to confirm with Galaxy Taps

The source PRD file (`Everyse_Factory_Copilot_PRD_v0.1.md`) was not in the project folder, so this build follows the requirements summary that accompanied it. These items are demo assumptions:

- Six-stage route: Forging, Machining, Polishing, Plating, Assembly & Testing, Packing. Daily plans run from 1,800 down to 1,500 pcs.
- Mon–Sat working week, shifts A/B/C, and one entry per order per stage per shift.
- Thresholds: 85% shortfall, 60 min downtime, per-stage reject limits from 0.5% to 4%.

---

## Architecture

```
shared/        Pure TypeScript domain logic (used by server and tests)
  calc.ts        KPIs, stage summary, WIP, bottleneck, order progress & projection
  integrity.ts   Field validation, duplicate check, flow validation, availability
  exceptions.ts  Rule-based exception detection + similar-incident matching
  brief.ts       Deterministic daily brief (structured + Markdown + WhatsApp)
  importer.ts    Header/stage/shift/date mapping and row validation
  seed.ts        Synthetic flow simulation (demo data)
server/        Express 5 API, JSON file store (atomic writes), xlsx/csv parsing, eng.ts (Engineering & QC routes)
  ai.ts          Copilot capabilities, autonomy defaults, action-log types
  eng.ts         Drawing/QC model, tolerance evaluation, approval gates
  engSeed.ts     Synthetic engineering scenario, demo extractor, connectors
  pdf.ts         Tiny vector PDF writer for genuine sample drawings
src/           React 19 + Vite + Tailwind 4 + Recharts frontend
  ai/            Copilot chat, mock flows, approval/autonomy state, drawer
  factory/       Factory View: isometric scene, adapter, detail panel
  eng/           Engineering & QC: library, viewer (pdf.js), AI review, QC plans, inspections, guided demo
tests/         Vitest domain tests + Supertest API tests
```

- **Storage:** a single JSON document written atomically (temp file, then rename). The `Store` class is the seam for moving to Postgres for the PoC.
- **AI layer:** the brief and exception engine are deterministic on purpose. The structured output (`/api/brief`, `/api/exceptions`) is the natural input for Everyse's AI execution layer later, for narrative analysis, Q&A and recommendations, without changing how the numbers are computed.

## API (summary)

`GET /api/meta` · `GET /api/overview?date=` · `GET|POST /api/entries` · `PUT|DELETE /api/entries/:id` · `GET /api/entries/available` · `GET|POST /api/orders` · `GET|PUT|DELETE /api/orders/:id` · `GET /api/exceptions?date=` · `GET|POST /api/issues` · `PUT|DELETE /api/issues/:id` · `GET /api/issues/:id/similar` · `GET /api/brief?date=` · `GET|POST /api/briefs` · `GET /api/history?from=&to=` · `POST /api/import/preview|commit?kind=production|orders&mode=skip|replace` · `GET /api/import/template` · `GET /api/import/sample` · `GET /api/export/entries.csv` · `GET /api/export/backup.json` · `GET /api/ai` · `PUT /api/ai/autonomy` · `POST /api/ai/actions` · `PUT /api/settings` · `POST /api/admin/reset-demo|clear`
