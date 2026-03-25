// SkyrinaDashboard.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import NavSkyrina from '../components/NavSkyrina';

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

function toYMD(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

// Helper function to calculate finished garments from packing operations
const calculateFinishedGarments = (runData) => {
  if (!runData) return 0;
  let total = 0;
  const packingKeywords = ['pack', 'emp', 'empaque', 'packing', 'finished', 'terminado'];
  
  for (const block of runData.operations || []) {
    for (const op of block.operations || []) {
      const opName = (op.operation_name || '').toLowerCase();
      if (packingKeywords.some(keyword => opName.includes(keyword))) {
        const sewedData = op.sewed_data || {};
        for (const qty of Object.values(sewedData)) {
          total += Number(qty) || 0;
        }
      }
    }
  }
  return total;
};

// Helper function to calculate actual achieved daily efficiency based on SAM
// Uses operators_count from line_runs (planned operators) not the actual operators in run_operators
const calculateActualDailyEfficiency = (runData) => {
  if (!runData) return 0;
  
  const sewed = calculateFinishedGarments(runData);
  // Use operators_count from line_runs instead of counting actual operators
  const operatorsCount = runData.run?.operators_count || 0;
  const workingHours = runData.run?.working_hours || 0;
  const sam = runData.run?.sam_minutes || 0;
  
  if (operatorsCount === 0 || workingHours === 0 || sam === 0) return 0;
  
  // Total available minutes = operators * working hours * 60
  const availableMinutes = operatorsCount * workingHours * 60;
  
  // Total SAM produced = sewed pieces * SAM per piece
  const totalSAMOutput = sewed * sam;
  
  // Actual efficiency = (SAM produced / available minutes) * 100
  const actualEfficiency = availableMinutes > 0 ? (totalSAMOutput / availableMinutes) * 100 : 0;
  
  return Math.round(actualEfficiency * 100) / 100;
};

// Helper function to calculate total SAM output and total available minutes across all lines
const calculateGlobalEfficiencyMetrics = (styleRuns) => {
  let totalSAMOutput = 0;
  let totalAvailableMinutes = 0;
  
  for (const run of styleRuns) {
    const sewed = run.sewed;
    const sam = run.sam;
    const operatorsCount = run.operatorsCount;
    const workingHours = run.workingHours;
    
    totalSAMOutput += sewed * sam;
    totalAvailableMinutes += operatorsCount * workingHours * 60;
  }
  
  const globalEfficiency = totalAvailableMinutes > 0 
    ? (totalSAMOutput / totalAvailableMinutes) * 100 
    : 0;
  
  return {
    totalSAMOutput,
    totalAvailableMinutes,
    globalEfficiency: Math.round(globalEfficiency * 100) / 100
  };
};

// Helper function to check if production has ended for the day
const isProductionEnded = (selectedDate) => {
  if (!selectedDate) return false;
  const now = new Date();
  const todayStr = selectedDate;
  
  const PRODUCTION_END = new Date(`${todayStr}T17:36:00`);
  return now >= PRODUCTION_END;
};

// Helper function to calculate real-time efficiency (only if production hasn't ended)
const calculateRealtimeEfficiency = (runData, selectedDate) => {
  // If production has ended, return null to indicate we should show daily efficiency instead
  if (isProductionEnded(selectedDate)) {
    return null;
  }
  
  if (!runData || !selectedDate) return 0;
  
  const now = new Date();
  const todayStr = selectedDate;
  
  // Production timeline: 8:00 AM start
  const PRODUCTION_START = new Date(`${todayStr}T08:00:00`);
  
  // Get the last slot end time
  const slots = (runData.slots || [])
    .map(slot => {
      const end = new Date(`${todayStr}T${slot.slot_end}`);
      return { ...slot, end };
    })
    .filter(s => s.end);
  
  // Find the latest end time from slots
  const PRODUCTION_END = slots.length > 0 
    ? new Date(Math.max(...slots.map(s => s.end.getTime())))
    : new Date(`${todayStr}T17:36:00`);
  
  // If production hasn't started yet
  if (now < PRODUCTION_START) {
    return 0;
  }
  
  // Calculate elapsed time in minutes
  const elapsedMilliseconds = now - PRODUCTION_START;
  const elapsedMinutes = elapsedMilliseconds / (1000 * 60);
  
  // Get actual working hours so far (in minutes)
  const actualWorkingMinutes = Math.min(
    elapsedMinutes,
    (PRODUCTION_END - PRODUCTION_START) / (1000 * 60)
  );
  
  // Calculate SAM produced so far (only from packing operations)
  const sewedSoFar = calculateFinishedGarments(runData);
  const samProducedSoFar = sewedSoFar * (runData.run?.sam_minutes || 0);
  
  // Calculate available minutes so far (operators * actual time elapsed)
  const operatorsCount = runData.run?.operators_count || 0;
  const availableMinutesSoFar = operatorsCount * actualWorkingMinutes;
  
  // Calculate real-time efficiency
  const realtimeEfficiency = availableMinutesSoFar > 0 
    ? (samProducedSoFar / availableMinutesSoFar) * 100 
    : 0;
  
  return Math.round(realtimeEfficiency * 100) / 100;
};

const computeRealtimeTarget = (runData, selectedDate) => {
  if (!runData || !selectedDate) return 0;
  
  // If production has ended, return the full target
  if (isProductionEnded(selectedDate)) {
    return runData.run?.target_pcs || 0;
  }
  
  const now = new Date();
  const todayStr = selectedDate;
  
  const PRODUCTION_START = new Date(`${todayStr}T08:00:00`);
  
  const slots = (runData.slots || [])
    .map(slot => {
      const end = new Date(`${todayStr}T${slot.slot_end}`);
      return { ...slot, end };
    })
    .filter(s => s.end);
  
  const PRODUCTION_END = slots.length > 0 
    ? new Date(Math.max(...slots.map(s => s.end.getTime())))
    : new Date(`${todayStr}T17:36:00`);
  
  const totalTarget = runData.run?.target_pcs || 0;
  
  if (now < PRODUCTION_START) return 0;
  if (now >= PRODUCTION_END) return totalTarget;
  
  const elapsedMilliseconds = now - PRODUCTION_START;
  const totalProductionMilliseconds = PRODUCTION_END - PRODUCTION_START;
  
  if (totalProductionMilliseconds > 0) {
    const progressRatio = elapsedMilliseconds / totalProductionMilliseconds;
    const realTimeTarget = totalTarget * progressRatio;
    return Math.min(Math.round(realTimeTarget * 100) / 100, totalTarget);
  }
  
  return 0;
};

// Updated getLineStatus based on actual efficiency
const getLineStatus = (efficiency) => {
  if (efficiency === 0) return { color: 'gray', icon: '⏸️', text: 'Sin Datos' };
  if (efficiency < 40) return { color: 'red', icon: '🔴', text: 'Crítico' };
  if (efficiency < 60) return { color: 'orange', icon: '🟠', text: 'Bajo' };
  if (efficiency < 70) return { color: 'yellow', icon: '🟡', text: 'Medio' };
  if (efficiency < 80) return { color: 'lime', icon: '🟢', text: 'Bueno' };
  if (efficiency < 90) return { color: 'green', icon: '🟢', text: 'Muy Bueno' };
  return { color: 'emerald', icon: '👑', text: 'Excelente' };
};

// Color functions with the requested scheme
const getEfficiencyColor = (eff) => {
  if (eff >= 90) return 'text-green-800';
  if (eff >= 80) return 'text-green-600';
  if (eff >= 70) return 'text-lime-600';
  if (eff >= 60) return 'text-yellow-600';
  if (eff >= 40) return 'text-orange-600';
  return 'text-red-600';
};

const getProgressBarColor = (eff) => {
  if (eff >= 90) return 'bg-green-800';
  if (eff >= 80) return 'bg-green-600';
  if (eff >= 70) return 'bg-lime-600';
  if (eff >= 60) return 'bg-yellow-600';
  if (eff >= 40) return 'bg-orange-600';
  return 'bg-red-600';
};

const getStatusColor = (color) => {
  const colorMap = {
    gray: 'border-gray-500',
    red: 'border-red-500',
    orange: 'border-orange-500',
    yellow: 'border-yellow-500',
    lime: 'border-lime-500',
    green: 'border-green-500',
    emerald: 'border-emerald-500'
  };
  return colorMap[color] || 'border-gray-500';
};

const getStatusBgColor = (color) => {
  const colorMap = {
    gray: 'bg-gray-50',
    red: 'bg-red-50',
    orange: 'bg-orange-50',
    yellow: 'bg-yellow-50',
    lime: 'bg-lime-50',
    green: 'bg-green-50',
    emerald: 'bg-emerald-50'
  };
  return colorMap[color] || 'bg-gray-50';
};

export default function SkyrinaDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [summary, setSummary] = useState(null);
  const [lineData, setLineData] = useState([]);
  const [styleRunData, setStyleRunData] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [globalRealtimeTarget, setGlobalRealtimeTarget] = useState(0);
  const [globalRealtimeEfficiency, setGlobalRealtimeEfficiency] = useState(0);
  const [globalDailyEfficiency, setGlobalDailyEfficiency] = useState(0);
  const [hoveredCard, setHoveredCard] = useState(null);
  const [productionEnded, setProductionEnded] = useState(false);
  
  // Auto-refresh state
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(300);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/', { replace: true });
      return;
    }

    axios.get(`${API_BASE}/api/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        const user = res.data.user;
        if (user.role !== 'supervisor' && user.role !== 'skyrina') {
          if (user.role === 'line_leader') {
            navigate('/lineleader', { replace: true });
          } else {
            navigate('/planner', { replace: true });
          }
          return;
        }
        setUser(user);
        fetchDashboardData(date);
      })
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/', { replace: true });
      });
  }, []);

  // Check if production has ended
  useEffect(() => {
    const checkProductionEnded = () => {
      const ended = isProductionEnded(date);
      setProductionEnded(ended);
    };
    
    checkProductionEnded();
    const interval = setInterval(checkProductionEnded, 60000);
    return () => clearInterval(interval);
  }, [date]);

  // Auto-refresh logic
  useEffect(() => {
    let timer;
    if (autoRefresh && date) {
      timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            refreshData();
            return 300;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [autoRefresh, date]);

  // Fetch all style runs for each line
  useEffect(() => {
    const fetchAllStyleRuns = async () => {
      if (!lineData.length || !date) return;
      
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      const styleRunsMap = new Map();
      let totalRealtimeTarget = 0;
      let totalWeightedEff = 0;
      let totalTargets = 0;
      
      // For weighted efficiency calculation
      let totalSAMOutputSum = 0;
      let totalAvailableMinutesSum = 0;
      
      for (const line of lineData) {
        try {
          const runsRes = await axios.get(`${API_BASE}/api/line-runs/${line.lineNo}`, { headers });
          if (!runsRes.data.success) continue;
          
          const runsForDate = runsRes.data.runs.filter(r => toYMD(r.run_date) === date);
          
          for (const run of runsForDate) {
            const styleKey = `${line.lineNo}-${run.style}`;
            
            if (styleRunsMap.has(styleKey)) continue;
            
            const detailRes = await axios.get(`${API_BASE}/api/get-run-data/${run.id}`, { headers });
            if (!detailRes.data.success) continue;
            
            const runData = detailRes.data;
            const realtimeTarget = computeRealtimeTarget(runData, date);
            const finishedGarments = calculateFinishedGarments(runData);
            
            // Calculate actual achieved daily efficiency based on SAM using operators_count from line_runs
            const actualDailyEff = calculateActualDailyEfficiency(runData);
            
            // Calculate realtime efficiency (returns null if production ended)
            const realtimeEff = calculateRealtimeEfficiency(runData, date);
            
            const operatorsCount = runData.run?.operators_count || 0;
            const workingHours = runData.run?.working_hours || 0;
            const sam = runData.run?.sam_minutes || 0;
            
            // Accumulate for weighted global efficiency
            totalSAMOutputSum += finishedGarments * sam;
            totalAvailableMinutesSum += operatorsCount * workingHours * 60;
            
            styleRunsMap.set(styleKey, {
              lineNo: line.lineNo,
              runId: run.id,
              style: run.style,
              targetPcs: run.target_pcs,
              sewed: finishedGarments,
              realtimeTarget,
              realtimeEfficiency: realtimeEff,
              dailyEfficiency: actualDailyEff,
              operatorsCount: operatorsCount,
              workingHours: workingHours,
              sam: sam,
              runData
            });
            
            totalRealtimeTarget += realtimeTarget;
            
            if (realtimeTarget > 0 && realtimeEff !== null) {
              totalWeightedEff += realtimeEff * realtimeTarget;
              totalTargets += realtimeTarget;
            }
          }
        } catch (err) {
          console.error(`Error fetching details for line ${line.lineNo}:`, err);
        }
      }
      
      const globalEff = totalTargets > 0 ? totalWeightedEff / totalTargets : 0;
      setGlobalRealtimeEfficiency(Math.round(globalEff * 100) / 100);
      
      // Calculate weighted global daily efficiency (not average of averages)
      const weightedGlobalDaily = totalAvailableMinutesSum > 0 
        ? (totalSAMOutputSum / totalAvailableMinutesSum) * 100 
        : 0;
      setGlobalDailyEfficiency(Math.round(weightedGlobalDaily * 100) / 100);
      
      const uniqueStyleRuns = Array.from(styleRunsMap.values());
      uniqueStyleRuns.sort((a, b) => b.dailyEfficiency - a.dailyEfficiency);
      
      setStyleRunData(uniqueStyleRuns);
      setGlobalRealtimeTarget(totalRealtimeTarget);
    };
    
    fetchAllStyleRuns();
    
    const interval = setInterval(fetchAllStyleRuns, 60000);
    return () => clearInterval(interval);
  }, [lineData, date]);

  const fetchDashboardData = async (selectedDate, isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError('');
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [summaryRes, lineRes, assignmentsRes] = await Promise.all([
        axios.get(`${API_BASE}/api/supervisor/summary?date=${selectedDate}`, { headers }),
        axios.get(`${API_BASE}/api/supervisor/line-performance?date=${selectedDate}`, { headers }),
        axios.get(`${API_BASE}/api/supervisor/assignments?date=${selectedDate}`, { headers })
      ]);
      if (summaryRes.data.success) setSummary(summaryRes.data.summary);
      if (lineRes.data.success) setLineData(lineRes.data.lines);
      if (assignmentsRes.data.success) setAssignments(assignmentsRes.data.assignments);
      else setAssignments([]);
      
      setLastRefreshed(new Date());
    } catch (err) {
      console.error(err);
      setError('No se pudieron cargar los datos del panel.');
    } finally {
      if (!isRefresh) setLoading(false);
    }
  };

  const refreshData = () => {
    fetchDashboardData(date, true);
  };

  const handleDateChange = (e) => {
    const newDate = e.target.value;
    setDate(newDate);
    fetchDashboardData(newDate, false);
    setStyleRunData([]);
    setCountdown(300);
  };

  const toggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
    if (!autoRefresh) {
      setCountdown(300);
    }
  };

  const manualRefresh = () => {
    setCountdown(300);
    refreshData();
  };

  const formatCountdown = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatNumber = (value) => {
    if (value == null) return '0';
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
  };

  const formatDecimal = (value) => {
    if (value == null) return '0';
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
  };

  if (!user) {
    return (
      <div className="flex justify-center items-center h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-20 w-20 border-4 border-gray-200 border-t-gray-900 mx-auto"></div>
          <p className="mt-6 text-xl text-gray-600 font-medium">Cargando panel Skyrina...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col h-screen overflow-hidden">
      <NavSkyrina 
        userName={user?.full_name || user?.username}
        date={date}
        onDateChange={handleDateChange}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={toggleAutoRefresh}
        onManualRefresh={manualRefresh}
        loading={loading}
        lastRefreshed={lastRefreshed}
        countdown={countdown}
        formatCountdown={formatCountdown}
        formatTime={formatTime}
      />

      <main className="flex-1 max-w-[1920px] mx-auto px-4 py-2 w-full overflow-y-auto">
        {/* Error message */}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded-lg mb-2 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* Summary Cards - 6 cards in first row */}
        {!loading && summary && (
          <div className="grid grid-cols-6 gap-3 mb-4">
            {/* 1. Meta */}
            <div className="bg-white rounded-lg shadow p-3 border border-gray-200">
              <div className="text-center">
                <div className="text-blue-900 text-xs font-bold mb-1">META</div>
                <div className="text-2xl font-bold text-gray-900">{formatNumber(summary.totalTarget)}</div>
              </div>
            </div>

            {/* 2. Meta RT */}
            <div className="bg-white rounded-lg shadow p-3 border border-gray-200">
              <div className="text-center">
                <div className="text-blue-900 text-xs font-bold mb-1">META RT</div>
                <div className="text-2xl font-bold text-gray-900">{formatNumber(globalRealtimeTarget)}</div>
                <div className="text-xs text-gray-500">
                  {summary.totalTarget > 0 ? ((globalRealtimeTarget / summary.totalTarget) * 100).toFixed(1) : 0}%
                </div>
              </div>
            </div>

            {/* 3. Tot Producido */}
            <div className="bg-white rounded-lg shadow p-3 border border-gray-200">
              <div className="text-center">
                <div className="text-blue-900 text-xs font-bold mb-1">TOT PROD</div>
                <div className="text-2xl font-bold text-gray-900">{formatNumber(summary.totalSewed)}</div>
              </div>
            </div>

            {/* 4. Eficiencia RT - Only show if production hasn't ended */}
            {!productionEnded ? (
              <div className="bg-white rounded-lg shadow p-3 border border-gray-200">
                <div className="text-center">
                  <div className="text-blue-900 text-xs font-bold mb-1">EFF RT</div>
                  <div className={`text-2xl font-bold ${getEfficiencyColor(globalRealtimeEfficiency)}`}>
                    {formatDecimal(globalRealtimeEfficiency)}%
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow p-3 border border-gray-200">
                <div className="text-center">
                  <div className="text-blue-900 text-xs font-bold mb-1">EFF RT</div>
                  <div className="text-2xl font-bold text-gray-400">FIN</div>
                </div>
              </div>
            )}

            {/* 5. Diario Eff - Weighted global daily efficiency */}
            <div className="bg-white rounded-lg shadow p-3 border border-gray-200">
              <div className="text-center">
                <div className="text-blue-900 text-xs font-bold mb-1">DIARIO</div>
                <div className={`text-2xl font-bold ${getEfficiencyColor(globalDailyEfficiency)}`}>
                  {formatDecimal(globalDailyEfficiency)}%
                </div>
              </div>
            </div>

            {/* 6. Cump */}
            <div className="bg-white rounded-lg shadow p-3 border border-gray-200">
              <div className="text-center">
                <div className="text-blue-900 text-xs font-bold mb-1">CUMP</div>
                <div className="text-2xl font-bold text-gray-900">{formatNumber(summary.targetAchievement)}%</div>
              </div>
            </div>
          </div>
        )}

        {/* Style Run Cards - 7 cards per row */}
        {!loading && styleRunData.length > 0 && (
          <div className="grid grid-cols-7 gap-3">
            {styleRunData.map((run, idx) => {
              // After 5:36 PM, show daily efficiency instead of real-time
              const showRealtime = !productionEnded && run.realtimeEfficiency !== null;
              // Use daily efficiency after production ends
              const displayEfficiency = showRealtime ? run.realtimeEfficiency : run.dailyEfficiency;
              const displayLabel = showRealtime ? 'Eff RT' : 'Efficiency';
              const status = getLineStatus(displayEfficiency);
              const cardId = `${run.lineNo}-${run.style}`;

              return (
                <div
                  key={cardId}
                  onMouseEnter={() => setHoveredCard(cardId)}
                  onMouseLeave={() => setHoveredCard(null)}
                  className={`bg-white rounded-lg shadow-md 
                    hover:shadow-lg transition-all duration-200
                    border-l-4 ${getStatusColor(status.color)} 
                    border-t border-r border-b border-gray-200
                    ${hoveredCard === cardId ? 'shadow-lg scale-[1.01]' : ''}`}
                >
                  {/* Header */}
                  <div className="px-2 py-1.5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="font-bold text-base text-gray-900">L{run.lineNo}</span>
                      <div className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${getStatusBgColor(status.color)}`}>
                        {status.icon}
                      </div>
                    </div>
                    <div className="text-xs font-medium text-gray-600 truncate" title={run.style}>
                      {run.style}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="p-2">
                    {/* Efficiency Display - Shows Eff RT before 5:36, Efficiency after */}
                    <div className="mb-2">
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="text-[10px] text-gray-500">{displayLabel}</span>
                        <span className={`text-sm font-bold ${getEfficiencyColor(displayEfficiency)}`}>
                          {displayEfficiency.toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all duration-500 ${getProgressBarColor(displayEfficiency)}`}
                          style={{ width: `${Math.min(displayEfficiency, 100)}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Stats - Two columns */}
                    <div className="grid grid-cols-2 gap-1 mb-2">
                      <div className="bg-gray-50 rounded p-1.5">
                        <div className="text-[9px] text-gray-500 mb-0.5">Obj RT</div>
                        <div className="text-sm font-bold text-gray-900">{formatNumber(run.realtimeTarget)}</div>
                      </div>
                      <div className="bg-gray-50 rounded p-1.5">
                        <div className="text-[9px] text-gray-500 mb-0.5">Cosido</div>
                        <div className="text-sm font-bold text-gray-900">{formatNumber(run.sewed)}</div>
                      </div>
                    </div>

                    {/* Variance */}
                    <div className="flex justify-between items-center pt-1.5 border-t border-gray-100">
                      <span className="text-[10px] text-gray-500">Var</span>
                      <span className={`font-mono font-bold flex items-center gap-0.5 text-xs ${
                        run.sewed > run.realtimeTarget ? 'text-green-600' : 
                        run.sewed < run.realtimeTarget ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        {run.sewed > run.realtimeTarget ? '↑' : run.sewed < run.realtimeTarget ? '↓' : '→'}
                        {run.sewed > run.realtimeTarget ? '+' : ''}{formatNumber(Math.abs(run.sewed - run.realtimeTarget))}
                        <span className="text-[8px] opacity-75">
                          ({run.realtimeTarget > 0 ? Math.abs(((run.sewed - run.realtimeTarget) / run.realtimeTarget * 100)).toFixed(0) : 0}%)
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="bg-white rounded-xl shadow p-6">
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
              <div className="h-48 bg-gray-100 rounded"></div>
            </div>
          </div>
        )}

        {/* No data state */}
        {!loading && styleRunData.length === 0 && (
          <div className="bg-white rounded-xl shadow p-12 text-center">
            <p className="text-gray-500 text-xl font-medium">
              No se encontraron datos para esta fecha
            </p>
          </div>
        )}

        {/* Assignments Section */}
        {!loading && assignments.length > 0 && (
          <div className="mt-4">
            <h2 className="text-gray-900 text-base font-bold mb-2">Contribuciones</h2>
            <div className="bg-white rounded-lg shadow p-3 border border-gray-200">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-200">
                      <th className="px-3 py-2 text-left">Línea</th>
                      <th className="px-3 py-2 text-left">Operador lento</th>
                      <th className="px-3 py-2 text-left">Ayudado por</th>
                      <th className="px-3 py-2 text-left">Piezas</th>
                     </tr>
                  </thead>
                  <tbody className="text-gray-900">
                    {assignments.map((a, idx) => (
                      <tr key={idx} className="border-b border-gray-100">
                        <td className="px-3 py-2">{a.line_no}</td>
                        <td className="px-3 py-2">
                          {a.source_operator_no} {a.source_operator_name ? `(${a.source_operator_name})` : ""}
                        </td>
                        <td className="px-3 py-2">
                          {a.target_operator_no} {a.target_operator_name ? `(${a.target_operator_name})` : ""}
                        </td>
                        <td className="px-3 py-2 font-bold">{Math.round(a.total_helped_pieces)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="py-2 bg-white border-t border-gray-200">
        <div className="max-w-[1920px] mx-auto px-4 text-center">
          <p className="text-gray-500 text-xs">
            Skyrina Dashboard • {new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </footer>
    </div>
  );
}