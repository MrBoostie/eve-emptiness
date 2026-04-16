function calculateActivityScore(jumps, pvpKills, npcKills) {
  return (jumps * 10) + (pvpKills * 50) + (npcKills * 0.1);
}

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampFloat(value, fallback, min, max) {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const TREND_DIRECTIONS = new Set(['stable', 'increasing', 'decreasing']);
const TOPOLOGY_TYPES = new Set(['dead-end', 'pipe', 'junction', 'hub']);
const SEC_TRANSITIONS = new Set(['highsec-lowsec', 'lowsec-nullsec', 'highsec-nullsec']);

function classifySecurityStatus(secStatus) {
  if (secStatus >= 0.5) return 'highsec';
  if (secStatus >= 0.0) return 'lowsec';
  return 'nullsec';
}

function classifyTopology(gateCount) {
  if (gateCount <= 1) return 'dead-end';
  if (gateCount === 2) return 'pipe';
  if (gateCount === 3) return 'junction';
  return 'hub';
}

function calculateGateCampScore(bottleneckScore, jumps, shipKills, gateCount, hasSecTransition) {
  // Normalize inputs to 0-1 range for weighting
  const bnNorm = Math.min(bottleneckScore * 100, 1); // centrality is tiny; scale up
  const trafficNorm = Math.min(jumps / 5000, 1);
  const killsNorm = Math.min(shipKills / 50, 1);
  const secBonus = hasSecTransition ? 1 : 0;

  // Weighted composite: bottleneck 40%, traffic 30%, kills 20%, sec transition 10%
  const raw = (bnNorm * 0.4) + (trafficNorm * 0.3) + (killsNorm * 0.2) + (secBonus * 0.1);
  return Math.round(raw * 100 * 10) / 10; // 0-100 with one decimal
}

module.exports = {
  calculateActivityScore, clampInt, clampFloat,
  TREND_DIRECTIONS, TOPOLOGY_TYPES, SEC_TRANSITIONS,
  classifySecurityStatus, classifyTopology, calculateGateCampScore
};
