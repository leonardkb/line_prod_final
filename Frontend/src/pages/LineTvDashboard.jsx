// LineTvDashboard.jsx
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import Navlines from '../components/Navlines';

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

function toYMD(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

// Helper function to calculate finished garments (empaque)
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

// Helper function to calculate real-time efficiency
const calculateRealtimeEfficiency = (runData, selectedDate) => {
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
  
  // If production has ended for the day
  if (now >= PRODUCTION_END) {
    // Calculate full day efficiency using total production
    const sewed = calculateFinishedGarments(runData);
    const totalSAMOutput = sewed * (runData.run?.sam_minutes || 0);
    const totalAvailableMinutes = (runData.operators?.length || 0) * 
                                  (runData.run?.working_hours || 0) * 60;
    
    return totalAvailableMinutes > 0 
      ? (totalSAMOutput / totalAvailableMinutes) * 100 
      : 0;
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
  const operatorsCount = runData.operators?.length || 0;
  const availableMinutesSoFar = operatorsCount * actualWorkingMinutes;
  
  // Calculate real-time efficiency
  const realtimeEfficiency = availableMinutesSoFar > 0 
    ? (samProducedSoFar / availableMinutesSoFar) * 100 
    : 0;
  
  return Math.round(realtimeEfficiency * 100) / 100;
};

const computeRealtimeTarget = (runData, selectedDate) => {
  if (!runData || !selectedDate) return 0;
  
  const now = new Date();
  const todayStr = selectedDate;
  
  // Production timeline: 8:00 AM to 5:36 PM
  const PRODUCTION_START = new Date(`${todayStr}T08:00:00`);
  
  // Get slots with their end times
  const slots = (runData.slots || [])
    .map(slot => {
      const end = new Date(`${todayStr}T${slot.slot_end}`);
      return { ...slot, end };
    })
    .filter(s => s.end);
  
  // Find the latest end time from slots (should be 17:36:00)
  const PRODUCTION_END = slots.length > 0 
    ? new Date(Math.max(...slots.map(s => s.end.getTime())))
    : new Date(`${todayStr}T17:36:00`);
  
  // Get total target
  const totalTarget = runData.run?.target_pcs || 0;
  
  // If production hasn't started yet (before 8:00 AM)
  if (now < PRODUCTION_START) {
    return 0;
  }
  
  // If production is complete (after 5:36 PM)
  if (now >= PRODUCTION_END) {
    return totalTarget;
  }
  
  // Calculate real-time target based on time elapsed since 8:00 AM
  const elapsedMilliseconds = now - PRODUCTION_START;
  const totalProductionMilliseconds = PRODUCTION_END - PRODUCTION_START;
  
  if (totalProductionMilliseconds > 0) {
    const progressRatio = elapsedMilliseconds / totalProductionMilliseconds;
    const cumulative = totalTarget * progressRatio;
    return Math.min(Math.round(cumulative * 100) / 100, totalTarget);
  }
  
  return 0;
};

export default function LineTvDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState(null);
  const [date, setDate] = useState(searchParams.get('date') || new Date().toISOString().split('T')[0]);
  const [lineNo, setLineNo] = useState(searchParams.get('line') || '');
  const [runData, setRunData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Auto-refresh state
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(300); // 5 minutes in seconds
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  
  // Card data
  const [realtimeTarget, setRealtimeTarget] = useState(0);
  const [finishedGarments, setFinishedGarments] = useState(0);
  const [realtimeEfficiency, setRealtimeEfficiency] = useState(0);
  const [styleInfo, setStyleInfo] = useState({ name: '', code: '' });
  const [operatorsCount, setOperatorsCount] = useState(0);
  const [sam, setSam] = useState(0);

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
        setUser(res.data.user);
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
    if (autoRefresh && lineNo && date) {
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
  }, [autoRefresh, lineNo, date]);

  // Refresh data function
  const refreshData = async () => {
    if (lineNo && date) {
      console.log('Auto-refreshing data...');
      await fetchLineData(lineNo, date, true);
      setLastRefreshed(new Date());
    }
  };

  // Manual refresh handler
  const handleManualRefresh = () => {
    setCountdown(300);
    refreshData();
  };

  // Toggle auto-refresh
  const toggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
    if (!autoRefresh) {
      setCountdown(300);
    }
  };

  // Format countdown as minutes:seconds
  const formatCountdown = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Format time for display
  const formatTime = (date) => {
    return date.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  useEffect(() => {
    if (lineNo && date) {
      fetchLineData(lineNo, date);
    }
  }, [lineNo, date]);

  const fetchLineData = async (line, selectedDate, isRefresh = false) => {
    if (!line || !selectedDate) return;
    
    setLoading(true);
    setError('');
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };

    try {
      const runsRes = await axios.get(`${API_BASE}/api/line-runs/${line}`, { headers });
      if (!runsRes.data.success) {
        setError('No se pudo obtener información de la línea');
        return;
      }

      const run = runsRes.data.runs.find(r => toYMD(r.run_date) === selectedDate);
      if (!run) {
        setError('No hay datos de producción para esta fecha');
        return;
      }

      const detailRes = await axios.get(`${API_BASE}/api/get-run-data/${run.id}`, { headers });
      if (!detailRes.data.success) {
        setError('No se pudieron cargar los detalles de producción');
        return;
      }

      setRunData(detailRes.data);
      
      // Calculate values
      const rt = computeRealtimeTarget(detailRes.data, selectedDate);
      setRealtimeTarget(rt);

      // Calculate finished garments (empaque)
      const finished = calculateFinishedGarments(detailRes.data);
      setFinishedGarments(finished);
      
      const operatorsCount = detailRes.data.operators?.length || 0;
      setOperatorsCount(operatorsCount);
      
      const workingHours = detailRes.data.run?.working_hours || 0;
      const sam = detailRes.data.run?.sam_minutes || 0;
      setSam(sam);
      
      // Calculate real-time efficiency
      const rtEff = calculateRealtimeEfficiency(detailRes.data, selectedDate);
      setRealtimeEfficiency(rtEff);

      setStyleInfo({
        name: detailRes.data.run?.style || 'N/A',
        code: detailRes.data.run?.style_code || 'N/A'
      });

      if (isRefresh) {
        console.log('Data refreshed successfully');
      }

    } catch (err) {
      console.error('Error fetching line data:', err);
      setError('Error al cargar los datos');
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (newDate) => {
    setDate(newDate);
    setCountdown(300);
  };

  const handleLineChange = (newLine) => {
    setLineNo(newLine);
    setRunData(null);
    setFinishedGarments(0);
    setRealtimeTarget(0);
    setRealtimeEfficiency(0);
    setCountdown(300);
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

  const getStatusColor = (variancePct) => {
    if (variancePct < -15) return { bg: 'bg-red-50', border: 'border-red-500', text: 'text-red-700', badge: 'bg-red-100 text-red-800', icon: '🔴', label: 'Crítico' };
    if (variancePct < -5) return { bg: 'bg-orange-50', border: 'border-orange-500', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-800', icon: '🟠', label: 'Atrasado' };
    if (variancePct <= 5) return { bg: 'bg-green-50', border: 'border-green-500', text: 'text-green-700', badge: 'bg-green-100 text-green-800', icon: '🟢', label: 'En Ruta' };
    if (variancePct <= 15) return { bg: 'bg-yellow-50', border: 'border-yellow-500', text: 'text-yellow-700', badge: 'bg-yellow-100 text-yellow-800', icon: '🟡', label: 'Adelantado' };
    return { bg: 'bg-blue-50', border: 'border-blue-500', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-800', icon: '🔵', label: 'Superando' };
  };

  const getEfficiencyColor = (eff) => {
    if (eff >= 80) return 'text-green-600';
    if (eff >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getProgressBarColor = (eff) => {
    if (eff >= 80) return 'bg-green-600';
    if (eff >= 60) return 'bg-yellow-600';
    return 'bg-red-600';
  };

  if (!user) {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-100">
        <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-200 border-t-gray-900"></div>
      </div>
    );
  }

  const variance = finishedGarments - realtimeTarget;
  const variancePct = realtimeTarget > 0 ? (variance / realtimeTarget) * 100 : 0;
  const status = getStatusColor(variancePct);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <Navlines 
        user={user}
        selectedLine={lineNo}
        selectedDate={date}
        onLineChange={handleLineChange}
        onDateChange={handleDateChange}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={toggleAutoRefresh}
        onManualRefresh={handleManualRefresh}
        loading={loading}
        lastRefreshed={lastRefreshed}
        countdown={countdown}
        formatCountdown={formatCountdown}
        formatTime={formatTime}
      />

      <main className="flex-1 max-w-6xl mx-auto px-4 py-4 w-full">
        {/* Error message */}
        {error && (
          <div className="bg-red-100 border-2 border-red-400 text-red-700 px-4 py-2 rounded-lg mb-4 text-base">
            ⚠️ {error}
          </div>
        )}

        {/* Loading */}
        {loading && lineNo && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-200 border-t-gray-900 mx-auto"></div>
            <p className="mt-3 text-lg text-gray-600">Cargando datos...</p>
          </div>
        )}

        {/* COMPACT LINE CARD - OPTIMIZED FOR 28-30 INCH TV */}
        {!loading && lineNo && runData && (
          <div className={`border-4 ${status.border} rounded-xl overflow-hidden shadow-xl`}>
            {/* Header - Compact */}
            <div className={`${status.bg} px-5 py-3 flex justify-between items-center`}>
              <div className="flex items-center gap-3">
                <span className="text-3xl font-bold text-gray-900">Línea {lineNo}</span>
                <span className="text-2xl">{status.icon}</span>
              </div>
              <div className={`${status.badge} px-4 py-1.5 rounded-full text-lg font-semibold shadow`}>
                {status.label}
              </div>
            </div>

            {/* Card Content - Compact */}
            <div className="p-5 bg-white">
              {/* Style info - Compact */}
              <div className="mb-3 text-base text-gray-600 font-medium border-b pb-2">
                {styleInfo.code} - {styleInfo.name}
              </div>

              {/* Operator Info - 2 columns */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-sm text-gray-600 mb-1">Operadores</div>
                  <div className="text-2xl font-bold text-gray-900">{operatorsCount}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-sm text-gray-600 mb-1">SAM</div>
                  <div className="text-2xl font-bold text-gray-900">{formatDecimal(sam)}</div>
                </div>
              </div>

              {/* Real-time Efficiency Section - Compact */}
              <div className="mb-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-lg text-gray-700 font-semibold">Eficiencia RT:</span>
                  <span className={`text-2xl font-bold ${getEfficiencyColor(realtimeEfficiency)}`}>
                    {formatDecimal(realtimeEfficiency)}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className={`h-3 rounded-full transition-all duration-500 ${getProgressBarColor(realtimeEfficiency)}`}
                    style={{ width: `${Math.min(realtimeEfficiency, 100)}%` }}
                  ></div>
                </div>
              </div>

              {/* Two column grid - Compact */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-base text-blue-800 font-medium mb-1">Objetivo (ahora)</div>
                  <div className="text-3xl font-bold text-blue-900">{formatNumber(realtimeTarget)}</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <div className="text-base text-green-800 font-medium mb-1">Cosido</div>
                  <div className="text-3xl font-bold text-green-900">{formatNumber(finishedGarments)}</div>
                </div>
              </div>

              {/* Variance - Compact */}
              <div className="flex justify-between items-center pt-3 border-t-2 border-gray-200">
                <span className="text-lg text-gray-700 font-semibold">Variación</span>
                <span className={`font-bold flex items-center gap-2 text-xl ${
                  variance > 0 ? 'text-green-600' : variance < 0 ? 'text-red-600' : 'text-gray-600'
                }`}>
                  <span className="text-2xl">{variance > 0 ? '↑' : variance < 0 ? '↓' : '→'}</span>
                  <span>{variance > 0 ? '+' : ''}{formatNumber(variance)}</span>
                  
                </span>
              </div>
            </div>
          </div>
        )}

        {/* No line selected - Compact message */}
        {!lineNo && (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center">
            <div className="text-5xl mb-4">📺</div>
            <h2 className="text-3xl font-bold text-gray-800 mb-2">Selecciona una línea</h2>
            <p className="text-lg text-gray-500">para ver los datos en tiempo real</p>
          </div>
        )}
      </main>
    </div>
  );
}