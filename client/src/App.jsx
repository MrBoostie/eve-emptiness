import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Search, Filter, RefreshCw, AlertCircle, Shield, Zap, Users, MapPin, Activity, Clock, Database, Crosshair, ShoppingCart } from 'lucide-react';
import EmptySystemsView from './EmptySystemsView';
import GateCampingView from './GateCampingView';
import PochvenSeedingView from './PochvenSeedingView';
import './App.css';

function App() {
  const [appMode, setAppMode] = useState('empty');

  // Shared state
  const [regions, setRegions] = useState([]);
  const [constellations, setConstellations] = useState([]);
  const [selectedSystem, setSelectedSystem] = useState(null);
  const [collectionStats, setCollectionStats] = useState(null);

  // Empty systems state
  const [systems, setSystems] = useState([]);
  const [filteredSystems, setFilteredSystems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showFilters, setShowFilters] = useState(true);
  const [systemHistory, setSystemHistory] = useState(null);
  const [trendingChanges, setTrendingChanges] = useState([]);
  const [activeTab, setActiveTab] = useState('live');

  const [filters, setFilters] = useState({
    maxJumps: 50,
    maxKills: 25,
    securityMin: -1.0,
    securityMax: 1.0,
    region: '',
    constellation: '',
    searchTerm: '',
    limit: 100
  });

  useEffect(() => {
    fetchRegions();
    fetchCollectionStats();
  }, []);

  useEffect(() => {
    if (appMode === 'empty') {
      fetchSystems();
      fetchTrendingChanges();
    }
  }, [appMode]);

  useEffect(() => {
    applyLocalFilters();
  }, [systems, filters.searchTerm]);

  const fetchRegions = async () => {
    try {
      const response = await axios.get('/api/regions');
      setRegions(response.data);
    } catch (err) {
      console.error('Failed to fetch regions:', err);
    }
  };

  const fetchConstellations = async (regionId) => {
    if (!regionId) { setConstellations([]); return; }
    try {
      const response = await axios.get(`/api/constellations/${regionId}`);
      setConstellations(response.data);
    } catch (err) {
      console.error('Failed to fetch constellations:', err);
    }
  };

  const fetchSystems = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        maxJumps: filters.maxJumps,
        maxKills: filters.maxKills,
        securityMin: filters.securityMin,
        securityMax: filters.securityMax,
        limit: filters.limit
      };
      if (filters.region) params.region = filters.region;
      if (filters.constellation) params.constellation = filters.constellation;

      const response = await axios.get('/api/systems/activity', { params });
      setSystems(response.data.systems);
      setFilteredSystems(response.data.systems);
    } catch (err) {
      setError('Failed to fetch system data. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTrendingChanges = async () => {
    try {
      const response = await axios.get('/api/trending/changes');
      setTrendingChanges(response.data);
    } catch (err) {
      console.error('Failed to fetch trending changes:', err);
    }
  };

  const fetchCollectionStats = async () => {
    try {
      const response = await axios.get('/api/stats/collection');
      setCollectionStats(response.data);
    } catch (err) {
      console.error('Failed to fetch collection stats:', err);
    }
  };

  const fetchSystemHistory = async (systemId) => {
    try {
      const response = await axios.get(`/api/history/${systemId}/range?days=7`);
      setSystemHistory(response.data);
    } catch (err) {
      console.error('Failed to fetch system history:', err);
    }
  };

  const applyLocalFilters = () => {
    if (!filters.searchTerm) { setFilteredSystems(systems); return; }
    const search = filters.searchTerm.toLowerCase();
    setFilteredSystems(systems.filter(s =>
      s.name.toLowerCase().includes(search) ||
      s.region.toLowerCase().includes(search) ||
      s.constellation.toLowerCase().includes(search)
    ));
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    if (key === 'region') {
      const selectedRegion = regions.find(r => r.name === value);
      if (selectedRegion) fetchConstellations(selectedRegion.id);
      else setConstellations([]);
      setFilters(prev => ({ ...prev, constellation: '' }));
    }
  };

  const getSecurityClass = (status) => {
    if (status >= 0.5) return 'high-sec';
    if (status >= 0.0) return 'low-sec';
    return 'null-sec';
  };

  const getActivityLevel = (score) => {
    if (score === 0) return { label: 'Dead', class: 'activity-dead' };
    if (score < 100) return { label: 'Very Low', class: 'activity-very-low' };
    if (score < 500) return { label: 'Low', class: 'activity-low' };
    if (score < 1000) return { label: 'Moderate', class: 'activity-moderate' };
    return { label: 'High', class: 'activity-high' };
  };

  // Determine display name/fields based on mode
  const modalSystem = selectedSystem;
  const modalName = modalSystem?.name || modalSystem?.system_name || '';
  const isGateCamp = appMode === 'gatecamping';

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1>EVE Emptiness</h1>
          <p>
            {appMode === 'empty' && 'Find Low Activity Systems in New Eden'}
            {appMode === 'gatecamping' && 'Find Gate Camping Chokepoints in New Eden'}
            {appMode === 'pochven' && 'Activity-Driven Pochven Market Seeding'}
          </p>
        </div>
      </header>

      <div className="main-container">
        <div className="mode-switch">
          <button
            className={`mode-switch-btn mode-empty ${appMode === 'empty' ? 'active' : ''}`}
            onClick={() => { setAppMode('empty'); setSelectedSystem(null); }}
          >
            <Database size={16} />
            Empty Systems
          </button>
          <button
            className={`mode-switch-btn mode-camping ${appMode === 'gatecamping' ? 'active' : ''}`}
            onClick={() => { setAppMode('gatecamping'); setSelectedSystem(null); }}
          >
            <Crosshair size={16} />
            Gate Camping
          </button>
          <button
            className={`mode-switch-btn mode-pochven ${appMode === 'pochven' ? 'active' : ''}`}
            onClick={() => { setAppMode('pochven'); setSelectedSystem(null); }}
          >
            <ShoppingCart size={16} />
            Pochven Seeding
          </button>
        </div>

        {appMode === 'empty' ? (
          <>
            <div className="controls">
              <div className="search-bar">
                <Search size={20} />
                <input
                  type="text"
                  placeholder="Search systems, regions, or constellations..."
                  value={filters.searchTerm}
                  onChange={(e) => handleFilterChange('searchTerm', e.target.value)}
                />
              </div>
              <button className="filter-toggle" onClick={() => setShowFilters(!showFilters)}>
                <Filter size={18} />
                {showFilters ? 'Hide' : 'Show'} Filters
              </button>
              <button className="refresh-btn" onClick={fetchSystems} disabled={loading}>
                <RefreshCw size={18} className={loading ? 'spinning' : ''} />
                Refresh Data
              </button>
            </div>

            {showFilters && (
              <div className="filters-panel">
                <div className="filter-group">
                  <label><Activity size={16} /> Max Jumps (24h)</label>
                  <input type="number" value={filters.maxJumps} onChange={(e) => handleFilterChange('maxJumps', e.target.value)} />
                </div>
                <div className="filter-group">
                  <label><Zap size={16} /> Max PvP Kills (24h)</label>
                  <input type="number" value={filters.maxKills} onChange={(e) => handleFilterChange('maxKills', e.target.value)} />
                </div>
                <div className="filter-group">
                  <label><Shield size={16} /> Min Security</label>
                  <input type="number" step="0.1" min="-1.0" max="1.0" value={filters.securityMin} onChange={(e) => handleFilterChange('securityMin', e.target.value)} />
                </div>
                <div className="filter-group">
                  <label><Shield size={16} /> Max Security</label>
                  <input type="number" step="0.1" min="-1.0" max="1.0" value={filters.securityMax} onChange={(e) => handleFilterChange('securityMax', e.target.value)} />
                </div>
                <div className="filter-group">
                  <label><MapPin size={16} /> Region</label>
                  <select value={filters.region} onChange={(e) => handleFilterChange('region', e.target.value)}>
                    <option value="">All Regions</option>
                    {regions.map(r => (<option key={r.id} value={r.name}>{r.name}</option>))}
                  </select>
                </div>
                <div className="filter-group">
                  <label><MapPin size={16} /> Constellation</label>
                  <select value={filters.constellation} onChange={(e) => handleFilterChange('constellation', e.target.value)} disabled={!filters.region}>
                    <option value="">All Constellations</option>
                    {constellations.map(c => (<option key={c.id} value={c.name}>{c.name}</option>))}
                  </select>
                </div>
                <div className="filter-group">
                  <label><Users size={16} /> Result Limit</label>
                  <input type="number" value={filters.limit} onChange={(e) => handleFilterChange('limit', e.target.value)} />
                </div>
                <button className="apply-filters-btn" onClick={fetchSystems}>Apply Filters</button>
              </div>
            )}

            {error && <div className="error-message"><AlertCircle size={20} />{error}</div>}

            {collectionStats && (
              <div className="stats-bar">
                <div className="stat-item"><Database size={16} /><span>Last Collection: {collectionStats.last_collection ? new Date(collectionStats.last_collection).toLocaleString() : 'Never'}</span></div>
                <div className="stat-item"><Clock size={16} /><span>Success Rate: {collectionStats.total_runs > 0 ? Math.round((collectionStats.successful_runs / collectionStats.total_runs) * 100) : 0}%</span></div>
                <div className="stat-item"><Activity size={16} /><span>Avg Systems: {Math.round(collectionStats.avg_systems_collected || 0)}</span></div>
              </div>
            )}

            <EmptySystemsView
              filteredSystems={filteredSystems}
              loading={loading}
              selectedSystem={selectedSystem}
              setSelectedSystem={setSelectedSystem}
              fetchSystemHistory={fetchSystemHistory}
              systemHistory={systemHistory}
              trendingChanges={trendingChanges}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              getSecurityClass={getSecurityClass}
              getActivityLevel={getActivityLevel}
            />
          </>
        ) : appMode === 'gatecamping' ? (
          <GateCampingView
            regions={regions}
            selectedSystem={selectedSystem}
            setSelectedSystem={setSelectedSystem}
            getSecurityClass={getSecurityClass}
          />
        ) : (
          <PochvenSeedingView />
        )}

        {modalSystem && (
          <div className="system-details-modal" onClick={() => setSelectedSystem(null)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <button className="close-btn" onClick={() => setSelectedSystem(null)}>x</button>
              <h2>{modalName}</h2>
              <div className="details-grid">
                <div className="detail-item"><label>System ID:</label><span>{modalSystem.system_id}</span></div>
                <div className="detail-item">
                  <label>Security Status:</label>
                  <span className={getSecurityClass(modalSystem.security_status)}>{modalSystem.security_status.toFixed(2)}</span>
                </div>
                <div className="detail-item"><label>Region:</label><span>{modalSystem.region}</span></div>
                <div className="detail-item"><label>Constellation:</label><span>{modalSystem.constellation}</span></div>
                <div className="detail-item"><label>24h Jumps:</label><span>{modalSystem.jumps}</span></div>
                <div className="detail-item"><label>24h Ship Kills:</label><span>{modalSystem.ship_kills}</span></div>
                <div className="detail-item"><label>24h Pod Kills:</label><span>{modalSystem.pod_kills}</span></div>
                <div className="detail-item"><label>24h NPC Kills:</label><span>{modalSystem.npc_kills}</span></div>

                {isGateCamp && (
                  <>
                    <div className="detail-item">
                      <label>Topology:</label>
                      <span className="topology-badge-inline" style={{ color: {'dead-end': '#4ade80', pipe: '#fbbf24', junction: '#f97316', hub: '#ef4444'}[modalSystem.topology_type] || '#888' }}>
                        {modalSystem.topology_type} ({modalSystem.gate_count} gates)
                      </span>
                    </div>
                    <div className="detail-item">
                      <label>Bottleneck Score:</label>
                      <span>{(modalSystem.bottleneck_score * 100).toFixed(4)}%</span>
                    </div>
                    <div className="detail-item">
                      <label>Camp Score:</label>
                      <span className="gate-camp-score">{modalSystem.gate_camp_score?.toFixed(1) || '0.0'}</span>
                    </div>
                  </>
                )}

                {!isGateCamp && (
                  <div className="detail-item">
                    <label>Activity Score:</label>
                    <span className={getActivityLevel(modalSystem.activity_score).class}>{modalSystem.activity_score?.toFixed(1)}</span>
                  </div>
                )}
              </div>

              {isGateCamp && modalSystem.connected_systems && modalSystem.connected_systems.length > 0 && (
                <div className="modal-connected">
                  <h3>Connected Systems</h3>
                  <div className="modal-connected-list">
                    {modalSystem.connected_systems.map(c => (
                      <span key={c.system_id} className={`connected-system-modal ${getSecurityClass(c.security_status)}`}>
                        {c.system_name} ({c.security_status.toFixed(1)})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {isGateCamp && modalSystem.security_transitions && modalSystem.security_transitions.length > 0 && (
                <div className="modal-sec-transitions">
                  <h3>Security Transitions</h3>
                  {modalSystem.security_transitions.map((t, i) => (
                    <span key={i} className="sec-transition-badge modal-transition">
                      {t.from_sec_class} &rarr; {t.to_sec_class}
                    </span>
                  ))}
                </div>
              )}

              <div className="detail-actions">
                <a
                  href={`https://evemaps.dotlan.net/system/${encodeURIComponent(modalName.replace(/ /g, '_'))}`}
                  target="_blank" rel="noopener noreferrer" className="action-btn"
                >View on Dotlan</a>
                <a
                  href={`https://zkillboard.com/system/${modalSystem.system_id}/`}
                  target="_blank" rel="noopener noreferrer" className="action-btn"
                >View on zkillboard</a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
