const cron = require('node-cron');
const axios = require('axios');
const {
  initializeDatabase,
  insertActivityBatch,
  startCollectionRun,
  finishCollectionRun,
  calculateTrends,
  cleanOldData,
  upsertTopologyBatch,
  getTopologyLastUpdated,
  close: closeDatabase
} = require('./database');
const { calculateActivityScore, classifySecurityStatus, classifyTopology } = require('./utils');

const ESI_BASE_URL = 'https://esi.evetech.net/latest';

const esiClient = axios.create({
  baseURL: ESI_BASE_URL,
  headers: {
    'Accept': 'application/json',
    'Cache-Control': 'no-cache'
  },
  timeout: 10000
});

class DataCollector {
  constructor() {
    this.isCollecting = false;
    this.collectionRunId = null;
  }

  async collectSystemData() {
    if (this.isCollecting) {
      console.log('Collection already in progress, skipping...');
      return;
    }

    this.isCollecting = true;
    const startTime = new Date();
    let systemsCollected = 0;

    try {
      console.log(`Starting data collection at ${startTime.toISOString()}`);
      this.collectionRunId = await startCollectionRun(startTime);

      const [systemIds, jumpsData, killsData, sovData] = await Promise.all([
        this.fetchAllSystems(),
        this.fetchSystemJumps(),
        this.fetchSystemKills(),
        this.fetchSovereignty()
      ]);

      if (!systemIds.length) {
        throw new Error('ESI returned no systems; aborting collection run');
      }

      const jumpsMap = new Map(jumpsData.map(j => [j.system_id, j.ship_jumps]));
      const killsMap = new Map(killsData.map(k => [k.system_id, k]));
      const sovMap = new Map();
      for (const s of sovData) {
        if (!sovMap.has(s.solar_system_id)) sovMap.set(s.solar_system_id, []);
        sovMap.get(s.solar_system_id).push(s);
      }

      const batchSize = 100;
      for (let i = 0; i < systemIds.length; i += batchSize) {
        const batch = systemIds.slice(i, i + batchSize);
        const systemsData = [];

        for (const systemId of batch) {
          try {
            const systemInfo = await this.fetchSystemInfo(systemId);
            if (!systemInfo) continue;

            const jumps = jumpsMap.get(systemId) || 0;
            const kills = killsMap.get(systemId) || { ship_kills: 0, pod_kills: 0, npc_kills: 0 };

            let regionName = '';
            let constellationName = '';
            if (systemInfo.constellation_id) {
              const constellationInfo = await this.fetchConstellationInfo(systemInfo.constellation_id);
              if (constellationInfo) {
                constellationName = constellationInfo.name;
                if (constellationInfo.region_id) {
                  const regionInfo = await this.fetchRegionInfo(constellationInfo.region_id);
                  if (regionInfo) regionName = regionInfo.name;
                }
              }
            }

            systemsData.push({
              system_id: systemId,
              name: systemInfo.name,
              security_status: systemInfo.security_status,
              region: regionName,
              constellation: constellationName,
              jumps,
              ship_kills: kills.ship_kills || 0,
              pod_kills: kills.pod_kills || 0,
              npc_kills: kills.npc_kills || 0,
              activity_score: calculateActivityScore(
                jumps,
                (kills.ship_kills || 0) + (kills.pod_kills || 0),
                kills.npc_kills || 0
              )
            });
            systemsCollected++;
          } catch (error) {
            console.error(`Error processing system ${systemId}:`, error.message);
          }
        }

        if (systemsData.length > 0) {
          await insertActivityBatch(systemsData, sovMap);
        }

        console.log(`Processed ${Math.min(i + batchSize, systemIds.length)} / ${systemIds.length} systems`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const endTime = new Date();
      await finishCollectionRun(this.collectionRunId, endTime, systemsCollected, 'success', null);
      console.log(`Collection completed. Collected ${systemsCollected} systems in ${(endTime - startTime) / 1000}s`);

      await calculateTrends();

      // Topology collection — only refreshes when stale (>24h)
      try {
        await this.collectTopology();
      } catch (err) {
        console.error('Topology collection failed (non-fatal):', err.message);
      }
    } catch (error) {
      console.error('Collection failed:', error);
      if (this.collectionRunId) {
        try {
          await finishCollectionRun(this.collectionRunId, new Date(), systemsCollected, 'failed', error.message);
        } catch (e) {
          console.error('Failed to mark run as failed:', e.message);
        }
      }
    } finally {
      this.isCollecting = false;
      this.collectionRunId = null;
    }
  }

  async safeGet(path, fallback, label) {
    try {
      const response = await esiClient.get(path);
      return response.data;
    } catch (error) {
      console.error(`ESI fetch failed (${label}): ${error.message}`);
      return fallback;
    }
  }

  async fetchAllSystems()    { return this.safeGet('/universe/systems/', [], 'systems'); }
  async fetchSystemJumps()   { return this.safeGet('/universe/system_jumps/', [], 'system_jumps'); }
  async fetchSystemKills()   { return this.safeGet('/universe/system_kills/', [], 'system_kills'); }
  async fetchSovereignty()   { return this.safeGet('/sovereignty/structures/', [], 'sovereignty'); }

  async fetchSystemInfo(systemId) {
    try { return (await esiClient.get(`/universe/systems/${systemId}/`)).data; }
    catch { return null; }
  }
  async fetchConstellationInfo(constellationId) {
    try { return (await esiClient.get(`/universe/constellations/${constellationId}/`)).data; }
    catch { return null; }
  }
  async fetchRegionInfo(regionId) {
    try { return (await esiClient.get(`/universe/regions/${regionId}/`)).data; }
    catch { return null; }
  }

  async fetchStargateInfo(stargateId) {
    try { return (await esiClient.get(`/universe/stargates/${stargateId}/`)).data; }
    catch { return null; }
  }

  async collectTopology() {
    const lastUpdated = await getTopologyLastUpdated();
    if (lastUpdated) {
      const age = Date.now() - new Date(lastUpdated).getTime();
      if (age < 24 * 60 * 60 * 1000) {
        console.log('Topology is fresh, skipping refresh');
        return;
      }
    }

    console.log('Refreshing system topology...');
    const topoStart = Date.now();

    // Get all system IDs and fetch their info to extract stargate arrays
    const systemIds = await this.fetchAllSystems();
    const systemInfoMap = new Map();
    const allStargateIds = new Set();

    // Fetch system info in batches to get stargate arrays
    const batchSize = 100;
    for (let i = 0; i < systemIds.length; i += batchSize) {
      const batch = systemIds.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(id => this.fetchSystemInfo(id)));
      for (let j = 0; j < batch.length; j++) {
        const info = results[j];
        if (!info) continue;

        // Resolve constellation/region names
        let regionName = '';
        let constellationName = '';
        if (info.constellation_id) {
          const constInfo = await this.fetchConstellationInfo(info.constellation_id);
          if (constInfo) {
            constellationName = constInfo.name;
            if (constInfo.region_id) {
              const regInfo = await this.fetchRegionInfo(constInfo.region_id);
              if (regInfo) regionName = regInfo.name;
            }
          }
        }

        systemInfoMap.set(batch[j], {
          name: info.name,
          security_status: info.security_status,
          constellation: constellationName,
          region: regionName,
          stargates: info.stargates || []
        });
        for (const gateId of (info.stargates || [])) {
          allStargateIds.add(gateId);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`Fetched info for ${systemInfoMap.size} systems, ${allStargateIds.size} stargates to resolve`);

    // Fetch stargate details to build adjacency list
    const adjacencyList = new Map();
    const gateIds = Array.from(allStargateIds);
    for (let i = 0; i < gateIds.length; i += 50) {
      const batch = gateIds.slice(i, i + 50);
      const results = await Promise.all(batch.map(id => this.fetchStargateInfo(id)));
      for (const gate of results) {
        if (!gate || !gate.destination) continue;
        const from = gate.system_id;
        const to = gate.destination.system_id;
        if (!adjacencyList.has(from)) adjacencyList.set(from, new Set());
        if (!adjacencyList.has(to)) adjacencyList.set(to, new Set());
        adjacencyList.get(from).add(to);
        adjacencyList.get(to).add(from);
      }
      if (i % 500 === 0 && i > 0) {
        console.log(`Resolved ${i} / ${gateIds.length} stargates`);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`Built adjacency graph: ${adjacencyList.size} systems with gates`);

    // Compute betweenness centrality (Brandes' algorithm)
    const centrality = this.computeBottleneckScores(adjacencyList);

    // Build topology rows
    const topologyRows = [];
    for (const [systemId, neighbors] of adjacencyList) {
      const info = systemInfoMap.get(systemId);
      if (!info) continue;

      const gateCount = neighbors.size;
      const connectedSystems = [];
      const secTransitions = [];
      const mySecClass = classifySecurityStatus(info.security_status);

      for (const neighborId of neighbors) {
        const neighborInfo = systemInfoMap.get(neighborId);
        if (neighborInfo) {
          connectedSystems.push({
            system_id: neighborId,
            system_name: neighborInfo.name,
            security_status: neighborInfo.security_status
          });
          const neighborSecClass = classifySecurityStatus(neighborInfo.security_status);
          if (mySecClass !== neighborSecClass) {
            secTransitions.push({
              from_sec_class: mySecClass,
              to_sec_class: neighborSecClass,
              neighbor_system_id: neighborId
            });
          }
        }
      }

      topologyRows.push({
        system_id: systemId,
        system_name: info.name,
        security_status: info.security_status,
        region: info.region,
        constellation: info.constellation,
        gate_count: gateCount,
        connected_systems: connectedSystems,
        topology_type: classifyTopology(gateCount),
        bottleneck_score: centrality.get(systemId) || 0,
        security_transitions: secTransitions
      });
    }

    // Upsert in batches
    for (let i = 0; i < topologyRows.length; i += 500) {
      await upsertTopologyBatch(topologyRows.slice(i, i + 500));
    }

    const elapsed = ((Date.now() - topoStart) / 1000).toFixed(1);
    console.log(`Topology refresh complete: ${topologyRows.length} systems in ${elapsed}s`);
  }

  computeBottleneckScores(adjacencyList) {
    const nodes = Array.from(adjacencyList.keys());
    const n = nodes.length;
    const centrality = new Map();
    for (const v of nodes) centrality.set(v, 0);

    for (const s of nodes) {
      const stack = [];
      const pred = new Map();
      const sigma = new Map();
      const dist = new Map();
      const delta = new Map();

      for (const v of nodes) {
        pred.set(v, []);
        sigma.set(v, 0);
        dist.set(v, -1);
        delta.set(v, 0);
      }
      sigma.set(s, 1);
      dist.set(s, 0);

      const queue = [s];
      let qi = 0;
      while (qi < queue.length) {
        const v = queue[qi++];
        stack.push(v);
        const dv = dist.get(v);
        for (const w of (adjacencyList.get(v) || [])) {
          if (dist.get(w) < 0) {
            dist.set(w, dv + 1);
            queue.push(w);
          }
          if (dist.get(w) === dv + 1) {
            sigma.set(w, sigma.get(w) + sigma.get(v));
            pred.get(w).push(v);
          }
        }
      }

      while (stack.length) {
        const w = stack.pop();
        for (const v of pred.get(w)) {
          const contribution = (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w));
          delta.set(v, delta.get(v) + contribution);
        }
        if (w !== s) {
          centrality.set(w, centrality.get(w) + delta.get(w));
        }
      }
    }

    // Normalize for undirected graph
    const norm = (n - 1) * (n - 2) / 2;
    if (norm > 0) {
      for (const v of nodes) {
        centrality.set(v, centrality.get(v) / norm);
      }
    }

    return centrality;
  }
}

async function startScheduler() {
  await initializeDatabase();

  const collector = new DataCollector();

  console.log('Starting EVE Emptiness Data Collector...');
  console.log('Collection schedule: Every hour at :00');
  console.log('Trend calculation: Every 6 hours');
  console.log('Cleanup: Daily at 3 AM');

  collector.collectSystemData();

  cron.schedule('0 * * * *', () => {
    console.log('Running scheduled data collection...');
    collector.collectSystemData();
  });

  cron.schedule('0 */6 * * *', async () => {
    console.log('Calculating system trends...');
    try { await calculateTrends(); } catch (e) { console.error('Trend calc failed:', e.message); }
  });

  cron.schedule('0 3 * * *', async () => {
    console.log('Cleaning old data...');
    try { await cleanOldData(); } catch (e) { console.error('Cleanup failed:', e.message); }
  });
}

if (require.main === module) {
  startScheduler().catch(err => {
    console.error('Collector startup failed:', err);
    process.exit(1);
  });
  process.on('SIGINT', async () => {
    console.log('\nShutting down collector...');
    try { await closeDatabase(); } catch {}
    process.exit(0);
  });
}

module.exports = { DataCollector, startScheduler };
