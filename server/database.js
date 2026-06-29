const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT, 10) || 5432,
  database: process.env.PGDATABASE || 'eve_emptiness',
  user: process.env.PGUSER || 'eve_emptiness',
  password: process.env.PGPASSWORD,
  max: 10,
  idleTimeoutMillis: 30000
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error:', err);
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_activity (
      id BIGSERIAL PRIMARY KEY,
      system_id INTEGER NOT NULL,
      system_name TEXT NOT NULL,
      security_status REAL,
      region TEXT,
      constellation TEXT,
      jumps INTEGER DEFAULT 0,
      ship_kills INTEGER DEFAULT 0,
      pod_kills INTEGER DEFAULT 0,
      npc_kills INTEGER DEFAULT 0,
      activity_score REAL,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_system_timestamp ON system_activity (system_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_timestamp ON system_activity (timestamp);
    CREATE INDEX IF NOT EXISTS idx_activity_score ON system_activity (activity_score);

    CREATE TABLE IF NOT EXISTS sovereignty_history (
      id BIGSERIAL PRIMARY KEY,
      system_id INTEGER NOT NULL,
      alliance_id INTEGER,
      structure_id BIGINT,
      structure_type_id INTEGER,
      vulnerability_level REAL,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_system_sov ON sovereignty_history (system_id, timestamp);

    CREATE TABLE IF NOT EXISTS collection_runs (
      id BIGSERIAL PRIMARY KEY,
      start_time TIMESTAMPTZ,
      end_time TIMESTAMPTZ,
      systems_collected INTEGER DEFAULT 0,
      status TEXT DEFAULT 'running',
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS system_topology (
      system_id INTEGER PRIMARY KEY,
      system_name TEXT NOT NULL,
      security_status REAL,
      region TEXT,
      constellation TEXT,
      gate_count INTEGER DEFAULT 0,
      connected_systems JSONB DEFAULT '[]',
      topology_type TEXT DEFAULT 'standard',
      bottleneck_score REAL DEFAULT 0,
      security_transitions JSONB DEFAULT '[]',
      last_updated TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_topology_bottleneck ON system_topology (bottleneck_score DESC);
    CREATE INDEX IF NOT EXISTS idx_topology_type ON system_topology (topology_type);
    CREATE INDEX IF NOT EXISTS idx_topology_region ON system_topology (region);

    CREATE TABLE IF NOT EXISTS system_trends (
      system_id INTEGER PRIMARY KEY,
      system_name TEXT NOT NULL,
      avg_daily_jumps REAL DEFAULT 0,
      avg_daily_kills REAL DEFAULT 0,
      trend_direction TEXT DEFAULT 'stable',
      last_updated TIMESTAMPTZ DEFAULT NOW(),
      peak_activity_hour INTEGER,
      lowest_activity_hour INTEGER,
      days_tracked INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pochven_market_snapshots (
      id BIGSERIAL PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'running',
      source_window_hours INTEGER NOT NULL DEFAULT 24,
      item_count INTEGER NOT NULL DEFAULT 0,
      system_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS pochven_market_opportunities (
      id BIGSERIAL PRIMARY KEY,
      snapshot_id BIGINT REFERENCES pochven_market_snapshots(id) ON DELETE CASCADE,
      system_id INTEGER NOT NULL,
      system_name TEXT NOT NULL,
      clade TEXT NOT NULL,
      type_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      category TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      suggested_quantity INTEGER NOT NULL,
      jita_sell_price NUMERIC,
      jita_buy_price NUMERIC,
      local_sell_price NUMERIC,
      local_order_count INTEGER NOT NULL DEFAULT 0,
      suggested_sell_price NUMERIC,
      estimated_margin_pct REAL,
      opportunity_score REAL NOT NULL,
      activity_score REAL NOT NULL,
      scarcity_score REAL NOT NULL,
      margin_score REAL NOT NULL,
      doctrine_relevance REAL NOT NULL,
      confidence_score REAL NOT NULL,
      logistics_risk REAL NOT NULL,
      overstock_penalty REAL NOT NULL,
      evidence JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_pochven_opp_snapshot_score
      ON pochven_market_opportunities (snapshot_id, opportunity_score DESC);
    CREATE INDEX IF NOT EXISTS idx_pochven_opp_system
      ON pochven_market_opportunities (system_id, snapshot_id);
  `);
  console.log('Database initialized successfully');
}

async function insertSystemActivity(row) {
  await pool.query(
    `INSERT INTO system_activity (
       system_id, system_name, security_status, region, constellation,
       jumps, ship_kills, pod_kills, npc_kills, activity_score
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      row.system_id, row.name, row.security_status, row.region, row.constellation,
      row.jumps, row.ship_kills, row.pod_kills, row.npc_kills, row.activity_score
    ]
  );
}

async function insertSovereignty(row) {
  await pool.query(
    `INSERT INTO sovereignty_history (
       system_id, alliance_id, structure_id, structure_type_id, vulnerability_level
     ) VALUES ($1,$2,$3,$4,$5)`,
    [row.system_id, row.alliance_id, row.structure_id, row.structure_type_id, row.vulnerability_level]
  );
}

// Bulk insert one collection batch in a single transaction.
async function insertActivityBatch(systems, sovMap) {
  if (!systems.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of systems) {
      await client.query(
        `INSERT INTO system_activity (
           system_id, system_name, security_status, region, constellation,
           jumps, ship_kills, pod_kills, npc_kills, activity_score
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [s.system_id, s.name, s.security_status, s.region, s.constellation,
         s.jumps, s.ship_kills, s.pod_kills, s.npc_kills, s.activity_score]
      );
      const sovs = sovMap.get(s.system_id);
      if (sovs) {
        for (const sov of sovs) {
          await client.query(
            `INSERT INTO sovereignty_history (
               system_id, alliance_id, structure_id, structure_type_id, vulnerability_level
             ) VALUES ($1,$2,$3,$4,$5)`,
            [s.system_id, sov.alliance_id, sov.structure_id, sov.structure_type_id, sov.vulnerability_occupancy_level]
          );
        }
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function startCollectionRun(startTime) {
  const { rows } = await pool.query(
    `INSERT INTO collection_runs (start_time, status) VALUES ($1, 'running') RETURNING id`,
    [startTime]
  );
  return rows[0].id;
}

async function finishCollectionRun(id, endTime, systemsCollected, status, errorMessage) {
  await pool.query(
    `UPDATE collection_runs
        SET end_time = $1, systems_collected = $2, status = $3, error_message = $4
      WHERE id = $5`,
    [endTime, systemsCollected, status, errorMessage, id]
  );
}

async function getSystemHistory(systemId, limit) {
  const { rows } = await pool.query(
    `SELECT * FROM system_activity
      WHERE system_id = $1
      ORDER BY timestamp DESC
      LIMIT $2`,
    [systemId, limit]
  );
  return rows;
}

async function getSystemActivityRange(systemId, days) {
  const { rows } = await pool.query(
    `SELECT
       DATE(timestamp) AS date,
       AVG(jumps)::float AS avg_jumps,
       AVG(ship_kills + pod_kills)::float AS avg_kills,
       AVG(activity_score)::float AS avg_score,
       MAX(jumps) AS max_jumps,
       MAX(ship_kills + pod_kills) AS max_kills
     FROM system_activity
     WHERE system_id = $1
       AND timestamp >= NOW() - ($2 || ' days')::interval
     GROUP BY DATE(timestamp)
     ORDER BY date DESC`,
    [systemId, String(days)]
  );
  return rows;
}

async function getTopChanges(limit) {
  const { rows } = await pool.query(
    `WITH recent_activity AS (
       SELECT system_id, system_name,
              AVG(activity_score)::float AS recent_avg,
              COUNT(*) AS samples
         FROM system_activity
        WHERE timestamp >= NOW() - INTERVAL '24 hours'
        GROUP BY system_id, system_name
       HAVING COUNT(*) >= 2
     ),
     previous_activity AS (
       SELECT system_id, AVG(activity_score)::float AS previous_avg
         FROM system_activity
        WHERE timestamp >= NOW() - INTERVAL '48 hours'
          AND timestamp <  NOW() - INTERVAL '24 hours'
        GROUP BY system_id
     )
     SELECT r.system_id, r.system_name, r.recent_avg, p.previous_avg,
            ((r.recent_avg - p.previous_avg) / NULLIF(p.previous_avg, 0)) * 100 AS change_percent
       FROM recent_activity r
       JOIN previous_activity p ON r.system_id = p.system_id
      WHERE ABS((r.recent_avg - p.previous_avg) / NULLIF(p.previous_avg, 0)) > 0.1
      ORDER BY ABS(((r.recent_avg - p.previous_avg) / NULLIF(p.previous_avg, 0)) * 100) DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

async function getLowActivitySystems(maxScore, limit) {
  const { rows } = await pool.query(
    `WITH latest_activity AS (
       SELECT system_id, system_name, security_status, region, constellation,
              jumps, ship_kills, pod_kills, npc_kills, activity_score,
              ROW_NUMBER() OVER (PARTITION BY system_id ORDER BY timestamp DESC) AS rn
         FROM system_activity
        WHERE timestamp >= NOW() - INTERVAL '2 hours'
     )
     SELECT * FROM latest_activity
      WHERE rn = 1 AND activity_score <= $1
      ORDER BY activity_score ASC
      LIMIT $2`,
    [maxScore, limit]
  );
  return rows;
}

async function getSystemTrends(direction, limit) {
  const { rows } = await pool.query(
    `SELECT * FROM system_trends
      WHERE trend_direction = $1
      ORDER BY (avg_daily_jumps + avg_daily_kills) ASC
      LIMIT $2`,
    [direction, limit]
  );
  return rows;
}

async function getCollectionStats() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) AS total_runs,
       COUNT(*) FILTER (WHERE status = 'success') AS successful_runs,
       COUNT(*) FILTER (WHERE status = 'failed')  AS failed_runs,
       AVG(systems_collected) FILTER (WHERE status = 'success')::float AS avg_systems_collected,
       MAX(end_time) AS last_collection
     FROM collection_runs
     WHERE created_at >= NOW() - INTERVAL '7 days'`
  );
  return rows[0];
}

async function calculateTrends() {
  const { rows: systems } = await pool.query(
    `SELECT DISTINCT system_id, system_name FROM system_activity
      WHERE timestamp >= NOW() - INTERVAL '7 days'`
  );

  for (const system of systems) {
    const { rows } = await pool.query(
      `WITH hourly_stats AS (
         SELECT EXTRACT(HOUR FROM timestamp)::int AS hour,
                AVG(jumps)::float AS avg_jumps,
                AVG(ship_kills + pod_kills)::float AS avg_kills
           FROM system_activity
          WHERE system_id = $1
            AND timestamp >= NOW() - INTERVAL '7 days'
          GROUP BY hour
       ),
       daily_stats AS (
         SELECT DATE(timestamp) AS day,
                AVG(jumps)::float AS daily_jumps,
                AVG(ship_kills + pod_kills)::float AS daily_kills
           FROM system_activity
          WHERE system_id = $1
            AND timestamp >= NOW() - INTERVAL '7 days'
          GROUP BY DATE(timestamp)
       ),
       trend_calc AS (
         SELECT AVG(daily_jumps)::float AS avg_jumps,
                AVG(daily_kills)::float AS avg_kills,
                COUNT(DISTINCT day)::int AS days_tracked,
                (SELECT COUNT(*) FROM daily_stats d2
                   WHERE d2.daily_jumps > (SELECT AVG(daily_jumps) FROM daily_stats))::int AS days_above_avg
           FROM daily_stats
       )
       SELECT t.*,
              (SELECT hour FROM hourly_stats ORDER BY avg_jumps + avg_kills DESC LIMIT 1) AS peak_hour,
              (SELECT hour FROM hourly_stats ORDER BY avg_jumps + avg_kills ASC  LIMIT 1) AS low_hour
         FROM trend_calc t`,
      [system.system_id]
    );
    const stats = rows[0];
    if (stats && stats.days_tracked > 0) {
      const trendDirection =
        stats.days_above_avg > stats.days_tracked / 2 ? 'increasing' :
        stats.days_above_avg < stats.days_tracked / 3 ? 'decreasing' : 'stable';

      await pool.query(
        `INSERT INTO system_trends (
           system_id, system_name, avg_daily_jumps, avg_daily_kills,
           trend_direction, peak_activity_hour, lowest_activity_hour, days_tracked, last_updated
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())
         ON CONFLICT (system_id) DO UPDATE SET
           avg_daily_jumps     = EXCLUDED.avg_daily_jumps,
           avg_daily_kills     = EXCLUDED.avg_daily_kills,
           trend_direction     = EXCLUDED.trend_direction,
           peak_activity_hour  = EXCLUDED.peak_activity_hour,
           lowest_activity_hour= EXCLUDED.lowest_activity_hour,
           days_tracked        = EXCLUDED.days_tracked,
           last_updated        = NOW()`,
        [
          system.system_id, system.system_name,
          stats.avg_jumps || 0, stats.avg_kills || 0,
          trendDirection, stats.peak_hour || 0, stats.low_hour || 0, stats.days_tracked
        ]
      );
    }
  }
  console.log(`Updated trends for ${systems.length} systems`);
}

async function cleanOldData() {
  const result = await pool.query(
    `DELETE FROM system_activity WHERE timestamp < NOW() - INTERVAL '30 days'`
  );
  console.log(`Cleaned ${result.rowCount} old activity records`);
}

async function upsertTopologyBatch(rows) {
  if (!rows.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      await client.query(
        `INSERT INTO system_topology (
           system_id, system_name, security_status, region, constellation,
           gate_count, connected_systems, topology_type, bottleneck_score,
           security_transitions, last_updated
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW())
         ON CONFLICT (system_id) DO UPDATE SET
           system_name          = EXCLUDED.system_name,
           security_status      = EXCLUDED.security_status,
           region               = EXCLUDED.region,
           constellation        = EXCLUDED.constellation,
           gate_count           = EXCLUDED.gate_count,
           connected_systems    = EXCLUDED.connected_systems,
           topology_type        = EXCLUDED.topology_type,
           bottleneck_score     = EXCLUDED.bottleneck_score,
           security_transitions = EXCLUDED.security_transitions,
           last_updated         = NOW()`,
        [
          r.system_id, r.system_name, r.security_status, r.region, r.constellation,
          r.gate_count, JSON.stringify(r.connected_systems), r.topology_type,
          r.bottleneck_score, JSON.stringify(r.security_transitions)
        ]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getTopologyLastUpdated() {
  const { rows } = await pool.query('SELECT MAX(last_updated) AS last_updated FROM system_topology');
  return rows[0].last_updated;
}

async function getGateCampingSystems(filters) {
  const conditions = ['1=1'];
  const params = [];
  let paramIdx = 0;

  if (filters.minBottleneck > 0) {
    conditions.push(`t.bottleneck_score >= $${++paramIdx}`);
    params.push(filters.minBottleneck);
  }
  if (filters.topologyType) {
    conditions.push(`t.topology_type = $${++paramIdx}`);
    params.push(filters.topologyType);
  }
  if (filters.secTransition) {
    const [fromSec, toSec] = filters.secTransition.split('-');
    conditions.push(`t.security_transitions @> $${++paramIdx}::jsonb`);
    params.push(JSON.stringify([{ from_sec_class: fromSec, to_sec_class: toSec }]));
  }
  if (filters.securityMin > -1.0) {
    conditions.push(`t.security_status >= $${++paramIdx}`);
    params.push(filters.securityMin);
  }
  if (filters.securityMax < 1.0) {
    conditions.push(`t.security_status <= $${++paramIdx}`);
    params.push(filters.securityMax);
  }
  if (filters.region) {
    conditions.push(`t.region = $${++paramIdx}`);
    params.push(filters.region);
  }

  const minJumpsCondition = filters.minJumps > 0
    ? `AND sa.jumps >= $${++paramIdx}` : '';
  if (filters.minJumps > 0) params.push(filters.minJumps);

  const paramsWithoutLimit = [...params];
  const limitParam = `$${++paramIdx}`;
  params.push(filters.limit);

  const { rows } = await pool.query(
    `SELECT t.*,
            COALESCE(sa.jumps, 0) AS jumps,
            COALESCE(sa.ship_kills, 0) AS ship_kills,
            COALESCE(sa.pod_kills, 0) AS pod_kills,
            COALESCE(sa.npc_kills, 0) AS npc_kills,
            COALESCE(sa.activity_score, 0) AS activity_score
       FROM system_topology t
       LEFT JOIN LATERAL (
         SELECT jumps, ship_kills, pod_kills, npc_kills, activity_score
           FROM system_activity
          WHERE system_id = t.system_id
          ORDER BY timestamp DESC
          LIMIT 1
       ) sa ON true
      WHERE ${conditions.join(' AND ')}
            ${minJumpsCondition}
      ORDER BY t.bottleneck_score DESC
      LIMIT ${limitParam}`,
    params
  );

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM system_topology t
       LEFT JOIN LATERAL (
         SELECT jumps
           FROM system_activity
          WHERE system_id = t.system_id
          ORDER BY timestamp DESC
          LIMIT 1
       ) sa ON true
      WHERE ${conditions.join(' AND ')}
            ${minJumpsCondition}`,
    paramsWithoutLimit
  );

  return { systems: rows, total: countResult.rows[0]?.total ?? rows.length };
}

async function getSystemTopology(systemId) {
  const { rows } = await pool.query(
    'SELECT * FROM system_topology WHERE system_id = $1',
    [systemId]
  );
  return rows[0] || null;
}

async function close() {
  await pool.end();
}

async function startPochvenSnapshot(sourceWindowHours) {
  const { rows } = await pool.query(
    `INSERT INTO pochven_market_snapshots (source_window_hours, status)
     VALUES ($1, 'running')
     RETURNING id`,
    [sourceWindowHours]
  );
  return rows[0].id;
}

async function finishPochvenSnapshot(id, fields) {
  await pool.query(
    `UPDATE pochven_market_snapshots
        SET completed_at = NOW(),
            status = $2,
            item_count = $3,
            system_count = $4,
            error_message = $5
      WHERE id = $1`,
    [id, fields.status, fields.item_count || 0, fields.system_count || 0, fields.error_message || null]
  );
}

async function insertPochvenOpportunities(snapshotId, opportunities) {
  if (!opportunities.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const o of opportunities) {
      await client.query(
        `INSERT INTO pochven_market_opportunities (
          snapshot_id, system_id, system_name, clade, type_id, item_name, category,
          recommendation, suggested_quantity, jita_sell_price, jita_buy_price,
          local_sell_price, local_order_count, suggested_sell_price, estimated_margin_pct,
          opportunity_score, activity_score, scarcity_score, margin_score, doctrine_relevance,
          confidence_score, logistics_risk, overstock_penalty, evidence
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
        )`,
        [
          snapshotId, o.system_id, o.system_name, o.clade, o.type_id, o.item_name, o.category,
          o.recommendation, o.suggested_quantity, o.jita_sell_price, o.jita_buy_price,
          o.local_sell_price, o.local_order_count, o.suggested_sell_price, o.estimated_margin_pct,
          o.opportunity_score, o.activity_score, o.scarcity_score, o.margin_score,
          o.doctrine_relevance, o.confidence_score, o.logistics_risk, o.overstock_penalty,
          JSON.stringify(o.evidence || {})
        ]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getLatestPochvenSnapshot() {
  const { rows } = await pool.query(
    `SELECT * FROM pochven_market_snapshots
      WHERE status = 'success'
      ORDER BY completed_at DESC
      LIMIT 1`
  );
  return rows[0] || null;
}

async function getPochvenOpportunities(filters = {}) {
  const snapshot = filters.snapshotId
    ? { id: filters.snapshotId }
    : await getLatestPochvenSnapshot();
  if (!snapshot) return { snapshot: null, opportunities: [], total: 0 };

  const conditions = ['snapshot_id = $1'];
  const params = [snapshot.id];
  let idx = 1;
  if (filters.system) {
    conditions.push(`LOWER(system_name) = LOWER($${++idx})`);
    params.push(filters.system);
  }
  if (filters.category) {
    conditions.push(`category = $${++idx}`);
    params.push(filters.category);
  }
  if (filters.recommendation) {
    conditions.push(`recommendation = $${++idx}`);
    params.push(filters.recommendation);
  }
  if (filters.minScore) {
    conditions.push(`opportunity_score >= $${++idx}`);
    params.push(filters.minScore);
  }

  const count = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM pochven_market_opportunities
      WHERE ${conditions.join(' AND ')}`,
    params
  );

  const limit = filters.limit || 100;
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT *
       FROM pochven_market_opportunities
      WHERE ${conditions.join(' AND ')}
      ORDER BY opportunity_score DESC, estimated_margin_pct DESC NULLS LAST
      LIMIT $${params.length}`,
    params
  );

  return {
    snapshot: filters.snapshotId ? snapshot : await getLatestPochvenSnapshot(),
    opportunities: rows,
    total: count.rows[0]?.total || 0
  };
}

module.exports = {
  pool,
  initializeDatabase,
  insertSystemActivity,
  insertSovereignty,
  insertActivityBatch,
  startCollectionRun,
  finishCollectionRun,
  getSystemHistory,
  getSystemActivityRange,
  getTopChanges,
  getLowActivitySystems,
  getSystemTrends,
  getCollectionStats,
  calculateTrends,
  cleanOldData,
  upsertTopologyBatch,
  getTopologyLastUpdated,
  getGateCampingSystems,
  getSystemTopology,
  startPochvenSnapshot,
  finishPochvenSnapshot,
  insertPochvenOpportunities,
  getLatestPochvenSnapshot,
  getPochvenOpportunities,
  close
};
