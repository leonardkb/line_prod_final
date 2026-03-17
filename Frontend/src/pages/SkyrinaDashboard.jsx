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

// Helper function to calculate finished garments
const calculateFinishedGarments = (runData) => {
  if (!runData) return 0;
  let total = 0;
  const packingKeywords = ['pack', 'emp', 'empaque', 'packing', 'finished'];
  
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

const computeRealtimeTarget = (runData, selectedDate) => {
  if (!runData || !selectedDate) return 0;
  
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
  
  const slotsWithTargets = (runData.slots || [])
    .map(slot => {
      const start = new Date(`${todayStr}T${slot.slot_start}`);
      const end = new Date(`${todayStr}T${slot.slot_end}`);
      
      const slotTarget = (runData.slotTargets || []).find(
        st => st.slot_label === slot.slot_label
      )?.slot_target || 0;
      
      return { 
        ...slot, 
        start, 
        end,
        target: Number(slotTarget)
      };
    })
    .filter(s => s.start && s.end);
  
  if (slotsWithTargets.length === 0) return 0;
  
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

// Performance level definitions
const PERFORMANCE_LEVELS = {
  EXCELLENT: { name: 'Excelente', threshold: 90, icon: '👑' },
  GOOD: { name: 'Bueno', threshold: 75, icon: '📈' },
  MEDIUM: { name: 'Medio', threshold: 60, icon: '📊' },
  LOW: { name: 'Bajo', threshold: 40, icon: '📉' },
  CRITICAL: { name: 'Crítico', threshold: 0, icon: '🆘' }
};

const getPerformanceLevel = (efficiency) => {
  if (efficiency >= 90) return PERFORMANCE_LEVELS.EXCELLENT;
  if (efficiency >= 75) return PERFORMANCE_LEVELS.GOOD;
  if (efficiency >= 60) return PERFORMANCE_LEVELS.MEDIUM;
  if (efficiency >= 40) return PERFORMANCE_LEVELS.LOW;
  return PERFORMANCE_LEVELS.CRITICAL;
};

export default function SkyrinaDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [summary, setSummary] = useState(null);
  const [lineData, setLineData] = useState([]);
  const [styleRunData, setStyleRunData] = useState([]); // Array of style runs
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [globalRealtimeTarget, setGlobalRealtimeTarget] = useState(0);
  const [hoveredCard, setHoveredCard] = useState(null);
  
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

  // Fetch all style runs for each line (one card per line-style combination)
  useEffect(() => {
    const fetchAllStyleRuns = async () => {
      if (!lineData.length || !date) return;
      
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      const styleRunsMap = new Map(); // Use Map to prevent duplicates
      let totalRealtimeTarget = 0;
      
      for (const line of lineData) {
        try {
          const runsRes = await axios.get(`${API_BASE}/api/line-runs/${line.lineNo}`, { headers });
          if (!runsRes.data.success) continue;
          
          // Get ALL runs for this line on the selected date
          const runsForDate = runsRes.data.runs.filter(r => toYMD(r.run_date) === date);
          
          for (const run of runsForDate) {
            // Create a unique key for this line+style combination
            const styleKey = `${line.lineNo}-${run.style}`;
            
            // Skip if we already have this line+style combination
            if (styleRunsMap.has(styleKey)) continue;
            
            const detailRes = await axios.get(`${API_BASE}/api/get-run-data/${run.id}`, { headers });
            if (!detailRes.data.success) continue;
            
            const runData = detailRes.data;
            const realtimeTarget = computeRealtimeTarget(runData, date);
            const finishedGarments = calculateFinishedGarments(runData);
            const operatorsCount = runData.operators?.length || 0;
            const workingHours = runData.run?.working_hours || 0;
            const sam = runData.run?.sam_minutes || 0;
            
            const availableMinutes = operatorsCount * workingHours * 60;
            const totalSAMOutput = finishedGarments * sam;
            const efficiency = availableMinutes > 0 ? (totalSAMOutput / availableMinutes) * 100 : 0;
            
            styleRunsMap.set(styleKey, {
              lineNo: line.lineNo,
              runId: run.id,
              style: run.style,
              targetPcs: run.target_pcs,
              sewed: finishedGarments,
              realtimeTarget,
              operatorsCount,
              efficiency: Math.round(efficiency * 100) / 100,
              workingHours,
              sam,
              runData
            });
            
            totalRealtimeTarget += realtimeTarget;
          }
          
        } catch (err) {
          console.error(`Error fetching details for line ${line.lineNo}:`, err);
        }
      }
      
      // Convert Map values to array and sort by efficiency (highest first)
      const uniqueStyleRuns = Array.from(styleRunsMap.values());
      uniqueStyleRuns.sort((a, b) => b.efficiency - a.efficiency);
      
      setStyleRunData(uniqueStyleRuns);
      setGlobalRealtimeTarget(totalRealtimeTarget);
    };
    
    fetchAllStyleRuns();
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

  const getLineStatus = (variancePct, target) => {
    if (target === 0) return { color: 'gray', icon: '⏸️', text: 'Sin Objetivo' };
    if (variancePct < -15) return { color: 'red', icon: '🔴', text: 'Crítico' };
    if (variancePct < -5) return { color: 'orange', icon: '🟠', text: 'Atrasado' };
    if (variancePct <= 5) return { color: 'green', icon: '🟢', text: 'En Ruta' };
    if (variancePct <= 15) return { color: 'yellow', icon: '🟡', text: 'Adelantado' };
    return { color: 'blue', icon: '🔵', text: 'Superando' };
  };

  const getEfficiencyColor = (eff) => {
    if (eff < 40) return 'text-red-600';
    if (eff < 60) return 'text-orange-600';
    if (eff < 75) return 'text-yellow-600';
    if (eff < 90) return 'text-blue-600';
    return 'text-green-600';
  };

  const getEfficiencyBgColor = (eff) => {
    if (eff < 40) return 'bg-red-100';
    if (eff < 60) return 'bg-orange-100';
    if (eff < 75) return 'bg-yellow-100';
    if (eff < 90) return 'bg-blue-100';
    return 'bg-green-100';
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col">
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

      <main className="flex-1 max-w-[1920px] mx-auto px-6 py-4 w-full">
        {/* Error message */}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-6 py-3 rounded-xl mb-4 text-lg">
            ⚠️ {error}
          </div>
        )}

        {/* Summary Cards */}
        {!loading && summary && (
          <div className="grid grid-cols-6 gap-4 mb-6">
            <div className="bg-white rounded-xl shadow-lg p-5 border border-gray-100">
              <div className="text-center">
                <p className="text-blue-900 text-xs uppercase tracking-wider font-bold mb-1">META</p>
                <p className="text-4xl font-bold text-gray-900">{formatNumber(summary.totalTarget)}</p>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-lg p-5 border border-gray-100">
              <div className="text-center">
                <p className="text-blue-900 text-xs uppercase tracking-wider font-bold mb-1">TOT PRODUCIDO</p>
                <p className="text-4xl font-bold text-gray-900">{formatNumber(summary.totalSewed)}</p>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-lg p-5 border border-gray-100">
              <div className="text-center">
                <p className="text-blue-900 text-xs uppercase tracking-wider font-bold mb-1">RT ACHIEVEMENT</p>
                <p className="text-4xl font-bold text-gray-900">
                  {globalRealtimeTarget > 0 ? ((summary.totalSewed / globalRealtimeTarget) * 100).toFixed(0) : '0'}%
                </p>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-lg p-5 border border-gray-100">
              <div className="text-center">
                <p className="text-blue-900 text-xs uppercase tracking-wider font-bold mb-1">CMP</p>
                <p className="text-4xl font-bold text-gray-900">{formatNumber(summary.targetAchievement)}%</p>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-lg p-5 border border-gray-100">
              <div className="text-center">
                <p className="text-blue-900 text-xs uppercase tracking-wider font-bold mb-1">RT TARGET</p>
                <p className="text-4xl font-bold text-gray-900">{formatNumber(globalRealtimeTarget)}</p>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-lg p-5 border border-gray-100">
              <div className="text-center">
                <p className="text-blue-900 text-xs uppercase tracking-wider font-bold mb-1">EFFICIENCY</p>
                <p className={`text-4xl font-bold ${getEfficiencyColor(summary.overallEfficiency)}`}>
                  {formatNumber(summary.overallEfficiency)}% 
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Style Run Cards - One card per line-style combination */}
        {!loading && styleRunData.length > 0 && (
          <div className="grid grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4">
            {styleRunData.map((run, idx) => {
              const variance = run.sewed - run.realtimeTarget;
              const variancePct = run.realtimeTarget > 0 ? (variance / run.realtimeTarget) * 100 : 0;
              const status = getLineStatus(variancePct, run.realtimeTarget);
              const achievementPct = run.realtimeTarget > 0 ? (run.sewed / run.realtimeTarget) * 100 : 0;
              const efficiency = run.efficiency;
              const performanceLevel = getPerformanceLevel(efficiency);

              const statusColors = {
                red: 'border-red-500',
                orange: 'border-orange-500',
                green: 'border-green-500',
                yellow: 'border-yellow-500',
                blue: 'border-blue-500',
                gray: 'border-gray-500'
              };

              const statusBgColors = {
                red: 'bg-red-50',
                orange: 'bg-orange-50',
                green: 'bg-green-50',
                yellow: 'bg-yellow-50',
                blue: 'bg-blue-50',
                gray: 'bg-gray-50'
              };

              const cardId = `${run.lineNo}-${run.style}`;

              return (
                <div
                  key={cardId}
                  onMouseEnter={() => setHoveredCard(cardId)}
                  onMouseLeave={() => setHoveredCard(null)}
                  className={`bg-white rounded-xl shadow-lg 
                    hover:shadow-xl transition-all duration-200
                    border-l-4 ${statusColors[status.color]} 
                    border-t border-r border-b border-gray-200
                    ${hoveredCard === cardId ? 'shadow-xl scale-[1.02]' : ''}`}
                >
                  {/* Header with Line and Style */}
                  <div className="px-3 py-2 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                    <div className="flex justify-between items-center mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-lg text-gray-900">L{run.lineNo}</span>
                        {idx === 0 && <span className="text-sm bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">🏆</span>}
                        {idx === 1 && <span className="text-sm bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">🥈</span>}
                        {idx === 2 && <span className="text-sm bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">🥉</span>}
                      </div>
                      <div className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBgColors[status.color]} ${statusColors[status.color].replace('border', 'text')}`}>
                        {status.icon} {status.text}
                      </div>
                    </div>
                    <div className="text-xs font-medium text-gray-600 truncate" title={run.style}>
                      {run.style}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="p-3">
                    {/* Efficiency */}
                   {/* <div className="flex items-center justify-between mb-2">
                      <span className="text-gray-500 text-xs">Ef</span>
                      <div className={`px-2 py-0.5 rounded-full text-sm font-bold ${getEfficiencyBgColor(efficiency)} ${getEfficiencyColor(efficiency)}`}>
                        {performanceLevel.icon} {efficiency.toFixed(0)}%
                      </div>
                    </div>*/}

                    {/* RT Progress */}
                    <div className="mb-3">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-500"> EFF RT</span>
                        <span className="font-bold text-gray-900">{achievementPct.toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all duration-300 ${
                            variancePct < -15 ? 'bg-red-500' :
                            variancePct < -5 ? 'bg-orange-500' :
                            variancePct <= 5 ? 'bg-green-500' :
                            variancePct <= 15 ? 'bg-yellow-500' : 'bg-blue-500'
                          }`}
                          style={{ width: `${Math.min(achievementPct, 100)}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div className="bg-gray-50 rounded-lg p-2">
                        <p className="text-gray-500 text-xs mb-1">Obj</p>
                        <p className="text-lg font-bold text-gray-900">{formatNumber(run.realtimeTarget)}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <p className="text-gray-500 text-xs mb-1">Cos</p>
                        <p className="text-lg font-bold text-gray-900">{formatNumber(run.sewed)}</p>
                      </div>
                    </div>

                    {/* Variance */}
                    <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                      <span className="text-gray-500 text-sm">Var</span>
                      <span className={`font-mono font-bold flex items-center gap-1 text-lg ${
                        variance > 0 ? 'text-green-600' : variance < 0 ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        {variance > 0 ? '↑' : variance < 0 ? '↓' : '→'}
                        {variance > 0 ? '+' : ''}{formatNumber(variance)}
                        <span className="text-xs opacity-75">
                          ({variancePct > 0 ? '+' : ''}{variancePct.toFixed(0)}%)
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
          <div className="bg-white rounded-xl shadow-lg p-8">
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
              <div className="h-64 bg-gray-100 rounded"></div>
            </div>
          </div>
        )}

        {/* No data state */}
        {!loading && styleRunData.length === 0 && (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center">
            <p className="text-gray-500 text-2xl font-medium">
              No se encontraron datos para esta fecha
            </p>
          </div>
        )}

        {/* Assignments Section */}
        {!loading && assignments.length > 0 && (
          <div className="mt-6">
            <h2 className="text-gray-900 text-xl font-bold mb-3">Contribuciones</h2>
            <div className="bg-white rounded-xl shadow-lg p-4 border border-gray-100">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-200">
                      <th className="px-4 py-2 text-left">Línea</th>
                      <th className="px-4 py-2 text-left">Operador lento</th>
                      <th className="px-4 py-2 text-left">Ayudado por</th>
                      <th className="px-4 py-2 text-left">Piezas</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-900">
                    {assignments.map((a, idx) => (
                      <tr key={idx} className="border-b border-gray-100">
                        <td className="px-4 py-2">{a.line_no}</td>
                        <td className="px-4 py-2">
                          {a.source_operator_no} {a.source_operator_name ? `(${a.source_operator_name})` : ""}
                        </td>
                        <td className="px-4 py-2">
                          {a.target_operator_no} {a.target_operator_name ? `(${a.target_operator_name})` : ""}
                        </td>
                        <td className="px-4 py-2 font-bold">{Math.round(a.total_helped_pieces)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-auto py-3 bg-white border-t border-gray-200">
        <div className="max-w-[1920px] mx-auto px-6 text-center">
          <p className="text-gray-500 text-sm">
            Skyrina Dashboard • {new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </footer>
    </div>
  );
}