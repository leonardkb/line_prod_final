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

export default function LineTvDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState(null);
  const [date, setDate] = useState(searchParams.get('date') || new Date().toISOString().split('T')[0]);
  const [lineNo, setLineNo] = useState(searchParams.get('line') || '');
  const [runData, setRunData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lines, setLines] = useState([]);
  const [loadingLines, setLoadingLines] = useState(true);
  
  // Auto-refresh state
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(300); // 5 minutes in seconds
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  
  // Card data
  const [realtimeTarget, setRealtimeTarget] = useState(0);
  const [finishedGarments, setFinishedGarments] = useState(0);
  const [efficiency, setEfficiency] = useState(0);
  const [styleInfo, setStyleInfo] = useState({ name: '', code: '' });

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
        fetchAllLines();
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

  // Fetch all lines from database
  const fetchAllLines = async () => {
    setLoadingLines(true);
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };

    try {
      const response = await axios.get(`${API_BASE}/api/lines`, { headers });
      if (response.data.success && response.data.lines) {
        setLines(response.data.lines);
      } else {
        const defaultLines = Array.from({ length: 20 }, (_, i) => ({
          line_no: i + 1,
          line_name: `Línea ${i + 1}`
        }));
        setLines(defaultLines);
      }
    } catch (err) {
      console.error('Error fetching lines:', err);
      const defaultLines = Array.from({ length: 20 }, (_, i) => ({
        line_no: i + 1,
        line_name: `Línea ${i + 1}`
      }));
      setLines(defaultLines);
    } finally {
      setLoadingLines(false);
    }
  };

  useEffect(() => {
    if (lineNo && date) {
      fetchLineData(lineNo, date);
    }
  }, [lineNo, date]);

  const computeRealtimeTarget = (runData, selectedDate) => {
    if (!runData || !selectedDate) return 0;
    const now = new Date();
    const todayStr = selectedDate;
    const slots = (runData.slots || [])
      .map(slot => {
        const start = new Date(`${todayStr}T${slot.slot_start}`);
        const end = new Date(`${todayStr}T${slot.slot_end}`);
        return { ...slot, start, end };
      })
      .filter(s => s.start && s.end);
    let cumulative = 0;
    for (const slot of slots) {
      const slotTarget = (runData.slotTargets || []).find(
        st => st.slot_label === slot.slot_label
      )?.slot_target || 0;
      if (now >= slot.end) {
        cumulative += Number(slotTarget);
      } else if (now >= slot.start && now < slot.end) {
        const elapsed = (now - slot.start) / (slot.end - slot.start);
        cumulative += Number(slotTarget) * elapsed;
        break;
      } else {
        break;
      }
    }
    return Math.round(cumulative * 100) / 100;
  };

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
      const workingHours = detailRes.data.run?.working_hours || 0;
      const sam = detailRes.data.run?.sam_minutes || 0;
      
      const availableMinutes = operatorsCount * workingHours * 60;
      const totalSAMOutput = finished * sam;
      const eff = availableMinutes > 0 ? (totalSAMOutput / availableMinutes) * 100 : 0;
      setEfficiency(Math.round(eff * 100) / 100);

      setStyleInfo({
        name: detailRes.data.run?.style_name || 'N/A',
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

  const handleDateChange = (e) => {
    const newDate = e.target.value;
    setDate(newDate);
    setCountdown(300);
  };

  const handleLineChange = (e) => {
    const newLine = e.target.value;
    setLineNo(newLine);
    setRunData(null);
    setFinishedGarments(0);
    setRealtimeTarget(0);
    setEfficiency(0);
    setCountdown(300);
  };

  const formatNumber = (value) => {
    if (value == null) return '0';
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
  };

  const getStatusColor = (variancePct) => {
    if (variancePct < -15) return { bg: 'bg-red-50', border: 'border-red-500', text: 'text-red-700', badge: 'bg-red-100 text-red-800', icon: '🔴', label: 'Crítico' };
    if (variancePct < -5) return { bg: 'bg-orange-50', border: 'border-orange-500', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-800', icon: '🟠', label: 'Atrasado' };
    if (variancePct <= 5) return { bg: 'bg-green-50', border: 'border-green-500', text: 'text-green-700', badge: 'bg-green-100 text-green-800', icon: '🟢', label: 'En Ruta' };
    if (variancePct <= 15) return { bg: 'bg-yellow-50', border: 'border-yellow-500', text: 'text-yellow-700', badge: 'bg-yellow-100 text-yellow-800', icon: '🟡', label: 'Adelantado' };
    return { bg: 'bg-blue-50', border: 'border-blue-500', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-800', icon: '🔵', label: 'Superando' };
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
  const achievementPct = realtimeTarget > 0 ? (finishedGarments / realtimeTarget) * 100 : 0;
  const status = getStatusColor(variancePct);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <Navlines />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Header - Slightly larger for TV */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Panel TV - Línea de Producción</h1>
            {lineNo && (
              <div className="text-base text-gray-500 mt-2 flex items-center gap-3">
                <span>Última actualización: {formatTime(lastRefreshed)}</span>
                {autoRefresh && (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
                    <span className="font-medium">Auto-refresh en {formatCountdown(countdown)}</span>
                  </span>
                )}
              </div>
            )}
          </div>
          
          {/* Controls - Larger buttons for TV */}
          <div className="flex flex-wrap gap-3 w-full sm:w-auto">
            <select
              value={lineNo}
              onChange={handleLineChange}
              className="border-2 rounded-lg px-4 py-3 text-base flex-1 sm:flex-none min-w-[200px] bg-white shadow-sm"
              disabled={loadingLines}
            >
              <option value="">
                {loadingLines ? 'Cargando líneas...' : 'Seleccionar Línea'}
              </option>
              {lines.map((line) => (
                <option key={line.line_no} value={line.line_no}>
                  {line.line_name || `Línea ${line.line_no}`}
                </option>
              ))}
            </select>
            
            <input
              type="date"
              value={date}
              onChange={handleDateChange}
              className="border-2 rounded-lg px-4 py-3 text-base bg-white shadow-sm"
            />
            
            <button
              onClick={toggleAutoRefresh}
              className={`px-4 py-3 rounded-lg text-base font-medium flex items-center gap-2 transition-colors ${
                autoRefresh 
                  ? 'bg-green-100 text-green-700 hover:bg-green-200 border-2 border-green-300' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-2 border-gray-300'
              }`}
            >
              <span className={`w-3 h-3 rounded-full ${autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></span>
              {autoRefresh ? 'Auto On' : 'Auto Off'}
            </button>

            <button
              onClick={handleManualRefresh}
              disabled={loading || !lineNo}
              className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg text-base font-medium disabled:opacity-50 flex items-center gap-2 shadow-sm transition-colors"
            >
              <span className="text-xl">🔄</span>
              Actualizar
            </button>

            <button
              onClick={() => navigate('/dashboard')}
              className="bg-gray-200 hover:bg-gray-300 px-6 py-3 rounded-lg text-base font-medium shadow-sm transition-colors"
            >
              Volver
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-red-100 border-2 border-red-400 text-red-700 px-6 py-4 rounded-xl mb-8 text-lg">
            ⚠️ {error}
          </div>
        )}

        {/* Loading */}
        {loading && lineNo && (
          <div className="text-center py-20">
            <div className="animate-spin rounded-full h-20 w-20 border-4 border-gray-200 border-t-gray-900 mx-auto"></div>
            <p className="mt-4 text-xl text-gray-600">Cargando datos...</p>
          </div>
        )}

        {/* ENHANCED LINE CARD - MUCH BIGGER FOR TV */}
        {!loading && lineNo && runData && (
          <div className={`border-4 ${status.border} rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 hover:shadow-3xl`}>
            {/* Header - Larger with more prominent line number */}
            <div className={`${status.bg} px-8 py-6 flex justify-between items-center`}>
              <div className="flex items-center gap-4">
                <span className="text-5xl font-black text-gray-900">Línea {lineNo}</span>
                <span className="text-4xl">{status.icon}</span>
              </div>
              <div className={`${status.badge} px-6 py-3 rounded-full text-2xl font-bold shadow-lg`}>
                {status.label}
              </div>
            </div>

            {/* Card Content - Larger text and spacing */}
            <div className="p-8 bg-white">
              {/* Style info - Larger */}
              <div className="mb-6 text-2xl text-gray-600 font-medium border-b pb-4">
                {styleInfo.code} - {styleInfo.name}
              </div>

              {/* Efficiency - Very prominent */}
              <div className="mb-8 bg-gray-50 rounded-xl p-6">
                <div className="flex justify-between items-center">
                  <span className="text-3xl text-gray-700 font-semibold">Eficiencia</span>
                  <span className="text-6xl font-black text-gray-900">{efficiency.toFixed(1)}%</span>
                </div>
              </div>

              {/* Progress section */}
              <div className="mb-8">
                <div className="flex justify-between text-2xl mb-3">
                  <span className="text-gray-700 font-medium">Progreso (ahora)</span>
                  <span className="font-bold text-gray-900">{achievementPct.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-6">
                  <div
                    className={`h-6 rounded-full transition-all duration-500 ${
                      variancePct < -15 ? 'bg-red-500' :
                      variancePct < -5 ? 'bg-orange-500' :
                      variancePct <= 5 ? 'bg-green-500' :
                      variancePct <= 15 ? 'bg-yellow-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${Math.min(achievementPct, 100)}%` }}
                  ></div>
                </div>
              </div>

              {/* Real-time achievement badge - Prominent */}
              <div className="flex justify-between items-center mb-8 bg-gray-50 rounded-xl p-6">
                <span className="text-3xl text-gray-700 font-semibold">Cumplimiento RT:</span>
                <span className={`text-5xl font-black ${
                  achievementPct >= 80 ? 'text-green-600' :
                  achievementPct >= 60 ? 'text-yellow-600' : 'text-red-600'
                }`}>
                  {achievementPct.toFixed(1)}%
                </span>
              </div>

              {/* Two column grid - Large numbers */}
              <div className="grid grid-cols-2 gap-8 mb-8">
                <div className="bg-blue-50 rounded-xl p-6">
                  <div className="text-2xl text-blue-800 font-medium mb-2">Objetivo (ahora)</div>
                  <div className="text-6xl font-black text-blue-900">{formatNumber(realtimeTarget)}</div>
                </div>
                <div className="bg-green-50 rounded-xl p-6">
                  <div className="text-2xl text-green-800 font-medium mb-2">Cosido (Empaque)</div>
                  <div className="text-6xl font-black text-green-900">{formatNumber(finishedGarments)}</div>
                </div>
              </div>

              {/* Variance - Very prominent with large arrow */}
              <div className="flex justify-between items-center pt-6 border-t-4 border-gray-200">
                <span className="text-3xl text-gray-700 font-semibold">Variación</span>
                <span className={`font-black flex items-center gap-3 text-4xl ${
                  variance > 0 ? 'text-green-600' : variance < 0 ? 'text-red-600' : 'text-gray-600'
                }`}>
                  <span className="text-5xl">{variance > 0 ? '↑' : variance < 0 ? '↓' : '→'}</span>
                  <span>{variance > 0 ? '+' : ''}{formatNumber(variance)}</span>
                  <span className="text-3xl ml-2">
                    ({variancePct > 0 ? '+' : ''}{variancePct.toFixed(1)}%)
                  </span>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* No line selected - Larger message */}
        {!lineNo && (
          <div className="bg-white rounded-2xl shadow-xl p-20 text-center">
            <div className="text-6xl mb-6">📺</div>
            <h2 className="text-4xl font-bold text-gray-800 mb-4">Selecciona una línea</h2>
            <p className="text-2xl text-gray-500">para ver los datos en tiempo real</p>
          </div>
        )}
      </main>
    </div>
  );
}