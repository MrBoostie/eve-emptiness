<p align="center">
  <img src="https://img.shields.io/badge/EVE%20Online-ESI%20API-blue?style=for-the-badge" alt="EVE ESI" />
  <img src="https://img.shields.io/badge/Node.js-22-green?style=for-the-badge&logo=node.js" alt="Node" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-336791?style=for-the-badge&logo=postgresql" alt="Postgres" />
  <img src="https://img.shields.io/github/license/TargetedEntropy/eve-emptiness?style=for-the-badge" alt="License" />
</p>

# EVE Emptiness

**Find the quietest corners and deadliest chokepoints in New Eden.**

EVE Emptiness is a real-time intelligence tool for EVE Online that analyzes every system in k-space using CCP's ESI API. It operates in two modes:

- **Empty Systems** — Find dead-quiet systems for ratting, exploration, or setting up shop undisturbed.
- **Gate Camping** — Identify high-traffic chokepoints, pipe systems, and security border crossings ideal for gate camps.

**Live at [jumps.tovdc.com](https://jumps.tovdc.com)**

---

## Features

### Empty Systems Mode
- Real-time activity data from the ESI API (jumps, ship/pod/NPC kills)
- Filter by max jumps, max kills, security status range, region, constellation
- Activity scoring algorithm: `(jumps * 10) + (pvpKills * 50) + (npcKills * 0.1)`
- Historical trends — 7-day area charts, 24h activity change tracking
- Sovereignty information per system

### Gate Camping Mode
- **Full topology graph** of New Eden's ~5,200 k-space systems built from stargate data
- **Betweenness centrality** (Brandes' algorithm) scores every system as a chokepoint — higher score = more routes funnel through it
- **Topology classification** — Dead End, Pipe, Junction, Hub
- **Security transition detection** — automatically flags gates crossing highsec/lowsec/nullsec boundaries
- **Composite Gate Camp Score** (0-100) weighting bottleneck centrality (40%), traffic (30%), kills (20%), and security transitions (10%)
- Connected systems list with security status on every card

### Shared
- Interactive charts (Recharts) — bar charts, pie charts, area charts
- Detail modal with links to [Dotlan](https://evemaps.dotlan.net) and [zKillboard](https://zkillboard.com)
- Hourly automated data collection with PostgreSQL storage
- 30-day historical data retention

---

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │               Caddy (TLS + Static)          │
                    │  /api/* → localhost:3001  │  /* → dist/     │
                    └─────────────┬───────────────────────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │     Express API (Node.js)    │
                    │                              │
                    │  /api/systems/activity       │
                    │  /api/systems/gatecamping    │
                    │  /api/topology/:id           │
                    │  /api/regions                │
                    │  /api/trending/*             │
                    │  /api/history/*              │
                    └──────────┬──────┬────────────┘
                               │      │
              ┌────────────────▼┐    ┌▼────────────────┐
              │   PostgreSQL    │    │    ESI API       │
              │                 │    │  (CCP/EVE)       │
              │  system_activity│    │                  │
              │  system_topology│    │  /universe/*     │
              │  system_trends  │    │  /sovereignty/*  │
              │  collection_runs│    │  /stargates/*    │
              │  sov_history    │    │                  │
              └─────────────────┘    └──────────────────┘
```

### Backend (`/server`)

| File | Purpose |
|------|---------|
| `index.js` | Express server, API endpoints, ESI caching layer |
| `database.js` | PostgreSQL schema, queries (all async via `pg` Pool) |
| `collector.js` | Hourly data collection, topology graph building, Brandes' centrality algorithm |
| `utils.js` | Scoring functions, validation helpers, shared constants |

### Frontend (`/client`)

| File | Purpose |
|------|---------|
| `App.jsx` | Root component — mode switch, shared state, detail modal |
| `EmptySystemsView.jsx` | Low-activity mode: live data + historical trends |
| `GateCampingView.jsx` | Gate camping mode: filters, charts, system grid |
| `GateCampCard.jsx` | Individual system card with topology badges and bottleneck bar |
| `GateCampingFilters.jsx` | Gate camping filter panel |

### Data Collection Schedule

| Schedule | Task |
|----------|------|
| Hourly at `:00` | Collect system activity (jumps, kills, sovereignty) for all ~8,500 systems |
| Every 6 hours | Recalculate trend data (avg daily jumps/kills, trend direction, peak hours) |
| When >24h stale | Refresh topology graph (~13k stargates, Brandes' algorithm, ~2-3 min) |
| Daily at 03:00 UTC | Clean activity records older than 30 days |

---

## Quick Start

### Prerequisites
- Node.js 18+ (tested on 22)
- PostgreSQL 14+ (tested on 16)

### 1. Clone and install

```bash
git clone https://github.com/TargetedEntropy/eve-emptiness.git
cd eve-emptiness
npm run install:all
```

### 2. Set up PostgreSQL

```bash
sudo -u postgres psql -c "CREATE USER eve_emptiness WITH PASSWORD 'your-password';"
sudo -u postgres psql -c "CREATE DATABASE eve_emptiness OWNER eve_emptiness;"
```

### 3. Configure environment

```bash
cp server/.env.example server/.env
# Edit server/.env with your database credentials
```

### 4. Run in development

```bash
npm run dev    # Starts both server (:3001) and client (:3000)
```

### 5. Build for production

```bash
npm run build  # Build frontend
npm start      # Start production server
```

---

## API Reference

### Live Data
| Endpoint | Params | Description |
|----------|--------|-------------|
| `GET /api/systems/activity` | `maxJumps`, `maxKills`, `securityMin`, `securityMax`, `region`, `constellation`, `limit` | Systems sorted by lowest activity |
| `GET /api/regions` | — | All EVE regions |
| `GET /api/constellations/:regionId` | — | Constellations in a region |

### Gate Camping
| Endpoint | Params | Description |
|----------|--------|-------------|
| `GET /api/systems/gatecamping` | `minBottleneck`, `topologyType`, `secTransition`, `securityMin`, `securityMax`, `region`, `minJumps`, `limit` | Systems ranked by bottleneck score |
| `GET /api/topology/:systemId` | — | Single system's topology data |

### Historical
| Endpoint | Params | Description |
|----------|--------|-------------|
| `GET /api/history/:systemId` | `limit` | Raw activity records |
| `GET /api/history/:systemId/range` | `days` | Daily aggregated stats |
| `GET /api/trending/changes` | `limit` | Systems with biggest 24h activity shifts |
| `GET /api/trending/low-activity` | `maxScore`, `limit` | Consistently quiet systems |
| `GET /api/trending/systems` | `direction`, `limit` | Systems by trend (stable/increasing/decreasing) |
| `GET /api/stats/collection` | — | Collector health stats |

---

## How the Gate Camping Algorithm Works

### 1. Build the Graph
Every stargate in EVE links two systems. We fetch all ~13,000 stargates from ESI and build an undirected adjacency graph of ~5,200 k-space systems.

### 2. Compute Betweenness Centrality
[Brandes' algorithm](https://doi.org/10.1080/0022250X.2001.9990249) computes how many shortest paths between all pairs of systems pass through each node. Systems that sit on many shortest paths are natural **bottlenecks** — places where traffic *must* flow.

```
centrality(v) = sum over all s,t of (shortest paths through v / total shortest paths from s to t)
```

This runs BFS from every node (O(V*E) ≈ 34M edge traversals) and completes in ~5 seconds on a single Node.js thread.

### 3. Classify & Score
Each system gets:
- **Topology type**: Dead End (1 gate), Pipe (2), Junction (3), Hub (4+)
- **Security transitions**: Which gates cross highsec/lowsec/nullsec boundaries
- **Gate Camp Score**: Weighted composite of centrality (40%), traffic volume (30%), kill activity (20%), and security transition presence (10%)

Famous systems like **Rancer**, **Tama**, and **HED-GP** naturally surface near the top.

---

## Tech Stack

- **Runtime**: Node.js 22, Express 4
- **Frontend**: React 18, Vite 5, Recharts, Lucide Icons
- **Database**: PostgreSQL 16 (via `pg` pool)
- **Caching**: node-cache (5-min TTL for dynamic data, 24h for static)
- **Scheduling**: node-cron
- **Reverse Proxy**: Caddy (auto TLS via ACME)
- **Data Source**: [EVE ESI API](https://esi.evetech.net/ui/) (public, no auth required)

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/awesome-thing`)
3. Commit your changes
4. Push and open a PR

---

## License

MIT

---

*EVE Online and all related trademarks are property of CCP hf. This project is not affiliated with or endorsed by CCP.*
