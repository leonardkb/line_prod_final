import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [summary, setSummary] = useState(null);
  const [lineData, setLineData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);

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
      setError('Failed to load dashboard data. Please try again.');
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

  if (!user) {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
            Supervisor Dashboard – {user.full_name || user.username}
          </h1>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
            <div className="flex items-center w-full sm:w-auto">
              <label htmlFor="date" className="text-sm font-medium text-gray-700 mr-2 whitespace-nowrap">
                Date:
              </label>
              <input
                type="date"
                id="date"
                value={date}
                onChange={handleDateChange}
                className="w-full sm:w-auto rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={() => {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                navigate('/');
              }}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium w-full sm:w-auto"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md mb-6 text-sm">
            {error}
          </div>
        )}

        {/* Summary Cards */}
        {!loading && summary && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
            <div className="bg-white rounded-lg shadow p-5 sm:p-6">
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Total Target
              </h3>
              <p className="mt-2 text-2xl sm:text-3xl font-semibold text-gray-900">
                {formatNumber(summary.totalTarget)}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow p-5 sm:p-6">
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Total Sewed
              </h3>
              <p className="mt-2 text-2xl sm:text-3xl font-semibold text-gray-900">
                {formatNumber(summary.totalSewed)}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow p-5 sm:p-6">
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Efficiency
              </h3>
              <p className="mt-2 text-2xl sm:text-3xl font-semibold text-gray-900">
                {formatNumber(summary.overallEfficiency)}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow p-5 sm:p-6">
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Achievement
              </h3>
              <p className="mt-2 text-2xl sm:text-3xl font-semibold text-gray-900">
                {summary.targetAchievement?.toFixed(1)}%
              </p>
            </div>
          </div>
        )}

        {/* Line Performance Chart – Bar + Line */}
        <div className="bg-white rounded-lg shadow p-4 sm:p-6 mb-6">
          <h2 className="text-base sm:text-lg font-medium text-gray-900 mb-4">
            Line Performance – {date}
          </h2>
          {!loading && lineData.length > 0 ? (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <div className="min-w-[600px] sm:min-w-0 px-4 sm:px-0">
                <ResponsiveContainer width="100%" height={isMobile ? 350 : 400}>
                  <ComposedChart
                    data={lineData}
                    margin={{ top: 20, right: 30, left: 20, bottom: isMobile ? 70 : 40 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="lineNo"
                      angle={isMobile ? -45 : 0}
                      textAnchor={isMobile ? 'end' : 'middle'}
                      height={isMobile ? 70 : 30}
                      interval={0}
                      tick={{ fontSize: isMobile ? 12 : 14 }}
                    />
                    <YAxis
                      yAxisId="left"
                      tickFormatter={formatNumber}
                      stroke="#8884d8"
                      tick={{ fontSize: isMobile ? 12 : 14 }}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      stroke="#82ca9d"
                      tickFormatter={formatNumber}
                      tick={{ fontSize: isMobile ? 12 : 14 }}
                    />
                    <Tooltip formatter={(value) => formatNumber(value)} />
                    <Legend wrapperStyle={{ fontSize: isMobile ? 12 : 14 }} />
                    
                    {/* Bar: Produced (Sewed) – green */}
                    <Bar
                      yAxisId="left"
                      dataKey="totalSewed"
                      fill="#82ca9d"
                      name="Produced"
                      barSize={isMobile ? 20 : 30}
                    />
                    
                    {/* Line: Target – purple, with markers */}
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="totalTarget"
                      stroke="#8884d8"
                      strokeWidth={3}
                      dot={{ r: isMobile ? 4 : 6, fill: "#8884d8" }}
                      activeDot={{ r: 8 }}
                      name="Target"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            !loading && (
              <div className="text-center py-12 text-gray-500 text-sm sm:text-base">
                No production data found for this date.
              </div>
            )
          )}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
          </div>
        )}
      </div>
    </div>
  );
}