const axios = require('axios');
const NodeCache = require('node-cache');
const {
  startPochvenSnapshot,
  finishPochvenSnapshot,
  insertPochvenOpportunities,
  getPochvenOpportunities
} = require('./database');
const { clampInt, clampFloat } = require('./utils');

const ESI_BASE_URL = 'https://esi.evetech.net/latest';
const ZKILL_BASE_URL = 'https://zkillboard.com/api';
const FORGE_REGION_ID = 10000002;
const POCHVEN_REGION_ID = 10000070;
const JITA_4_4_LOCATION_ID = 60003760;

const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 });

const POCHVEN_SYSTEMS = [
  { system_id: 30045328, name: 'Ahtila', clade: 'Krai Svarog' },
  { system_id: 30002652, name: 'Ala', clade: 'Krai Veles' },
  { system_id: 30003046, name: 'Angymonne', clade: 'Krai Veles' },
  { system_id: 30002702, name: 'Archee', clade: 'Krai Veles' },
  { system_id: 30001381, name: 'Arvasaras', clade: 'Krai Veles' },
  { system_id: 30002225, name: 'Harva', clade: 'Krai Svarog' },
  { system_id: 30045329, name: 'Ichoriya', clade: 'Krai Veles' },
  { system_id: 30005005, name: 'Ignebaener', clade: 'Krai Perun' },
  { system_id: 30002797, name: 'Kaunokka', clade: 'Krai Veles' },
  { system_id: 30001372, name: 'Kino', clade: 'Krai Perun' },
  { system_id: 30031392, name: 'Komo', clade: 'Krai Perun' },
  { system_id: 30002737, name: 'Konola', clade: 'Krai Perun' },
  { system_id: 30002079, name: 'Krirald', clade: 'Krai Perun' },
  { system_id: 30000021, name: 'Kuharah', clade: 'Krai Svarog' },
  { system_id: 30001445, name: 'Nalvula', clade: 'Krai Perun' },
  { system_id: 30001413, name: 'Nani', clade: 'Krai Svarog' },
  { system_id: 30003504, name: 'Niarja', clade: 'Krai Svarog' },
  { system_id: 30000192, name: 'Otanuomi', clade: 'Krai Perun' },
  { system_id: 30000157, name: 'Otela', clade: 'Krai Perun' },
  { system_id: 30003495, name: 'Raravoss', clade: 'Krai Svarog' },
  { system_id: 30010141, name: 'Sakenta', clade: 'Krai Perun' },
  { system_id: 30020141, name: 'Senda', clade: 'Krai Veles' },
  { system_id: 30002411, name: 'Skarkon', clade: 'Krai Svarog' },
  { system_id: 30002770, name: 'Tunudan', clade: 'Krai Svarog' },
  { system_id: 30040141, name: 'Urhinichi', clade: 'Krai Svarog' },
  { system_id: 30005029, name: 'Vale', clade: 'Krai Veles' },
  { system_id: 30000206, name: 'Wirashoda', clade: 'Krai Veles' }
];

const ITEM_CATALOG = [
  { name: 'Nanite Repair Paste', category: 'consumables', baseQty: 500, tags: ['universal', 'pvp'] },
  { name: 'Navy Cap Booster 400', category: 'consumables', baseQty: 800, tags: ['active_tank', 'pvp'] },
  { name: 'Navy Cap Booster 800', category: 'consumables', baseQty: 800, tags: ['active_tank', 'pvp'] },
  { name: 'Navy Cap Booster 3200', category: 'consumables', baseQty: 250, tags: ['battleship', 'active_tank'] },
  { name: 'Mobile Depot', category: 'deployables', baseQty: 20, tags: ['universal', 'logistics'] },
  { name: 'Mobile Tractor Unit', category: 'deployables', baseQty: 12, tags: ['pve', 'salvage'] },
  { name: 'Core Scanner Probe I', category: 'scanning', baseQty: 160, tags: ['scanner', 'logistics'] },
  { name: 'Sisters Core Scanner Probe', category: 'scanning', baseQty: 120, tags: ['scanner', 'logistics'] },
  { name: 'Combat Scanner Probe I', category: 'scanning', baseQty: 120, tags: ['scanner', 'pvp'] },
  { name: 'Warp Disrupt Probe', category: 'bubbles', baseQty: 300, tags: ['dictor', 'pvp'] },
  { name: 'Warp Disruptor II', category: 'tackle', baseQty: 20, tags: ['tackle', 'pvp'] },
  { name: 'Warp Scrambler II', category: 'tackle', baseQty: 20, tags: ['tackle', 'pvp'] },
  { name: 'Stasis Webifier II', category: 'tackle', baseQty: 20, tags: ['tackle', 'pvp'] },
  { name: '50MN Y-T8 Compact Microwarpdrive', category: 'propulsion', baseQty: 20, tags: ['cruiser', 'pvp'] },
  { name: '10MN Afterburner II', category: 'propulsion', baseQty: 20, tags: ['cruiser', 'pve'] },
  { name: 'Large Shield Extender II', category: 'tank', baseQty: 30, tags: ['shield', 'cruiser'] },
  { name: 'Multispectrum Shield Hardener II', category: 'tank', baseQty: 30, tags: ['shield', 'pvp'] },
  { name: 'Medium Ancillary Shield Booster', category: 'tank', baseQty: 20, tags: ['active_tank', 'shield'] },
  { name: 'Scourge Fury Heavy Missile', category: 'ammo', baseQty: 25000, tags: ['missile', 'cruiser'] },
  { name: 'Caldari Navy Scourge Heavy Missile', category: 'ammo', baseQty: 20000, tags: ['missile', 'cruiser'] },
  { name: 'Mjolnir Rage Heavy Assault Missile', category: 'ammo', baseQty: 20000, tags: ['missile', 'cruiser'] },
  { name: 'Federation Navy Antimatter Charge M', category: 'ammo', baseQty: 16000, tags: ['hybrid', 'cruiser'] },
  { name: 'Barrage M', category: 'ammo', baseQty: 16000, tags: ['projectile', 'cruiser'] },
  { name: 'Hail M', category: 'ammo', baseQty: 16000, tags: ['projectile', 'cruiser'] },
  { name: 'Warrior II', category: 'drones', baseQty: 100, tags: ['drone', 'pvp'] },
  { name: 'Hobgoblin II', category: 'drones', baseQty: 100, tags: ['drone', 'pve'] },
  { name: 'Acolyte II', category: 'drones', baseQty: 100, tags: ['drone', 'pvp'] }
];

const scoringConfig = {
  desiredMarginPct: 35,
  fallbackMarkupPct: 45,
  logisticsRisk: {
    'Krai Svarog': 0.28,
    'Krai Perun': 0.34,
    'Krai Veles': 0.38
  },
  localOrderTarget: {
    ammo: 12,
    consumables: 10,
    drones: 8,
    scanning: 6,
    tackle: 5,
    tank: 5,
    propulsion: 4,
    deployables: 4,
    bubbles: 4
  }
};

const esiClient = axios.create({
  baseURL: ESI_BASE_URL,
  timeout: 15000,
  headers: {
    Accept: 'application/json',
    'User-Agent': 'eve-emptiness-pochven-seeding/1.0'
  }
});

const zkillClient = axios.create({
  baseURL: ZKILL_BASE_URL,
  timeout: 18000,
  headers: {
    Accept: 'application/json',
    'User-Agent': 'eve-emptiness-pochven-seeding/1.0 contact: https://github.com/TargetedEntropy/eve-emptiness'
  }
});

async function cachedGet(key, ttl, fetcher) {
  const existing = cache.get(key);
  if (existing !== undefined) return existing;
  const value = await fetcher();
  cache.set(key, value, ttl);
  return value;
}

async function resolveCatalog() {
  return cachedGet('pochven_item_catalog', 86400, async () => {
    const names = [...new Set(ITEM_CATALOG.map((item) => item.name))];
    const response = await esiClient.post('/universe/ids/', names, {
      params: { datasource: 'tranquility', language: 'en' }
    });
    const inventoryTypes = response.data.inventory_types || [];
    const byName = new Map(inventoryTypes.map((item) => [item.name.toLowerCase(), item.id]));
    return ITEM_CATALOG
      .map((item) => ({ ...item, type_id: byName.get(item.name.toLowerCase()) }))
      .filter((item) => item.type_id);
  });
}

async function fetchPagedMarketOrders(regionId, typeId) {
  return cachedGet(`market_${regionId}_${typeId}`, 900, async () => {
    const first = await esiClient.get(`/markets/${regionId}/orders/`, {
      params: { datasource: 'tranquility', type_id: typeId, order_type: 'all', page: 1 }
    });
    const pages = Math.min(parseInt(first.headers['x-pages'] || '1', 10), 5);
    const data = [...first.data];
    for (let page = 2; page <= pages; page += 1) {
      const response = await esiClient.get(`/markets/${regionId}/orders/`, {
        params: { datasource: 'tranquility', type_id: typeId, order_type: 'all', page }
      });
      data.push(...response.data);
    }
    return data;
  });
}

async function getPriceContext(typeId) {
  const [forgeOrders, pochvenOrders] = await Promise.all([
    fetchPagedMarketOrders(FORGE_REGION_ID, typeId).catch(() => []),
    fetchPagedMarketOrders(POCHVEN_REGION_ID, typeId).catch(() => [])
  ]);

  const jitaSell = forgeOrders
    .filter((o) => !o.is_buy_order && o.location_id === JITA_4_4_LOCATION_ID)
    .sort((a, b) => a.price - b.price)[0];
  const jitaBuy = forgeOrders
    .filter((o) => o.is_buy_order && o.location_id === JITA_4_4_LOCATION_ID)
    .sort((a, b) => b.price - a.price)[0];

  const localSellBySystem = new Map();
  for (const order of pochvenOrders) {
    if (order.is_buy_order) continue;
    const current = localSellBySystem.get(order.system_id) || [];
    current.push(order);
    localSellBySystem.set(order.system_id, current);
  }

  return {
    jitaSellPrice: jitaSell?.price || null,
    jitaBuyPrice: jitaBuy?.price || null,
    localSellBySystem
  };
}

async function getActivityMaps() {
  const [jumps, kills] = await Promise.all([
    esiClient.get('/universe/system_jumps/', { params: { datasource: 'tranquility' } }).then((r) => r.data).catch(() => []),
    esiClient.get('/universe/system_kills/', { params: { datasource: 'tranquility' } }).then((r) => r.data).catch(() => [])
  ]);
  return {
    jumps: new Map(jumps.map((row) => [row.system_id, row.ship_jumps || 0])),
    kills: new Map(kills.map((row) => [row.system_id, row]))
  };
}

async function fetchZkillActivity(system, windowHours) {
  const pastSeconds = Math.max(3600, Math.min(windowHours * 3600, 604800));
  return cachedGet(`zkill_${system.system_id}_${pastSeconds}`, Math.min(pastSeconds, 1800), async () => {
    const response = await zkillClient.get(`/kills/solarSystemID/${system.system_id}/pastSeconds/${pastSeconds}/`);
    const kills = Array.isArray(response.data) ? response.data.slice(0, 200) : [];
    const victimShipCounts = new Map();
    const itemCounts = new Map();
    for (const kill of kills) {
      const shipType = kill?.victim?.ship_type_id;
      if (shipType) victimShipCounts.set(shipType, (victimShipCounts.get(shipType) || 0) + 1);
      const items = kill?.victim?.items || [];
      for (const item of items) {
        if (!item.item_type_id) continue;
        const qty = (item.quantity_destroyed || 0) + (item.quantity_dropped || 0);
        itemCounts.set(item.item_type_id, (itemCounts.get(item.item_type_id) || 0) + Math.max(qty, 1));
      }
    }
    return {
      killmail_count: kills.length,
      victim_ship_counts: Object.fromEntries(victimShipCounts),
      item_counts: Object.fromEntries(itemCounts),
      sample_killmails: kills.slice(0, 8).map((k) => ({
        killmail_id: k.killmail_id,
        zkb: k.zkb,
        victim_ship_type_id: k?.victim?.ship_type_id,
        killmail_time: k.killmail_time
      }))
    };
  });
}

function inferDoctrineTags(zkill, esiKills) {
  const tags = new Set(['universal']);
  const pvpKills = (esiKills?.ship_kills || 0) + (esiKills?.pod_kills || 0);
  const npcKills = esiKills?.npc_kills || 0;
  if (pvpKills > 0 || zkill.killmail_count > 0) {
    tags.add('pvp');
    tags.add('tackle');
  }
  if (npcKills > 50) {
    tags.add('pve');
    tags.add('salvage');
  }
  if (zkill.killmail_count >= 4) {
    tags.add('scanner');
    tags.add('logistics');
  }
  for (const shipType of Object.keys(zkill.victim_ship_counts || {})) {
    const id = Number(shipType);
    if ([22456, 22460, 22464, 22468, 11178, 12003].includes(id)) tags.add('dictor');
    if ([11993, 11995, 11999, 12005, 12011, 12015, 12019, 12021, 12023].includes(id)) tags.add('cruiser');
    if ([24688, 24690, 24692, 24694, 24696].includes(id)) tags.add('battleship');
  }
  return tags;
}

function normalize(value, max) {
  if (!value || value <= 0) return 0;
  return Math.min(value / max, 1);
}

function localSellSummary(orders) {
  if (!orders || !orders.length) return { price: null, count: 0, volume: 0 };
  const sorted = [...orders].sort((a, b) => a.price - b.price);
  return {
    price: sorted[0].price,
    count: orders.length,
    volume: orders.reduce((sum, o) => sum + (o.volume_remain || 0), 0)
  };
}

function scoreOpportunity({ system, item, priceContext, localSummary, jumps, esiKills, zkill }) {
  const pvpKills = (esiKills?.ship_kills || 0) + (esiKills?.pod_kills || 0);
  const npcKills = esiKills?.npc_kills || 0;
  const activityScore = Math.min(
    (normalize(jumps, 250) * 0.28) +
    (normalize(pvpKills, 15) * 0.34) +
    (normalize(npcKills, 2500) * 0.22) +
    (normalize(zkill.killmail_count, 25) * 0.16),
    1
  );

  const tags = inferDoctrineTags(zkill, esiKills);
  const matchedTags = item.tags.filter((tag) => tags.has(tag));
  const directLossCount = Number(zkill.item_counts?.[item.type_id] || 0);
  const doctrineRelevance = Math.min(0.2 + (matchedTags.length * 0.18) + normalize(directLossCount, 20) * 0.35, 1);

  const localTarget = scoringConfig.localOrderTarget[item.category] || 5;
  const scarcityScore = Math.max(0, 1 - (localSummary.count / localTarget));
  const overstockPenalty = Math.min(localSummary.count / (localTarget * 2), 0.45);

  const jitaSell = priceContext.jitaSellPrice;
  const currentLocalSell = localSummary.price;
  const fallbackLocalSell = jitaSell ? jitaSell * (1 + scoringConfig.fallbackMarkupPct / 100) : null;
  const suggestedSell = currentLocalSell && jitaSell
    ? Math.max(jitaSell * 1.18, Math.min(currentLocalSell * 0.98, jitaSell * 2.5))
    : fallbackLocalSell;
  const estimatedMarginPct = (suggestedSell && jitaSell)
    ? ((suggestedSell - jitaSell) / jitaSell) * 100
    : null;
  const marginScore = estimatedMarginPct == null
    ? 0.25
    : Math.max(0, Math.min(estimatedMarginPct / scoringConfig.desiredMarginPct, 1));

  const logisticsRisk = scoringConfig.logisticsRisk[system.clade] || 0.4;
  const confidenceScore = Math.min(
    0.35 +
    (jitaSell ? 0.2 : 0) +
    (zkill.killmail_count > 0 ? 0.18 : 0) +
    (jumps > 0 || pvpKills > 0 || npcKills > 0 ? 0.17 : 0) +
    (currentLocalSell ? 0.1 : 0),
    1
  );

  const opportunityScore = Math.max(
    0,
    ((activityScore * doctrineRelevance * scarcityScore * marginScore * confidenceScore) * 100)
      - (logisticsRisk * 12)
      - (overstockPenalty * 20)
  );

  const recommendation =
    opportunityScore >= 9 && confidenceScore >= 0.55 ? 'seed now' :
    opportunityScore >= 3.5 ? 'watch' :
    'avoid';

  const suggestedQuantity = Math.max(
    1,
    Math.round(item.baseQty * (0.35 + activityScore) * Math.max(scarcityScore, 0.25))
  );

  return {
    system_id: system.system_id,
    system_name: system.name,
    clade: system.clade,
    type_id: item.type_id,
    item_name: item.name,
    category: item.category,
    recommendation,
    suggested_quantity: suggestedQuantity,
    jita_sell_price: jitaSell,
    jita_buy_price: priceContext.jitaBuyPrice,
    local_sell_price: currentLocalSell,
    local_order_count: localSummary.count,
    suggested_sell_price: suggestedSell,
    estimated_margin_pct: estimatedMarginPct,
    opportunity_score: Number(opportunityScore.toFixed(2)),
    activity_score: Number(activityScore.toFixed(3)),
    scarcity_score: Number(scarcityScore.toFixed(3)),
    margin_score: Number(marginScore.toFixed(3)),
    doctrine_relevance: Number(doctrineRelevance.toFixed(3)),
    confidence_score: Number(confidenceScore.toFixed(3)),
    logistics_risk: Number(logisticsRisk.toFixed(3)),
    overstock_penalty: Number(overstockPenalty.toFixed(3)),
    evidence: {
      jumps,
      ship_kills: esiKills?.ship_kills || 0,
      pod_kills: esiKills?.pod_kills || 0,
      npc_kills: npcKills,
      zkill_killmails: zkill.killmail_count,
      matched_tags: matchedTags,
      observed_item_losses: directLossCount,
      local_sell_volume: localSummary.volume,
      sample_killmails: zkill.sample_killmails,
      confidence_notes: [
        jitaSell ? 'Jita 4-4 sell reference found' : 'No Jita sell reference found',
        currentLocalSell ? 'Pochven local sell order observed' : 'No local Pochven sell order observed',
        'Pochven structure-market visibility may be incomplete through public ESI'
      ]
    }
  };
}

async function buildPochvenOpportunities(options = {}) {
  const windowHours = clampInt(options.windowHours, 24, 1, 168);
  const limit = clampInt(options.limit, 250, 1, 1000);
  const snapshotId = await startPochvenSnapshot(windowHours);
  try {
    const [catalog, activityMaps] = await Promise.all([
      resolveCatalog(),
      getActivityMaps()
    ]);

    const priceContexts = new Map();
    for (const item of catalog) {
      priceContexts.set(item.type_id, await getPriceContext(item.type_id));
    }

    const opportunities = [];
    for (const system of POCHVEN_SYSTEMS) {
      const zkill = await fetchZkillActivity(system, windowHours).catch(() => ({
        killmail_count: 0,
        victim_ship_counts: {},
        item_counts: {},
        sample_killmails: []
      }));
      const jumps = activityMaps.jumps.get(system.system_id) || 0;
      const esiKills = activityMaps.kills.get(system.system_id) || { ship_kills: 0, pod_kills: 0, npc_kills: 0 };

      for (const item of catalog) {
        const priceContext = priceContexts.get(item.type_id);
        const localSummary = localSellSummary(priceContext.localSellBySystem.get(system.system_id));
        const opportunity = scoreOpportunity({ system, item, priceContext, localSummary, jumps, esiKills, zkill });
        if (opportunity.recommendation !== 'avoid' || opportunity.opportunity_score > 1) {
          opportunities.push(opportunity);
        }
      }
    }

    opportunities.sort((a, b) => b.opportunity_score - a.opportunity_score);
    const selected = opportunities.slice(0, limit);
    await insertPochvenOpportunities(snapshotId, selected);
    await finishPochvenSnapshot(snapshotId, {
      status: 'success',
      item_count: catalog.length,
      system_count: POCHVEN_SYSTEMS.length
    });
    return { snapshot_id: snapshotId, systems: POCHVEN_SYSTEMS.length, items: catalog.length, opportunities: selected };
  } catch (error) {
    await finishPochvenSnapshot(snapshotId, {
      status: 'failed',
      error_message: error.message
    });
    throw error;
  }
}

async function getOrBuildPochvenOpportunities(query = {}) {
  const maxAgeMinutes = clampInt(query.maxAgeMinutes, 60, 1, 1440);
  const force = query.force === true || query.force === 'true';
  let result = await getPochvenOpportunities({
    system: query.system || null,
    category: query.category || null,
    recommendation: query.recommendation || null,
    minScore: query.minScore ? clampFloat(query.minScore, 0, 0, 100) : null,
    limit: clampInt(query.limit, 100, 1, 1000)
  });

  const completedAt = result.snapshot?.completed_at ? new Date(result.snapshot.completed_at).getTime() : 0;
  const stale = !completedAt || Date.now() - completedAt > maxAgeMinutes * 60 * 1000;
  if (force || stale || !result.opportunities.length) {
    await buildPochvenOpportunities({
      windowHours: clampInt(query.windowHours, 24, 1, 168),
      limit: 500
    });
    result = await getPochvenOpportunities({
      system: query.system || null,
      category: query.category || null,
      recommendation: query.recommendation || null,
      minScore: query.minScore ? clampFloat(query.minScore, 0, 0, 100) : null,
      limit: clampInt(query.limit, 100, 1, 1000)
    });
  }

  return {
    ...result,
    systems: POCHVEN_SYSTEMS,
    scoring_config: scoringConfig
  };
}

function opportunitiesToCsv(opportunities) {
  const headers = [
    'system', 'clade', 'item', 'category', 'recommendation', 'quantity',
    'jita_sell', 'local_sell', 'suggested_sell', 'margin_pct', 'score', 'confidence'
  ];
  const escape = (value) => {
    if (value == null) return '';
    const text = String(value);
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [
    headers.join(','),
    ...opportunities.map((o) => [
      o.system_name, o.clade, o.item_name, o.category, o.recommendation, o.suggested_quantity,
      o.jita_sell_price, o.local_sell_price, o.suggested_sell_price,
      o.estimated_margin_pct == null ? '' : Number(o.estimated_margin_pct).toFixed(1),
      Number(o.opportunity_score).toFixed(2),
      Number(o.confidence_score).toFixed(2)
    ].map(escape).join(','))
  ].join('\n');
}

module.exports = {
  POCHVEN_SYSTEMS,
  ITEM_CATALOG,
  buildPochvenOpportunities,
  getOrBuildPochvenOpportunities,
  opportunitiesToCsv
};
