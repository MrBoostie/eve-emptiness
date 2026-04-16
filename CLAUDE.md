# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EVE Emptiness is a web application that helps EVE Online players find low-activity systems using the EVE ESI API. It consists of a Node.js/Express backend that fetches data from the ESI API and a React frontend for visualization and filtering.

## Common Development Commands

### Installation
```bash
npm run install:all  # Install all dependencies (root, server, and client)
```

### Development
```bash
npm run dev         # Run both server and client in development mode
npm run server:dev  # Run only the backend server
npm run client:dev  # Run only the frontend
```

### Production
```bash
npm run build  # Build the frontend for production
npm start      # Start the production server
```

### Data Collection
```bash
# Run collector as part of the main server (set ENABLE_COLLECTOR=true in .env)
npm start

# Or run collector as standalone process
cd server && npm run collector      # Run collector standalone
cd server && npm run collector:dev  # Run collector with auto-restart on changes
```

## Architecture

### Backend (`/server`)
- **index.js**: Express server with ESI API integration
  - Caches API responses for 5 minutes (system data) to 24 hours (static data)
  - Endpoints for systems activity, regions, constellations, and gate camping
  - Historical data endpoints for trends and analysis
  - Activity scoring algorithm combines jumps, PvP kills, and NPC kills
- **database.js**: PostgreSQL database layer (via `pg` Pool, fully async)
  - Stores historical system activity data
  - Tracks sovereignty changes over time
  - Calculates trends and activity patterns
  - System topology with bottleneck scores and security transitions
- **collector.js**: Scheduled data collection service
  - Runs every hour to collect system activity
  - Calculates trends every 6 hours
  - Cleans old data daily (keeps 30 days)
  - Topology refresh: fetches ~13k stargates, builds adjacency graph, computes betweenness centrality (Brandes' algorithm), classifies systems (pipe/hub/dead-end/junction), detects security transitions. Runs when >24h stale.
- **utils.js**: Shared scoring functions and validation constants
- **run-collector.js**: Standalone collector runner

### Frontend (`/client`)
- **App.jsx**: Main React component with mode switch (Empty Systems / Gate Camping)
  - Real-time filtering and search functionality
  - Data visualization using Recharts
  - Modal system for detailed system information
  - Historical data visualization with area charts
  - Trending changes display showing activity shifts
- **EmptySystemsView.jsx**: Live data + historical trends tab content for low-activity mode
- **GateCampingView.jsx**: Gate camping mode with topology-based filters and bottleneck charts
- **GateCampCard.jsx**: System card showing topology badge, bottleneck bar, security transitions, connected systems
- **GateCampingFilters.jsx**: Filter panel for gate camping mode (bottleneck score, topology type, security transitions, min traffic)
- **Vite Configuration**: Development server proxies `/api` requests to backend

### Key Design Decisions
1. **Caching Strategy**: Heavy caching on backend to respect ESI rate limits
2. **Activity Scoring**: Custom algorithm weights different activity types
3. **Batch Processing**: Systems are fetched in batches of 50 for performance
4. **Single Page Application**: All UI state managed in App.jsx for simplicity
5. **Historical Data**: PostgreSQL for persistent storage (migrated from SQLite)
6. **Scheduled Collection**: Cron jobs for automated data gathering
7. **Gate Camping Mode**: Separate UI mode using stargate topology graph to identify chokepoints via betweenness centrality. Topology refreshes when >24h stale to avoid hitting ESI rate limits on every hourly run.
8. **Brandes' Algorithm**: Standard BFS-based betweenness centrality on ~5200 k-space systems. Runs in-process in seconds. No external graph library needed.

## ESI API Integration

The application uses these ESI endpoints:
- `/universe/systems/` - Get all system IDs
- `/universe/systems/{system_id}/` - Get system details
- `/universe/system_jumps/` - Get jump statistics
- `/universe/system_kills/` - Get kill statistics
- `/sovereignty/structures/` - Get sovereignty information
- `/universe/regions/` and `/universe/constellations/` - Get location data
- `/universe/stargates/{stargate_id}/` - Get stargate destination (for topology graph)

## Database Schema

The PostgreSQL database (`eve_emptiness`) contains:
- **system_activity**: Historical activity records per system
- **sovereignty_history**: Tracks sovereignty changes
- **collection_runs**: Logs of data collection attempts
- **system_trends**: Calculated trends and patterns
- **system_topology**: Stargate connectivity graph — gate_count, connected_systems (JSONB), topology_type (dead-end/pipe/junction/hub), bottleneck_score (betweenness centrality), security_transitions (JSONB)

## API Endpoints

### Live Data
- `GET /api/systems/activity` - Current system activity with filters
- `GET /api/regions` - List all regions
- `GET /api/constellations/:regionId` - Constellations in a region

### Gate Camping
- `GET /api/systems/gatecamping` - Systems ranked by bottleneck score with filters (minBottleneck, topologyType, secTransition, securityMin/Max, region, minJumps, limit)
- `GET /api/topology/:systemId` - Single system's topology data (gates, connected systems, bottleneck score, security transitions)

### Historical Data
- `GET /api/history/:systemId` - System's historical records
- `GET /api/history/:systemId/range` - Aggregated activity over time
- `GET /api/trending/changes` - Systems with significant activity changes
- `GET /api/trending/low-activity` - Consistently quiet systems
- `GET /api/trending/systems` - Systems by trend direction
- `GET /api/stats/collection` - Data collection statistics

## Important Notes

- ESI API is rate-limited; caching is essential
- Activity data updates every ~1 hour from CCP
- Security status ranges from -1.0 (null-sec) to 1.0 (high-sec)
- The application does not require authentication as it uses public ESI endpoints
- Historical data is kept for 30 days before automatic cleanup
- The collector can run integrated with the server or as a standalone process

## Production Deployment

The site is deployed at **https://jumps.tovdc.com**.

### Operational Security Note

This repository intentionally avoids committing hostnames, IP addresses, SSH targets, service unit internals, or deployment credentials. Keep environment-specific runbooks in a private ops document, not in source control.

### Generic deployment model
- Reverse proxy serves the built client and forwards `/api/*` to the Node server.
- Node server reads runtime settings from `server/.env`.
- PostgreSQL runs separately and is accessed via least-privilege credentials.
- Process supervisor (e.g. systemd) restarts the API on failure.

### Generic deploy workflow
1. Sync/update code on the host.
2. Install production dependencies for `server/`.
3. Build `client/`.
4. Restart API process.
5. Validate reverse proxy config before reload/restart.

Keep machine-specific commands in private infrastructure docs.