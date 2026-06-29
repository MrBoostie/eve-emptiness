import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Download, Filter, RefreshCw, Search, ShoppingCart, Copy, ExternalLink } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';

const isk = (value) => {
  if (value == null || Number.isNaN(Number(value))) return 'n/a';
  const n = Number(value);
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}b`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
};

const pct = (value) => value == null ? 'n/a' : `${Number(value).toFixed(1)}%`;

function PochvenSeedingView() {
  const [opportunities, setOpportunities] = useState([]);
  const [systems, setSystems] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    search: '',
    system: '',
    category: '',
    recommendation: '',
    minScore: 0,
    limit: 150
  });

  useEffect(() => {
    fetchOpportunities();
  }, []);

  const fetchOpportunities = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        limit: filters.limit,
        maxAgeMinutes: force ? 1 : 90,
        windowHours: 24
      };
      if (filters.system) params.system = filters.system;
      if (filters.category) params.category = filters.category;
      if (filters.recommendation) params.recommendation = filters.recommendation;
      if (Number(filters.minScore) > 0) params.minScore = filters.minScore;
      if (force) params.force = true;
      const response = await axios.get('/api/pochven/opportunities', { params });
      setOpportunities(response.data.opportunities || []);
      setSystems(response.data.systems || []);
      setSnapshot(response.data.snapshot || null);
    } catch (err) {
      setError('Failed to load Pochven opportunities. External APIs may be rate-limited or unavailable.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const refreshNow = async () => {
    setRefreshing(true);
    try {
      await axios.post('/api/pochven/refresh', { windowHours: 24, limit: 500 });
      await fetchOpportunities(false);
    } catch (err) {
      setError('Pochven refresh failed. Check server logs for the external API failure.');
      console.error(err);
    } finally {
      setRefreshing(false);
    }
  };

  const visible = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    if (!search) return opportunities;
    return opportunities.filter((o) =>
      o.system_name.toLowerCase().includes(search) ||
      o.item_name.toLowerCase().includes(search) ||
      o.category.toLowerCase().includes(search) ||
      o.clade.toLowerCase().includes(search)
    );
  }, [opportunities, filters.search]);

  const categories = useMemo(() => [...new Set(opportunities.map((o) => o.category))].sort(), [opportunities]);
  const sparklineData = useMemo(() => visible.slice(0, 30).map((o, index) => ({
    index,
    score: Number(o.opportunity_score),
    activity: Number(o.activity_score) * 100
  })), [visible]);

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', String(filters.limit));
    if (filters.system) params.set('system', filters.system);
    if (filters.category) params.set('category', filters.category);
    if (filters.recommendation) params.set('recommendation', filters.recommendation);
    if (Number(filters.minScore) > 0) params.set('minScore', filters.minScore);
    return `/api/pochven/opportunities.csv?${params.toString()}`;
  }, [filters]);

  const copyBuylist = async () => {
    const text = visible
      .filter((o) => o.recommendation !== 'avoid')
      .map((o) => `${o.item_name} x${o.suggested_quantity}`)
      .join('\n');
    await navigator.clipboard.writeText(text);
  };

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <>
      <div className="controls">
        <div className="search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search Pochven systems, items, categories..."
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
          />
        </div>
        <button className="refresh-btn" onClick={() => fetchOpportunities(false)} disabled={loading}>
          <RefreshCw size={18} className={loading ? 'spinning' : ''} />
          Reload
        </button>
        <button className="refresh-btn" onClick={refreshNow} disabled={refreshing || loading}>
          <RefreshCw size={18} className={refreshing ? 'spinning' : ''} />
          Refresh APIs
        </button>
      </div>

      <div className="filters-panel pochven-filters">
        <div className="filter-group">
          <label><Filter size={16} /> System</label>
          <select value={filters.system} onChange={(e) => updateFilter('system', e.target.value)}>
            <option value="">All Pochven</option>
            {systems.map((s) => <option key={s.system_id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label><Filter size={16} /> Category</label>
          <select value={filters.category} onChange={(e) => updateFilter('category', e.target.value)}>
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label><Filter size={16} /> Call</label>
          <select value={filters.recommendation} onChange={(e) => updateFilter('recommendation', e.target.value)}>
            <option value="">All Calls</option>
            <option value="seed now">Seed Now</option>
            <option value="watch">Watch</option>
            <option value="avoid">Avoid</option>
          </select>
        </div>
        <div className="filter-group">
          <label><Filter size={16} /> Min Score</label>
          <input type="number" min="0" max="100" value={filters.minScore} onChange={(e) => updateFilter('minScore', e.target.value)} />
        </div>
        <button className="apply-filters-btn" onClick={() => fetchOpportunities(false)}>Apply</button>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="stats-bar">
        <div className="stat-item"><ShoppingCart size={16} /><span>{visible.length} opportunities</span></div>
        <div className="stat-item"><span>Snapshot: {snapshot?.completed_at ? new Date(snapshot.completed_at).toLocaleString() : 'building on first load'}</span></div>
        <div className="stat-item"><span>Confidence: public ESI + zKill, structure visibility not guaranteed</span></div>
      </div>

      <div className="pochven-dashboard">
        <div className="chart-card pochven-score-card">
          <div className="section-header compact">
            <h3>Opportunity Trend</h3>
            <div className="detail-actions inline-actions">
              <button className="action-btn compact-action" onClick={copyBuylist}><Copy size={15} /> Copy Buylist</button>
              <a className="action-btn compact-action" href={exportUrl}><Download size={15} /> CSV</a>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={sparklineData}>
              <Tooltip contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #444' }} />
              <Line type="monotone" dataKey="score" stroke="#22c55e" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="activity" stroke="#38bdf8" strokeWidth={1} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="pochven-table-wrap">
          <table className="pochven-table">
            <thead>
              <tr>
                <th>Call</th>
                <th>System</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Jita</th>
                <th>Local</th>
                <th>Sell</th>
                <th>Margin</th>
                <th>Score</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="10" className="table-empty">Loading live Pochven market evidence...</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan="10" className="table-empty">No opportunities match the current filters.</td></tr>
              ) : visible.map((o) => (
                <tr key={`${o.system_id}-${o.type_id}-${o.id}`} className={`call-${o.recommendation.replace(' ', '-')}`}>
                  <td><span className="recommendation-pill">{o.recommendation}</span></td>
                  <td>
                    <button className="link-button" onClick={() => setSelected(o)}>{o.system_name}</button>
                    <div className="muted-small">{o.clade}</div>
                  </td>
                  <td>
                    <div>{o.item_name}</div>
                    <div className="muted-small">{o.category}</div>
                  </td>
                  <td>{o.suggested_quantity.toLocaleString()}</td>
                  <td>{isk(o.jita_sell_price)}</td>
                  <td>{o.local_order_count} / {isk(o.local_sell_price)}</td>
                  <td>{isk(o.suggested_sell_price)}</td>
                  <td>{pct(o.estimated_margin_pct)}</td>
                  <td>{Number(o.opportunity_score).toFixed(2)}</td>
                  <td>
                    <button className="evidence-btn" onClick={() => setSelected(o)}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="system-details-modal" onClick={() => setSelected(null)}>
          <div className="modal-content pochven-evidence" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setSelected(null)}>x</button>
            <h2>{selected.item_name} in {selected.system_name}</h2>
            <div className="details-grid">
              <div className="detail-item"><label>Recommendation</label><span>{selected.recommendation}</span></div>
              <div className="detail-item"><label>Opportunity Score</label><span>{Number(selected.opportunity_score).toFixed(2)}</span></div>
              <div className="detail-item"><label>Confidence</label><span>{Number(selected.confidence_score).toFixed(2)}</span></div>
              <div className="detail-item"><label>Scarcity</label><span>{Number(selected.scarcity_score).toFixed(2)}</span></div>
              <div className="detail-item"><label>Doctrine Relevance</label><span>{Number(selected.doctrine_relevance).toFixed(2)}</span></div>
              <div className="detail-item"><label>Logistics Risk</label><span>{Number(selected.logistics_risk).toFixed(2)}</span></div>
              <div className="detail-item"><label>Jumps</label><span>{selected.evidence?.jumps || 0}</span></div>
              <div className="detail-item"><label>Recent zKill Losses</label><span>{selected.evidence?.zkill_killmails || 0}</span></div>
              <div className="detail-item"><label>NPC Kills</label><span>{selected.evidence?.npc_kills || 0}</span></div>
              <div className="detail-item"><label>Observed Item Losses</label><span>{selected.evidence?.observed_item_losses || 0}</span></div>
            </div>
            <div className="evidence-section">
              <h3>Matched Signals</h3>
              <div className="tag-row">
                {(selected.evidence?.matched_tags || []).map((tag) => <span key={tag} className="tag-pill">{tag}</span>)}
              </div>
              <h3>Notes</h3>
              <ul>
                {(selected.evidence?.confidence_notes || []).map((note) => <li key={note}>{note}</li>)}
              </ul>
              <h3>Sample Killmails</h3>
              <div className="killmail-list">
                {(selected.evidence?.sample_killmails || []).map((k) => (
                  <a key={k.killmail_id} href={`https://zkillboard.com/kill/${k.killmail_id}/`} target="_blank" rel="noopener noreferrer">
                    {k.killmail_id} <ExternalLink size={12} />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default PochvenSeedingView;
