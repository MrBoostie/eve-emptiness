const express = require('express');
const cors = require('cors');
const axios = require('axios');
const NodeCache = require('node-cache');
require('dotenv').config();
const {
  initializeDatabase,
  getSystemHistory,
  getSystemActivityRange,
  getTopChanges,
  getLowActivitySystems,
  getSystemTrends,
  getCollectionStats,
  getGateCampingSystems,
  getSystemTopology,
  getTopologyLastUpdated,
  close: closeDatabase
} = require('./database');
const { startScheduler } = require('./collector');
const { calculateActivityScore, calculateGateCampScore, clampInt, clampFloat, TREND_DIRECTIONS, TOPOLOGY_TYPES, SEC_TRANSITIONS } = require('./utils');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3001;
const ESI_BASE_URL = 'https://esi.evetech.net/latest';
const cache = new NodeCache({ stdTTL: 300 });

app.use(cors());
app.use(express.json());

const esiClient = axios.create({
  baseURL: ESI_BASE_URL,
  headers: {
    'Accept': 'application/json',
    'Cache-Control': 'no-cache'
  },
  timeout: 15000
});

async function cachedGet(key, ttl, fetcher) {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const value = await fetcher();
  cache.set(key, value, ttl);
  return value;
}

async function getJumpsMap() {
  return cachedGet('jumps_map', 300, async () => {
    const response = await esiClient.get('/universe/system_jumps/', {
      params: { datasource: 'tranquility' }
    });
    const map = new Map();
    for (const row of response.data) {
      map.set(row.system_id, row.ship_jumps);
    }
    return map;
  });
}

async function getKillsMap() {
  return cachedGet('kills_map', 300, async () => {
    const response = await esiClient.get('/universe/system_kills/', {
      params: { datasource: 'tranquility' }
    });
    const map = new Map();
    for (const row of response.data) {
      map.set(row.system_id, {
        npc_kills: row.npc_kills || 0,
        ship_kills: row.ship_kills || 0,
        pod_kills: row.pod_kills || 0
      });
    }
    return map;
  });
}

async function getSovereigntyStructures() {
  return cachedGet('sovereignty_structures', 1800, async () => {
    const response = await esiClient.get('/sovereignty/structures/', {
      params: { datasource: 'tranquility' }
    });
    return response.data;
  });
}

async function getAllSystems() {
  return cachedGet('all_systems', 86400, async () => {
    const response = await esiClient.get('/universe/systems/', {
      params: { datasource: 'tranquility' }
    });
    return response.data;
  });
}

async function getSystemInfo(systemId) {
  return cachedGet(`system_info_${systemId}`, 86400, async () => {
    const response = await esiClient.get(`/universe/systems/${systemId}/`, {
      params: { datasource: 'tranquility' }
    });
    return response.data;
  });
}

async function getConstellationInfo(constellationId) {
  return cachedGet(`constellation_${constellationId}`, 86400, async () => {
    const response = await esiClient.get(`/universe/constellations/${constellationId}/`, {
      params: { datasource: 'tranquility' }
    });
    return response.data;
  });
}

async function getRegionInfo(regionId) {
  return cachedGet(`region_${regionId}`, 86400, async () => {
    const response = await esiClient.get(`/universe/regions/${regionId}/`, {
      params: { datasource: 'tranquility' }
    });
    return response.data;
  });
}

async function getAllRegionIds() {
  return cachedGet('all_region_ids', 86400, async () => {
    const response = await esiClient.get('/universe/regions/', {
      params: { datasource: 'tranquility' }
    });
    return response.data;
  });
}

// Builds { constellationId -> {name, regionId} } and { regionId -> name }
// lookup maps in a single pass, cached for 24h so /api/systems/activity
// doesn't incur thousands of per-system ESI calls.
async function getLocationMaps() {
  return cachedGet('location_maps', 86400, async () => {
    const regionIds = await getAllRegionIds();
    const regionMap = new Map();
    const constellationMap = new Map();

    const regions = await Promise.all(regionIds.map(id => getRegionInfo(id).catch(() => null)));
    const constellationIds = [];
    regions.forEach((region, i) => {
      if (!region) return;
      regionMap.set(regionIds[i], region.name);
      if (Array.isArray(region.constellations)) {
        for (const cId of region.constellations) {
          constellationIds.push({ cId, regionId: regionIds[i] });
        }
      }
    });

    const constellations = await Promise.all(
      constellationIds.map(({ cId }) => getConstellationInfo(cId).catch(() => null))
    );
    constellations.forEach((info, i) => {
      if (!info) return;
      const { cId, regionId } = constellationIds[i];
      constellationMap.set(cId, {
        name: info.name,
        regionId,
        regionName: regionMap.get(regionId) || ''
      });
    });

    return { regionMap, constellationMap };
  });
}

app.get('/api/systems/activity', async (req, res) => {
  try {
    const maxJumps = clampInt(req.query.maxJumps, 100, 0, 1000000);
    const maxKills = clampInt(req.query.maxKills, 50, 0, 1000000);
    const securityMin = clampFloat(req.query.securityMin, -1.0, -1.0, 1.0);
    const securityMax = clampFloat(req.query.securityMax, 1.0, -1.0, 1.0);
    const limit = clampInt(req.query.limit, 100, 1, 1000);
    const region = req.query.region || null;
    const constellation = req.query.constellation || null;

    console.log('Fetching systems with activity data...');

    const [allSystemIds, sovStructures, jumpsMap, killsMap, { constellationMap }] = await Promise.all([
      getAllSystems(),
      getSovereigntyStructures(),
      getJumpsMap(),
      getKillsMap(),
      getLocationMaps()
    ]);

    const sovMap = new Map();
    for (const struct of sovStructures) {
      if (!sovMap.has(struct.solar_system_id)) {
        sovMap.set(struct.solar_system_id, []);
      }
      sovMap.get(struct.solar_system_id).push({
        alliance_id: struct.alliance_id,
        structure_id: struct.structure_id,
        structure_type_id: struct.structure_type_id,
        vulnerability_occupancy_level: struct.vulnerability_occupancy_level
      });
    }

    const systemActivityData = [];
    const batchSize = 50;

    for (let i = 0; i < allSystemIds.length && systemActivityData.length < limit; i += batchSize) {
      const batch = allSystemIds.slice(i, i + batchSize);

      const batchResults = await Promise.all(batch.map(async (systemId) => {
        const systemInfo = await getSystemInfo(systemId).catch(() => null);
        if (!systemInfo) return null;

        if (systemInfo.security_status < securityMin || systemInfo.security_status > securityMax) {
          return null;
        }

        const jumps = jumpsMap.get(systemId) || 0;
        const kills = killsMap.get(systemId) || { npc_kills: 0, ship_kills: 0, pod_kills: 0 };
        const totalKills = kills.ship_kills + kills.pod_kills;

        if (jumps > maxJumps || totalKills > maxKills) return null;

        const locInfo = systemInfo.constellation_id
          ? constellationMap.get(systemInfo.constellation_id)
          : null;
        const constellationName = locInfo ? locInfo.name : '';
        const regionName = locInfo ? locInfo.regionName : '';

        if (constellation && constellationName.toLowerCase() !== constellation.toLowerCase()) {
          return null;
        }
        if (region && regionName.toLowerCase() !== region.toLowerCase()) {
          return null;
        }

        return {
          system_id: systemId,
          name: systemInfo.name,
          security_status: systemInfo.security_status,
          constellation: constellationName,
          region: regionName,
          jumps,
          npc_kills: kills.npc_kills,
          ship_kills: kills.ship_kills,
          pod_kills: kills.pod_kills,
          total_kills: totalKills,
          sovereignty: sovMap.get(systemId) || [],
          activity_score: calculateActivityScore(jumps, totalKills, kills.npc_kills)
        };
      }));

      for (const s of batchResults) {
        if (s) systemActivityData.push(s);
      }
    }

    systemActivityData.sort((a, b) => a.activity_score - b.activity_score);

    res.json({
      systems: systemActivityData.slice(0, limit),
      total: systemActivityData.length,
      filters: { maxJumps, maxKills, securityMin, securityMax, region, constellation }
    });
  } catch (error) {
    console.error('Error in /api/systems/activity:', error);
    res.status(500).json({ error: 'Failed to fetch system activity data' });
  }
});

app.get('/api/regions', async (req, res) => {
  try {
    const { regionMap } = await getLocationMaps();
    const regions = Array.from(regionMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json(regions);
  } catch (error) {
    console.error('Error fetching regions:', error);
    res.status(500).json({ error: 'Failed to fetch regions' });
  }
});

app.get('/api/constellations/:regionId', async (req, res) => {
  try {
    const regionId = parseInt(req.params.regionId, 10);
    if (Number.isNaN(regionId)) {
      return res.status(400).json({ error: 'Invalid regionId' });
    }
    const { constellationMap } = await getLocationMaps();
    const constellations = Array.from(constellationMap.entries())
      .filter(([, info]) => info.regionId === regionId)
      .map(([id, info]) => ({ id, name: info.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json(constellations);
  } catch (error) {
    console.error('Error fetching constellations:', error);
    res.status(500).json({ error: 'Failed to fetch constellations' });
  }
});

app.get('/api/history/:systemId', async (req, res) => {
  try {
    const systemId = parseInt(req.params.systemId, 10);
    if (Number.isNaN(systemId)) return res.status(400).json({ error: 'Invalid systemId' });
    const limit = clampInt(req.query.limit, 100, 1, 10000);
    res.json(await getSystemHistory(systemId, limit));
  } catch (error) {
    console.error('Error fetching system history:', error);
    res.status(500).json({ error: 'Failed to fetch system history' });
  }
});

app.get('/api/history/:systemId/range', async (req, res) => {
  try {
    const systemId = parseInt(req.params.systemId, 10);
    if (Number.isNaN(systemId)) return res.status(400).json({ error: 'Invalid systemId' });
    const days = clampInt(req.query.days, 7, 1, 30);
    res.json(await getSystemActivityRange(systemId, days));
  } catch (error) {
    console.error('Error fetching activity range:', error);
    res.status(500).json({ error: 'Failed to fetch activity range' });
  }
});

app.get('/api/trending/changes', async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 20, 1, 500);
    res.json(await getTopChanges(limit));
  } catch (error) {
    console.error('Error fetching trending changes:', error);
    res.status(500).json({ error: 'Failed to fetch trending changes' });
  }
});

app.get('/api/trending/low-activity', async (req, res) => {
  try {
    const maxScore = clampFloat(req.query.maxScore, 100, 0, 1e9);
    const limit = clampInt(req.query.limit, 50, 1, 500);
    res.json(await getLowActivitySystems(maxScore, limit));
  } catch (error) {
    console.error('Error fetching low activity systems:', error);
    res.status(500).json({ error: 'Failed to fetch low activity systems' });
  }
});

app.get('/api/trending/systems', async (req, res) => {
  try {
    const direction = TREND_DIRECTIONS.has(req.query.direction) ? req.query.direction : 'stable';
    const limit = clampInt(req.query.limit, 30, 1, 500);
    res.json(await getSystemTrends(direction, limit));
  } catch (error) {
    console.error('Error fetching system trends:', error);
    res.status(500).json({ error: 'Failed to fetch system trends' });
  }
});

app.get('/api/stats/collection', async (req, res) => {
  try {
    res.json(await getCollectionStats());
  } catch (error) {
    console.error('Error fetching collection stats:', error);
    res.status(500).json({ error: 'Failed to fetch collection stats' });
  }
});

app.get('/api/systems/gatecamping', async (req, res) => {
  try {
    const filters = {
      minBottleneck: clampFloat(req.query.minBottleneck, 0, 0, 1),
      topologyType: TOPOLOGY_TYPES.has(req.query.topologyType) ? req.query.topologyType : null,
      secTransition: SEC_TRANSITIONS.has(req.query.secTransition) ? req.query.secTransition : null,
      securityMin: clampFloat(req.query.securityMin, -1.0, -1.0, 1.0),
      securityMax: clampFloat(req.query.securityMax, 1.0, -1.0, 1.0),
      region: req.query.region || null,
      minJumps: clampInt(req.query.minJumps, 0, 0, 1000000),
      limit: clampInt(req.query.limit, 100, 1, 1000)
    };

    const result = await getGateCampingSystems(filters);
    const topologyUpdated = await getTopologyLastUpdated();

    // Enrich with gate camp score
    for (const s of result.systems) {
      const hasSecTransition = Array.isArray(s.security_transitions) && s.security_transitions.length > 0;
      s.gate_camp_score = calculateGateCampScore(
        s.bottleneck_score, s.jumps, s.ship_kills, s.gate_count, hasSecTransition
      );
    }

    res.json({
      systems: result.systems,
      total: result.total,
      filters,
      topology_updated: topologyUpdated
    });
  } catch (error) {
    console.error('Error in /api/systems/gatecamping:', error);
    res.status(500).json({ error: 'Failed to fetch gate camping data' });
  }
});

app.get('/api/topology/:systemId', async (req, res) => {
  try {
    const systemId = parseInt(req.params.systemId, 10);
    if (Number.isNaN(systemId)) return res.status(400).json({ error: 'Invalid systemId' });
    const topology = await getSystemTopology(systemId);
    if (!topology) return res.status(404).json({ error: 'System topology not found' });
    res.json(topology);
  } catch (error) {
    console.error('Error fetching system topology:', error);
    res.status(500).json({ error: 'Failed to fetch system topology' });
  }
});

let server;

(async () => {
  try {
    await initializeDatabase();
  } catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  }

  if (process.env.ENABLE_COLLECTOR === 'true') {
    console.log('Starting data collector scheduler...');
    await startScheduler();
  }

  server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access the API at http://localhost:${PORT}/api/systems/activity`);
    console.log(`Data collector: ${process.env.ENABLE_COLLECTOR === 'true' ? 'ENABLED' : 'DISABLED'}`);
  });
})();

function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  const done = async () => {
    try { await closeDatabase(); } catch (e) { console.error('Error closing database:', e.message); }
    process.exit(0);
  };
  if (server) server.close(done); else done();
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
