import React from 'react';
import { Shield, MapPin, Activity, Zap, Users } from 'lucide-react';

function GateCampingFilters({ filters, regions, onFilterChange, onApply }) {
  return (
    <div className="filters-panel">
      <div className="filter-group">
        <label><Activity size={16} /> Min Bottleneck Score</label>
        <input
          type="range" min="0" max="0.01" step="0.0001"
          value={filters.minBottleneck}
          onChange={(e) => onFilterChange('minBottleneck', parseFloat(e.target.value))}
        />
        <span className="range-value">{(filters.minBottleneck * 100).toFixed(2)}%</span>
      </div>

      <div className="filter-group">
        <label><Zap size={16} /> Topology Type</label>
        <select value={filters.topologyType} onChange={(e) => onFilterChange('topologyType', e.target.value)}>
          <option value="">All Types</option>
          <option value="dead-end">Dead End</option>
          <option value="pipe">Pipe</option>
          <option value="junction">Junction</option>
          <option value="hub">Hub</option>
        </select>
      </div>

      <div className="filter-group">
        <label><Shield size={16} /> Security Transition</label>
        <select value={filters.secTransition} onChange={(e) => onFilterChange('secTransition', e.target.value)}>
          <option value="">Any Transition</option>
          <option value="highsec-lowsec">Highsec to Lowsec</option>
          <option value="lowsec-nullsec">Lowsec to Nullsec</option>
          <option value="highsec-nullsec">Highsec to Nullsec</option>
        </select>
      </div>

      <div className="filter-group">
        <label><Shield size={16} /> Min Security</label>
        <input
          type="number" step="0.1" min="-1.0" max="1.0"
          value={filters.securityMin}
          onChange={(e) => onFilterChange('securityMin', e.target.value)}
        />
      </div>

      <div className="filter-group">
        <label><Shield size={16} /> Max Security</label>
        <input
          type="number" step="0.1" min="-1.0" max="1.0"
          value={filters.securityMax}
          onChange={(e) => onFilterChange('securityMax', e.target.value)}
        />
      </div>

      <div className="filter-group">
        <label><MapPin size={16} /> Region</label>
        <select value={filters.region} onChange={(e) => onFilterChange('region', e.target.value)}>
          <option value="">All Regions</option>
          {regions.map(r => (
            <option key={r.id} value={r.name}>{r.name}</option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label><Activity size={16} /> Min Jumps (Traffic)</label>
        <input
          type="number" min="0"
          value={filters.minJumps}
          onChange={(e) => onFilterChange('minJumps', e.target.value)}
        />
      </div>

      <div className="filter-group">
        <label><Users size={16} /> Result Limit</label>
        <input
          type="number"
          value={filters.limit}
          onChange={(e) => onFilterChange('limit', e.target.value)}
        />
      </div>

      <button className="apply-filters-btn" onClick={onApply}>Apply Filters</button>
    </div>
  );
}

export default GateCampingFilters;
