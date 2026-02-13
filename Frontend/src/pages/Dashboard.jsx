import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import NavDashboard from '../components/NavDashboard';

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [summary, setSummary] = useState(null);
  const [lineData, setLineData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  const [hoveredCard, setHoveredCard] = useState(null);

  // Detect screen size for responsive chart
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Check authentication and role
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/', { replace: true });
      return;
    }

    axios.get('http://localhost:5000/api/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        const user = res.data.user;
        if (user.role !== 'supervisor') {
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
        navigate('/login', { replace: true });
      });
  }, []);

  const fetchDashboardData = async (selectedDate) => {
    setLoading(true);
    setError('');
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };

    try {
      const [summaryRes, lineRes] = await Promise.all([
        axios.get(`http://localhost:5000/api/supervisor/summary?date=${selectedDate}`, { headers }),
        axios.get(`http://localhost:5000/api/supervisor/line-performance?date=${selectedDate}`, { headers })
      ]);

      if (summaryRes.data.success) {
        setSummary(summaryRes.data.summary);
      }
      if (lineRes.data.success) {
        setLineData(lineRes.data.lines);
      }
    } catch (err) {
      console.error(err);
      setError('No se pudieron cargar los datos del panel. Por favor inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (e) => {
    const newDate = e.target.value;
    setDate(newDate);
    fetchDashboardData(newDate);
  };

  const formatNumber = (value) => {
    if (value == null) return '0';
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
  };

  // Get status color and icon for line cards
  const getLineStatus = (variancePct, target) => {
    if (target === 0) return { color: 'gray', icon: '⏸️', text: 'Sin Objetivo' };
    if (variancePct < -15) return { color: 'red', icon: '🔴', text: 'Crítico' };
    if (variancePct < -5) return { color: 'orange', icon: '🟠', text: 'Atrasado' };
    if (variancePct <= 5) return { color: 'green', icon: '🟢', text: 'En Ruta' };
    if (variancePct <= 15) return { color: 'yellow', icon: '🟡', text: 'Adelantado' };
    return { color: 'blue', icon: '🔵', text: 'Superando' };
  };

  if (!user) {
    return (
      <div className="flex justify-center items-center h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-200 border-t-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600 font-medium">Cargando panel...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col">
      <NavDashboard />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Header Section with Glassmorphism */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 mb-8 border border-white/50">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3">
                Panel de Supervisor
              </h1>
              <p className="text-gray-600 mt-1 ml-1">
                Bienvenido de nuevo,{" "}
                <span className="font-semibold text-gray-900">{user.full_name || user.username}</span>
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              <div className="flex items-center bg-gray-50 rounded-xl p-1 border border-gray-200">
                <input
                  type="date"
                  id="date"
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

        {/* Error message with animation */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-6 py-4 rounded-xl mb-8 animate-slideDown flex items-center gap-3 shadow-md">
            <div>
              <p className="font-semibold">Error al cargar datos</p>
              <p className="text-sm text-red-600">{error}</p>
            </div>
          </div>
        )}

        {/* Summary Cards with modern design */}
        {!loading && summary && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">Objetivo Total</p>
                  <p className="text-3xl font-bold text-gray-900">{formatNumber(summary.totalTarget)}</p>
                  <p className="text-xs text-gray-500 mt-2">piezas</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">Total Cosido</p>
                  <p className="text-3xl font-bold text-gray-900">{formatNumber(summary.totalSewed)}</p>
                  <p className="text-xs text-gray-500 mt-2">piezas</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">Eficiencia</p>
                  <p className="text-3xl font-bold text-gray-900">{formatNumber(summary.overallEfficiency)}</p>
                  <p className="text-xs text-gray-500 mt-2">%</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">Cumplimiento</p>
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
          </div>
        )}

        {/* Line Performance Chart with enhanced styling */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-8 border border-gray-100">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                Resumen del Desempeño por Línea
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Producción vs Objetivo para{" "}
                {new Date(date).toLocaleDateString('es-MX', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </p>
            </div>
            <div className="bg-gray-50 px-4 py-2 rounded-xl text-sm">
              <span className="font-semibold text-gray-900">{lineData.length}</span>
              <span className="text-gray-600"> Líneas Activas</span>
            </div>
          </div>

          {!loading && lineData.length > 0 ? (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <div className="min-w-[600px] sm:min-w-0 px-4 sm:px-0">
                <ResponsiveContainer width="100%" height={isMobile ? 350 : 450}>
                  <ComposedChart
                    data={lineData}
                    margin={{ top: 20, right: 30, left: 20, bottom: isMobile ? 70 : 40 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="lineNo"
                      angle={isMobile ? -45 : 0}
                      textAnchor={isMobile ? 'end' : 'middle'}
                      height={isMobile ? 70 : 30}
                      interval={0}
                      tick={{ fontSize: isMobile ? 12 : 14, fill: '#4b5563' }}
                      label={{ value: 'Número de Línea', position: 'bottom', offset: 50, fill: '#6b7280' }}
                    />
                    <YAxis
                      yAxisId="left"
                      tickFormatter={formatNumber}
                      stroke="#8884d8"
                      tick={{ fontSize: isMobile ? 12 : 14, fill: '#4b5563' }}
                      label={{ value: 'Cantidad', angle: -90, position: 'insideLeft', fill: '#6b7280' }}
                    />
                    <Tooltip
                      formatter={(value) => formatNumber(value)}
                      contentStyle={{
                        backgroundColor: 'rgba(255,255,255,0.95)',
                        borderRadius: '12px',
                        border: 'none',
                        boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)',
                        padding: '12px'
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: isMobile ? 12 : 14, paddingTop: '20px' }}
                      iconType="circle"
                    />

                    <Bar
                      yAxisId="left"
                      dataKey="totalSewed"
                      fill="#10b981"
                      name="Producido"
                      barSize={isMobile ? 20 : 35}
                      radius={[4, 4, 0, 0]}
                    />

                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="totalTarget"
                      stroke="#8b5cf6"
                      strokeWidth={3}
                      dot={{ r: isMobile ? 4 : 6, fill: "#8b5cf6", strokeWidth: 2, stroke: "white" }}
                      activeDot={{ r: 8, fill: "#8b5cf6", stroke: "white", strokeWidth: 2 }}
                      name="Objetivo"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            !loading && (
              <div className="text-center py-16 bg-gray-50 rounded-xl">
                <p className="text-gray-500 text-lg font-medium">
                  No se encontraron datos de producción para esta fecha
                </p>
                <p className="text-gray-400 text-sm mt-2">
                  Intenta seleccionar otra fecha
                </p>
              </div>
            )
          )}
        </div>

        {/* Loading state with skeleton */}
        {loading && (
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 rounded-lg w-1/4 mb-6"></div>
              <div className="h-96 bg-gray-100 rounded-xl"></div>
            </div>
          </div>
        )}

        {/* Line Cards with modern design */}
        {!loading && lineData.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  Detalles de Líneas de Producción
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Haz clic en cualquier línea para ver información detallada de producción
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
              {lineData.map((line, idx) => {
                const target = line.totalTarget || 0;
                const sewed = line.totalSewed || 0;
                const variance = sewed - target;
                const variancePct = target > 0 ? (variance / target) * 100 : 0;
                const status = getLineStatus(variancePct, target);

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
                    onClick={() => navigate(`/admin-dashboard?line=${line.lineNo}&date=${date}`)}
                    onMouseEnter={() => setHoveredCard(line.lineNo)}
                    onMouseLeave={() => setHoveredCard(null)}
                    className={`group bg-white rounded-2xl shadow-lg 
                      hover:shadow-2xl transition-all duration-300
                       transform hover:-translate-y-2
                        cursor-pointer overflow-hidden border-2 ${
                      hoveredCard === line.lineNo ? statusColors[status.color] : 'border-transparent'
                    }`}
                  >
                    <div className="bg-gradient-to-r from-gray-900 to-gray-800 px-5 py-4">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="text-white text-lg font-bold">Línea {line.lineNo}</span>
                          <span className="text-xs bg-white/20 text-white px-2 py-1 rounded-full">
                            {status.icon}
                          </span>
                        </div>
                        <div className="bg-white/20 px-3 py-1 rounded-full">
                          <span className="text-xs font-semibold text-white">{status.text}</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-5">
                      <div className="mb-4">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-600">Progreso</span>
                          <span className="font-semibold text-gray-900">
                            {target > 0 ? ((sewed / target) * 100).toFixed(1) : '0'}%
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
                            style={{ width: `${target > 0 ? Math.min((sewed / target) * 100, 100) : 0}%` }}
                          ></div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="bg-gray-50 rounded-xl p-3">
                          <p className="text-xs text-gray-500 mb-1">Objetivo</p>
                          <p className="text-lg font-bold text-gray-900">{formatNumber(target)}</p>
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

                      <div className="mt-4 text-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <span className="text-xs font-medium text-gray-900 bg-gray-100 px-4 py-2 rounded-full">
                          Haz clic para ver detalles →
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      <footer className="mt-auto py-6 bg-white/80 backdrop-blur-sm border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-sm text-gray-500">
            Sistema de Monitoreo de Producción • Panel de Supervisor • {new Date().toLocaleDateString('es-MX')}
          </p>
        </div>
      </footer>
    </div>
  );
}
