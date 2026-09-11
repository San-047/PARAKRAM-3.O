# JanDrishti AI — Backend
**Problem Statement PK01PS002** — People's Priorities: AI for Constituency Development Planning
(Parakram 1.0, GITA Autonomous College)

Node.js + Express backend for the [JanDrishti AI frontend](https://projectdemoui.netlify.app/).
Ranking math and the knapsack portfolio optimizer are **real algorithms** running on real
in-memory data. Translation / speech-to-text / vision tagging are **simulated** (keyword-based
mocks) so the demo needs zero paid API keys — clearly say this if judges ask.

## Run it

```bash
npm install
npm start
# Server runs on http://localhost:4000
```

No `.env` needed. Data resets on restart (in-memory store) — good enough for a hackathon demo.

## Modules → Endpoints

### 1. Multilingual, Multi-Modal Citizen Submission Interface
- `POST /api/submissions` — ingest a citizen submission
  ```json
  { "text": "...", "language": "Odia", "channel": "voice|whatsapp|photo|text",
    "wardId": "W4", "citizenId": "c123", "hasPhoto": true }
  ```
  Returns normalized text, detected theme, ward, confidence, optional vision tag,
  and spam/duplicate flag.
- `GET /api/submissions?theme=Roads&wardId=W4` — list/filter the knowledge stream

### 2. Thematic Pattern Recognition & Demand Hotspot Mapping
- `GET /api/hotspots` — clusters submissions by ward+theme, classifies each as
  Low / Moderate / Critical based on volume, excludes flagged spam

### 3. Multi-Source Data Fusion
- `GET /api/context/:wardId` — fuses a ward's citizen submissions with its
  static infrastructure baseline (schools, health centers, road/water indices)

### 4. Comparative Evaluation & Priority Ranking Engine
- `GET /api/proposals` — all 10 seed proposals, ranked by
  `Priority = w1·Demand + w2·InfraGap + w3·DemographicReach + w4·CostEfficiency`
- `POST /api/proposals/weights` — update `w1..w4` and re-rank
  ```json
  { "w1": 0.4, "w2": 0.3, "w3": 0.2, "w4": 0.1 }
  ```
- `GET /api/proposals/compare?a=PROJ-104&b=PROJ-102` — head-to-head adjudicator

### 5. Predictive Social & Economic Impact Estimation
- `GET /api/proposals/:id/impact?iterations=10000` — Monte Carlo simulation
  returning mean uplift %, benefit-cost ratio, and 94% confidence intervals

### 6. Constraint-Aware Portfolio Optimization
- `POST /api/portfolio/optimize` — 0/1 knapsack over ranked proposals
  ```json
  { "budgetCapLakhs": 140, "maxProjectsPerWard": 2, "requiredSectorFloor": "Healthcare" }
  ```
  Returns approved portfolio, deferred proposals, budget utilization %,
  utility score, and beneficiary reach.

### Misc
- `GET /api/health` — health check
- `GET /api/summary` — dashboard header stats (submission count, languages seen, etc.)

## Wiring it to the frontend

The Netlify frontend currently has no backend calls wired in. Point its fetch calls at
`http://localhost:4000/api/...` (or your deployed URL) for each corresponding section —
e.g. the "Ingest & Normalize" button → `POST /api/submissions`, the ranking table →
`GET /api/proposals`, "Solve Knapsack Portfolio" button → `POST /api/portfolio/optimize`.

## Honest limitations (say this to judges if asked)
- Translation/STT/Vision tagging are keyword-based simulations, not real ML models.
- Data is in-memory only — no database, resets on restart.
- Seed data (10 proposals, 5 wards) is illustrative, not real government data.
- Ranking weights and Monte Carlo assumptions are reasonable defaults, not calibrated
  against historical project outcomes.

## Suggested real upgrade path (mention in pitch, don't need to build)
- Swap `services/nlp.js` for a real STT + translation API (e.g. Bhashini for Indian languages)
- Add a Postgres/SQLite layer instead of in-memory arrays
- Replace vision tagging mock with an actual image classification model
