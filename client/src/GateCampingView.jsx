import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Search, Filter, RefreshCw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import GateCampCard from './GateCampCard';
import GateCampingFilters from './GateCampingFilters';

const tooltipStyle = { backgroundColor: '#1a1a2e', border: '1px solid #444' };

const TOPOLOGY_COLORS = {
  'dead-end': '#4ade80',
  'pipe': '#fbbf24',
  'junction': '#f97316',
  'hub': '#ef4444'
};

function GateCampingView({ regions, setSelectedSystem, getSecurityClass, selectedSystem }) {
  const [systems, setSystems] = useState([]);
  const [filteredSystems, setFilteredSystems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showFilters, setShowFilters] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [topologyUpdated, setTopologyUpdated] = useState(null);

  const [filters, setFilters] = useState({
    minBottleneck: 0,
    topologyType: '',
    secTransition: '',
    securityMin: -1.0,
    securityMax: 1.0,
    region: '',
    minJumps: 0,
    limit: 100
  });

  useEffect(() => {
    fetchGateCampingSystems();
  }, []);

  useEffect(() => {
    if (!searchTerm) {
      setFilteredSystems(systems);
      return;
    }
    const search = searchTerm.toLowerCase();
    setFilteredSystems(systems.filter(s =>
      (s.system_name || '').toLowerCase().includes(search) ||
      (s.region || '').toLowerCase().includes(search) ||
      (s.constellation || '').toLowerCase().includes(search)
    ));
  }, [systems, searchTerm]);

  const fetchGateCampingSystems = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { ...filters };
      if (!params.topologyType) delete params.topologyType;
      if (!params.secTransition) delete params.secTransition;
      if (!params.region) delete params.region;

      const response = await axios.get('/api/systems/gatecamping', { params });
      setSystems(response.data.systems);
      setFilteredSystems(response.data.systems);
      setTopologyUpdated(response.data.topology_updated);
    } catch (err) {
      setError('Failed to fetch gate camping data. Topology may not be collected yet.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const bottleneckChartData = filteredSystems.slice(0, 10).map(s => ({
    name: s.system_name,
    score: parseFloat((s.gate_camp_score || 0).toFixed(1)),
    jumps: s.jumps
  }));

  const topologyDistribution = ['dead-end', 'pipe', 'junction', 'hub'].map(type => ({
    name: type,
    value: filteredSystems.filter(s => s.topology_type === type).length,
    color: TOPOLOGY_COLORS[type]
  }));

  return (
    <>
      <div className="controls">
        <div className="search-bar">
          <Search size={20} />
          <input
            type="text"
            placeholder="Search systems, regions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button className="filter-toggle" onClick={() => setShowFilters(!showFilters)}>
          <Filter size={18} />
          {showFilters ? 'Hide' : 'Show'} Filters
        </button>
        <button className="refresh-btn" onClick={fetchGateCampingSystems} disabled={loading}>
          <RefreshCw size={18} className={loading ? 'spinning' : ''} />
          Refresh
        </button>
      </div>

      {showFilters && (
        <GateCampingFilters
          filters={filters}
          regions={regions}
          onFilterChange={handleFilterChange}
          onApply={fetchGateCampingSystems}
        />
      )}

      {error && <div className="error-message">{error}</div>}

      {topologyUpdated && (
        <div className="stats-bar">
          <div className="stat-item">
            <span>Topology Updated: {new Date(topologyUpdated).toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span>{filteredSystems.length} systems</span>
          </div>
        </div>
      )}

      <div className="content-grid">
        <div className="charts-section">
          <div className="chart-card">
            <h3>Top Gate Camp Locations</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={bottleneckChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={70} stroke="#888" />
                <YAxis stroke="#888" />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="score" fill="#f97316" name="Camp Score" />
                <Bar dataKey="jumps" fill="#8b5cf6" name="Jumps" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-card">
            <h3>Topology Distribution</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={topologyDistribution} cx="50%" cy="50%" outerRadius={80} dataKey="value"
                  label={({ name, value }) => value > 0 ? `${name}: ${value}` : ''}>
                  {topologyDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="systems-section">
          <div className="section-header">
            <h2>Gate Camp Targets ({filteredSystems.length} results)</h2>
            <div className="legend">
              <span className="legend-item" style={{ color: '#4ade80' }}>Dead End</span>
              <span className="legend-item" style={{ color: '#fbbf24' }}>Pipe</span>
              <span className="legend-item" style={{ color: '#f97316' }}>Junction</span>
              <span className="legend-item" style={{ color: '#ef4444' }}>Hub</span>
            </div>
          </div>

          {loading ? (
            <div className="loading">
              <RefreshCw className="spinning" size={32} />
              <p>Loading gate camping data...</p>
            </div>
          ) : (
            <div className="systems-grid">
              {filteredSystems.map(system => (
                <GateCampCard
                  key={system.system_id}
                  system={system}
                  selected={selectedSystem?.system_id === system.system_id}
                  onClick={() => setSelectedSystem(system)}
                  getSecurityClass={getSecurityClass}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default GateCampingView;
