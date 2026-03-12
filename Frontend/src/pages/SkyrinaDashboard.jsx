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
  EXCELLENT: { 
    name: 'Excelente', 
    threshold: 90, 
    badge: '🏆 Líder',
    icon: '👑'
  },
  GOOD: { 
    name: 'Bueno', 
    threshold: 75, 
    badge: '✅ Buen desempeño',
    icon: '📈'
  },
  MEDIUM: { 
    name: 'Medio', 
    threshold: 60, 
    badge: '⚠️ En desarrollo',
    icon: '📊'
  },
  LOW: { 
    name: 'Bajo', 
    threshold: 40, 
    badge: '🔧 Necesita mejora',
    icon: '📉'
  },
  CRITICAL: { 
    name: 'Crítico', 
    threshold: 0, 
    badge: '🚨 Atención urgente',
    icon: '🆘'
  }
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
  const [lineRunData, setLineRunData] = useState({});
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [globalRealtimeTarget, setGlobalRealtimeTarget] = useState(0);
  const [lineRealtimeTargets, setLineRealtimeTargets] = useState({});
  const [lineEfficiencies, setLineEfficiencies] = useState({});
  
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  const [hoveredCard, setHoveredCard] = useState(null);
  
  // Auto-refresh state - matching LineTvDashboard
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(300); // 5 minutes in seconds (like LineTvDashboard)
  const [lastRefreshed, setLastRefreshed] = useState(new Date());

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  // Auto-refresh logic - matching LineTvDashboard
  useEffect(() => {
    let timer;
    if (autoRefresh && date) {
      timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            // Refresh data
            refreshData();
            return 300; // Reset to 5 minutes
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [autoRefresh, date]);

  // Update line details when lineData or date changes
  useEffect(() => {
    const fetchLineDetails = async () => {
      if (!lineData.length || !date) return;
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      const newRunData = {};
      const newTargets = {};
      const newEfficiencies = {};
      
      for (const line of lineData) {
        try {
          const runsRes = await axios.get(`${API_BASE}/api/line-runs/${line.lineNo}`, { headers });
          if (!runsRes.data.success) continue;
          const run = runsRes.data.runs.find(r => toYMD(r.run_date) === date);
          if (!run) continue;
          
          const detailRes = await axios.get(`${API_BASE}/api/get-run-data/${run.id}`, { headers });
          if (!detailRes.data.success) continue;
          
          newRunData[line.lineNo] = detailRes.data;
          const rt = computeRealtimeTarget(detailRes.data, date);
          newTargets[line.lineNo] = rt;
          
          // Calculate efficiency
          const finishedGarments = calculateFinishedGarments(detailRes.data);
          const operatorsCount = detailRes.data.operators?.length || 0;
          const workingHours = detailRes.data.run?.working_hours || 0;
          const sam = detailRes.data.run?.sam_minutes || 0;
          
          const availableMinutes = operatorsCount * workingHours * 60;
          const totalSAMOutput = finishedGarments * sam;
          const efficiency = availableMinutes > 0 ? (totalSAMOutput / availableMinutes) * 100 : 0;
          
          newEfficiencies[line.lineNo] = Math.round(efficiency * 100) / 100;
          
        } catch (err) {
          console.error(`Error fetching details for line ${line.lineNo}:`, err);
        }
      }
      
      setLineRunData(newRunData);
      setLineRealtimeTargets(newTargets);
      setLineEfficiencies(newEfficiencies);
      
      const sum = Object.values(newTargets).reduce((a, b) => a + b, 0);
      setGlobalRealtimeTarget(sum);
    };
    
    fetchLineDetails();
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
      
      if (isRefresh) {
        console.log('Data refreshed successfully');
      }
    } catch (err) {
      console.error(err);
      setError('No se pudieron cargar los datos del panel. Por favor inténtalo de nuevo.');
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
    setLineRunData({});
    setLineRealtimeTargets({});
    setLineEfficiencies({});
    setCountdown(300); // Reset countdown to 5 minutes
  };

  const toggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
    if (!autoRefresh) {
      setCountdown(300); // Reset countdown when turning on
    }
  };

  const manualRefresh = () => {
    setCountdown(300); // Reset countdown
    refreshData();
  };

  // Format countdown as minutes:seconds - matching LineTvDashboard
  const formatCountdown = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Format time for display - matching LineTvDashboard
  const formatTime = (date) => {
    return date.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // Sort lines by efficiency (best first)
  const getSortedLines = () => {
    return [...lineData].sort((a, b) => {
      const effA = lineEfficiencies[a.lineNo] || 0;
      const effB = lineEfficiencies[b.lineNo] || 0;
      return effB - effA;
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

  const getEfficiencyDotColor = (eff) => {
    if (eff < 40) return 'bg-red-500';
    if (eff < 60) return 'bg-orange-500';
    if (eff < 75) return 'bg-yellow-500';
    if (eff < 90) return 'bg-blue-500';
    return 'bg-green-500';
  };

  const getStatusDot = (value, type) => {
    if (value === undefined || value === null) return 'bg-gray-400';
    if (type === 'efficiency') {
      if (value < 60) return 'bg-red-500';
      if (value < 80) return 'bg-yellow-500';
      return 'bg-green-500';
    }
    if (type === 'cumplimiento') {
      if (value < 70) return 'bg-red-500';
      if (value < 90) return 'bg-yellow-500';
      return 'bg-green-500';
    }
    if (type === 'realtimeEfficiency') {
      if (value < 60) return 'bg-red-500';
      if (value < 80) return 'bg-yellow-500';
      return 'bg-green-500';
    }
    return 'bg-gray-400';
  };

  if (!user) {
    return (
      <div className="flex justify-center items-center h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-200 border-t-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600 font-medium">Cargando panel Skyrina...</p>
        </div>
      </div>
    );
  }

  const sortedLines = getSortedLines();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col">
      <NavSkyrina />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Header Section with Auto-refresh controls matching LineTvDashboard */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 mb-8 border border-white/50">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3">
                Panel Skyrina
              </h1>
              <p className="text-gray-600 mt-1 ml-1">
                Vista de rendimiento por eficiencia,{" "}
                <span className="font-semibold text-gray-900">{user.full_name || user.username}</span>
              </p>
              {lineData.length > 0 && (
                <div className="text-sm text-gray-500 mt-2 flex items-center gap-3">
                  <span>Última actualización: {formatTime(lastRefreshed)}</span>
                  {autoRefresh && (
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                      <span className="font-medium">Auto-refresh en {formatCountdown(countdown)}</span>
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              {/* Auto-refresh controls - matching LineTvDashboard style */}
              <button
                onClick={toggleAutoRefresh}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                  autoRefresh 
                    ? 'bg-green-100 text-green-700 hover:bg-green-200 border-2 border-green-300' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-2 border-gray-300'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></span>
                {autoRefresh ? 'Auto On' : 'Auto Off'}
              </button>

              {/* Manual refresh button - matching LineTvDashboard */}
              <button
                onClick={manualRefresh}
                disabled={loading}
                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2 shadow-sm transition-colors"
              >
                <span className="text-lg">🔄</span>
                Actualizar
              </button>

              <div className="flex items-center bg-gray-50 rounded-xl p-1 border border-gray-200">
                <input
                  type="date"
                  value={date}
                  onChange={handleDateChange}
                  className="w-full sm:w-auto rounded-lg border-0 bg-white px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-gray-900/20"
                />
              </div>

              <button
                onClick={() => {
                  localStorage.removeItem('token');
                  localStorage.removeItem('user');
                  navigate('/');
                }}
                className="bg-white border-2 border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 px-5 py-2 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2"
              >
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-red-100 border-2 border-red-400 text-red-700 px-6 py-4 rounded-xl mb-8 text-lg">
            ⚠️ {error}
          </div>
        )}

        {/* Summary Cards */}
        {!loading && summary && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-5 mb-8">
            {/* Objetivo Total */}
            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">Objetivo Total</p>
                  <p className="text-3xl font-bold text-gray-900">{formatNumber(summary.totalTarget)}</p>
                  <p className="text-xs text-gray-500 mt-2">piezas</p>
                </div>
              </div>
            </div>

            {/* Total Cosido */}
            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">Total Cosido</p>
                  <p className="text-3xl font-bold text-gray-900">{formatNumber(summary.totalSewed)}</p>
                  <p className="text-xs text-gray-500 mt-2">piezas</p>
                </div>
              </div>
            </div>

            {/* Eficiencia con indicador */}
            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex justify-between items-start">
                <div className="w-full">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-3 h-3 rounded-full ${getStatusDot(summary.overallEfficiency, 'efficiency')}`}></span>
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Eficiencia</p>
                  </div>
                  <p className="text-3xl font-bold text-gray-900">{formatNumber(summary.overallEfficiency)}</p>
                  <p className="text-xs text-gray-500 mt-2">%</p>
                </div>
              </div>
            </div>

            {/* Cumplimiento con indicador */}
            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex justify-between items-start">
                <div className="w-full">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-3 h-3 rounded-full ${getStatusDot(summary.targetAchievement, 'cumplimiento')}`}></span>
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Cumplimiento</p>
                  </div>
                  <p className="text-3xl font-bold text-gray-900">{summary.targetAchievement?.toFixed(1)}%</p>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                    <div
                      className="bg-gray-900 h-1.5 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(summary.targetAchievement || 0, 100)}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Meta en tiempo real */}
            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">Meta en tiempo real</p>
                  <p className="text-3xl font-bold text-gray-900">{formatNumber(globalRealtimeTarget)}</p>
                  <p className="text-xs text-gray-500 mt-2">piezas esperadas hasta ahora</p>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-3">
                    <div
                      className="bg-blue-600 h-1.5 rounded-full transition-all duration-500"
                      style={{ width: `${summary.totalTarget > 0 ? (globalRealtimeTarget / summary.totalTarget) * 100 : 0}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {summary.totalTarget > 0 ? ((globalRealtimeTarget / summary.totalTarget) * 100).toFixed(1) : 0}% del objetivo global
                  </p>
                </div>
              </div>
            </div>

            {/* Real‑time Efficiency con indicador */}
            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex justify-between items-start">
                <div className="w-full">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-3 h-3 rounded-full ${getStatusDot(
                      globalRealtimeTarget > 0 ? (summary.totalSewed / globalRealtimeTarget) * 100 : 0,
                      'realtimeEfficiency'
                    )}`}></span>
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Real‑time Target Achievement</p>
                  </div>
                  <p className="text-3xl font-bold text-gray-900">
                    {globalRealtimeTarget > 0
                      ? ((summary.totalSewed / globalRealtimeTarget) * 100).toFixed(1)
                      : '0'}%
                  </p>
                  <p className="text-xs text-gray-500 mt-2">de la meta en tiempo real</p>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-3">
                    <div
                      className="bg-purple-600 h-1.5 rounded-full transition-all duration-500"
                      style={{
                        width: `${
                          globalRealtimeTarget > 0
                            ? Math.min((summary.totalSewed / globalRealtimeTarget) * 100, 100)
                            : 0
                        }%`,
                      }}
                    ></div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {summary.totalSewed.toLocaleString()} /{' '}
                    {globalRealtimeTarget.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} piezas
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Performance Legend */}
        {!loading && sortedLines.length > 0 && (
          <div className="bg-white rounded-xl shadow-md p-4 mb-6 flex flex-wrap items-center justify-between border border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Niveles de eficiencia:</span>
              <div className="flex flex-wrap gap-3 ml-2">
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-green-500"></span>
                  <span className="text-xs text-gray-600">Excelente (90%+)</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                  <span className="text-xs text-gray-600">Bueno (75-89%)</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
                  <span className="text-xs text-gray-600">Medio (60-74%)</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-orange-500"></span>
                  <span className="text-xs text-gray-600">Bajo (40-59%)</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-red-500"></span>
                  <span className="text-xs text-gray-600">Crítico (&lt;40%)</span>
                </div>
              </div>
            </div>
            <div className="text-sm text-gray-500">
              <span className="font-medium">Ordenado por:</span> Mejor eficiencia primero
            </div>
          </div>
        )}

        {/* Line Cards - REMOVED ONCLICK NAVIGATION */}
        {!loading && sortedLines.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  Detalles de Líneas de Producción
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Vista general del rendimiento de las líneas
                </p>
              </div>
              <div className="flex gap-2">
                <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  En Ruta
                </span>
                <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-medium flex items-center gap-1">
                  <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                  Atrasado
                </span>
                <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium flex items-center gap-1">
                  <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                  Crítico
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {sortedLines.map((line, idx) => {
                const realtimeTarget = lineRealtimeTargets[line.lineNo] || 0;
                const sewed = line.totalSewed || 0;
                const variance = sewed - realtimeTarget;
                const variancePct = realtimeTarget > 0 ? (variance / realtimeTarget) * 100 : 0;
                const status = getLineStatus(variancePct, realtimeTarget);
                const achievementPct = realtimeTarget > 0 ? (sewed / realtimeTarget) * 100 : 0;
                const efficiency = lineEfficiencies[line.lineNo] || 0;
                const performanceLevel = getPerformanceLevel(efficiency);

                const statusColors = {
                  red: 'border-red-500 bg-red-50',
                  orange: 'border-orange-500 bg-orange-50',
                  green: 'border-green-500 bg-green-50',
                  yellow: 'border-yellow-500 bg-yellow-50',
                  blue: 'border-blue-500 bg-blue-50',
                  gray: 'border-gray-500 bg-gray-50'
                };

                return (
                  <div
                    key={`${line.lineNo}-${idx}`}
                    onMouseEnter={() => setHoveredCard(line.lineNo)}
                    onMouseLeave={() => setHoveredCard(null)}
                    className={`group bg-white rounded-2xl shadow-lg 
                      hover:shadow-2xl transition-all duration-300
                      transform hover:-translate-y-2
                      overflow-hidden border-2 ${
                      hoveredCard === line.lineNo ? statusColors[status.color] : 'border-transparent'
                    }`}
                  >
                    {/* Header with performance badge */}
                    <div className="bg-gradient-to-r from-gray-900 to-gray-800 px-5 py-4">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="text-white text-lg font-bold">Línea {line.lineNo}</span>
                          {/* Performance badge for top performers */}
                          {idx === 0 && (
                            <span className="text-xs bg-yellow-500/90 text-white px-2 py-1 rounded-full flex items-center gap-1">
                              <span>🥇</span> Líder
                            </span>
                          )}
                          {idx === 1 && (
                            <span className="text-xs bg-gray-400/90 text-white px-2 py-1 rounded-full flex items-center gap-1">
                              <span>🥈</span> 2º Lugar
                            </span>
                          )}
                          {idx === 2 && (
                            <span className="text-xs bg-amber-600/90 text-white px-2 py-1 rounded-full flex items-center gap-1">
                              <span>🥉</span> 3º Lugar
                            </span>
                          )}
                        </div>
                        <div className="bg-white/20 px-3 py-1 rounded-full flex items-center gap-1">
                          <span className="text-xs font-semibold text-white">{status.icon}</span>
                          <span className="text-xs font-semibold text-white">{status.text}</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-5">
                      {/* Efficiency section with performance level */}
                      <div className="mb-4 flex items-center justify-between bg-gray-50 rounded-xl p-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-3 h-3 rounded-full ${getEfficiencyDotColor(efficiency)}`}></span>
                          <span className="text-sm font-medium text-gray-700">Eficiencia</span>
                          {/* Performance level badge */}
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            efficiency >= 90 ? 'bg-green-100 text-green-700' :
                            efficiency >= 75 ? 'bg-blue-100 text-blue-700' :
                            efficiency >= 60 ? 'bg-yellow-100 text-yellow-700' :
                            efficiency >= 40 ? 'bg-orange-100 text-orange-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {performanceLevel.icon} {performanceLevel.name}
                          </span>
                        </div>
                        <span className="text-lg font-bold text-gray-900">{efficiency.toFixed(1)}%</span>
                      </div>

                      <div className="mb-4">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-600">Progreso (ahora)</span>
                          <span className="font-semibold text-gray-900">
                            {achievementPct.toFixed(1)}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all duration-500 ${
                              variancePct < -15 ? 'bg-red-500' :
                              variancePct < -5 ? 'bg-orange-500' :
                              variancePct <= 5 ? 'bg-green-500' :
                              variancePct <= 15 ? 'bg-yellow-500' : 'bg-blue-500'
                            }`}
                            style={{ width: `${Math.min(achievementPct, 100)}%` }}
                          ></div>
                        </div>

                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-gray-500">Cumplimiento RT:</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            achievementPct >= 80 ? 'bg-green-100 text-green-800' :
                            achievementPct >= 60 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {achievementPct.toFixed(1)}%
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="bg-gray-50 rounded-xl p-3">
                          <p className="text-xs text-gray-500 mb-1">Objetivo (ahora)</p>
                          <p className="text-lg font-bold text-gray-900">{formatNumber(realtimeTarget)}</p>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-3">
                          <p className="text-xs text-gray-500 mb-1">Cosido</p>
                          <p className="text-lg font-bold text-gray-900">{formatNumber(sewed)}</p>
                        </div>
                      </div>

                      <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                        <span className="text-sm text-gray-600">Variación</span>
                        <span
                          className={`font-mono font-bold flex items-center gap-1 ${
                            variance > 0 ? 'text-green-600' : variance < 0 ? 'text-red-600' : 'text-gray-600'
                          }`}
                        >
                          <span className="text-lg">{variance > 0 ? '↑' : variance < 0 ? '↓' : '→'}</span>
                          {variance > 0 ? '+' : ''}{formatNumber(variance)}
                          <span className="text-xs ml-1">
                            ({variancePct > 0 ? '+' : ''}{variancePct.toFixed(1)}%)
                          </span>
                        </span>
                      </div>

                      {/* Removed the "Haz clic para ver detalles" text */}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 rounded-lg w-1/4 mb-6"></div>
              <div className="h-96 bg-gray-100 rounded-xl"></div>
            </div>
          </div>
        )}

        {/* No data state */}
        {!loading && sortedLines.length === 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-16 text-center">
            <p className="text-gray-500 text-lg font-medium">
              No se encontraron datos de producción para esta fecha
            </p>
            <p className="text-gray-400 text-sm mt-2">
              Intenta seleccionar otra fecha
            </p>
          </div>
        )}

        {/* Assignments Table */}
        {!loading && assignments.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Contribuciones de ayuda</h2>
            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-3 text-left">Línea</th>
                      <th className="px-4 py-3 text-left">Operador lento</th>
                      <th className="px-4 py-3 text-left">Ayudado por</th>
                      <th className="px-4 py-3 text-left">Piezas ayudadas (total)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((a, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-4 py-3 font-medium">Línea {a.line_no}</td>
                        <td className="px-4 py-3">
                          Op. {a.source_operator_no}{" "}
                          {a.source_operator_name ? `(${a.source_operator_name})` : ""}
                        </td>
                        <td className="px-4 py-3">
                          Op. {a.target_operator_no}{" "}
                          {a.target_operator_name ? `(${a.target_operator_name})` : ""}
                        </td>
                        <td className="px-4 py-3">{Math.round(a.total_helped_pieces)} pcs</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-auto py-6 bg-white/80 backdrop-blur-sm border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-sm text-gray-500">
            Skyrina Dashboard • Monitoreo de Rendimiento por Eficiencia • {new Date().toLocaleDateString('es-MX')}
          </p>
        </div>
      </footer>
    </div>
  );
}