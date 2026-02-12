import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom"; // Added useSearchParams
import axios from "axios";
import NavAdmin from "../components/NavAdmin";
import Alert from "../components/Alert"; // Import the Alert component

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

function toYMD(d) {
  if (!d) return "";
  // Handles Date object or ISO string ("2026-02-04T00:00:00.000Z")
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams(); // Added for URL parameters
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [lines, setLines] = useState([]);
  const [selectedLine, setSelectedLine] = useState("");

  // ✅ calendar date (YYYY-MM-DD)
  const [selectedDate, setSelectedDate] = useState("");

  const [runData, setRunData] = useState(null);
  const [summary, setSummary] = useState(null);
  const [operatorDetails, setOperatorDetails] = useState([]);
  const [loadingData, setLoadingData] = useState(false);

  // Alerts state
  const [alerts, setAlerts] = useState([]);
  const [showAlerts, setShowAlerts] = useState(true);
  
  // Track if auto-load from URL has been attempted
  const [initialLoadAttempted, setInitialLoadAttempted] = useState(false);

  // Generate line options 1-26
  const generateLineOptions = () => {
    const arr = [];
    for (let i = 1; i <= 26; i++) arr.push(String(i));
    return arr;
  };

  // Function to generate alerts from operator data
  const generateAlertsFromOperatorData = (operatorDetails) => {
    if (!operatorDetails || operatorDetails.length === 0) return [];
    
    const alertList = [];
    
    operatorDetails.forEach((operator) => {
      const variance = operator.totalSewed - operator.plannedQty;
      const efficiency = parseFloat(operator.efficiency);
      
      // Alert 1: Significant negative variance (more than 10% below target)
      if (variance < 0 && Math.abs(variance) > operator.plannedQty * 0.1) {
        const severity = Math.abs(variance) > operator.plannedQty * 0.3 ? "HIGH" : "MEDIUM";
        
        alertList.push({
          id: `alert-${operator.operatorNo}-${Date.now()}`,
          type: "VARIANCE",
          severity,
          operatorNo: operator.operatorNo,
          operatorName: operator.operatorName,
          operationName: operator.operationName,
          style: operator.style,
          plannedQty: operator.plannedQty,
          sewedQty: operator.totalSewed,
          variance: variance,
          efficiency: efficiency,
          capacityPerHour: operator.capacityPerHour,
          date: selectedDate,
          line: selectedLine,
          message: `Operator ${operator.operatorNo} (${operator.operatorName}) is ${Math.abs(variance)} pieces below target for ${operator.operationName}`,
          timestamp: new Date().toISOString()
        });
      }
      
      // Alert 2: Very low efficiency (< 60%)
      if (efficiency < 0.6 && efficiency > 0) {
        alertList.push({
          id: `efficiency-${operator.operatorNo}-${Date.now()}`,
          type: "EFFICIENCY",
          severity: "HIGH",
          operatorNo: operator.operatorNo,
          operatorName: operator.operatorName,
          operationName: operator.operationName,
          style: operator.style,
          efficiency: efficiency,
          capacityPerHour: operator.capacityPerHour,
          date: selectedDate,
          line: selectedLine,
          message: `Operator ${operator.operatorNo} (${operator.operatorName}) has very low efficiency of ${(efficiency * 100).toFixed(1)}% for ${operator.operationName}`,
          timestamp: new Date().toISOString()
        });
      }
      
      // Alert 3: Low efficiency (60-80%)
      if (efficiency >= 0.6 && efficiency < 0.8) {
        alertList.push({
          id: `efficiency-warning-${operator.operatorNo}-${Date.now()}`,
          type: "EFFICIENCY",
          severity: "MEDIUM",
          operatorNo: operator.operatorNo,
          operatorName: operator.operatorName,
          operationName: operator.operationName,
          style: operator.style,
          efficiency: efficiency,
          capacityPerHour: operator.capacityPerHour,
          date: selectedDate,
          line: selectedLine,
          message: `Operator ${operator.operatorNo} (${operator.operatorName}) has low efficiency of ${(efficiency * 100).toFixed(1)}% for ${operator.operationName}`,
          timestamp: new Date().toISOString()
        });
      }
      
      // Alert 4: Zero production but planned quantity exists
      if (operator.totalSewed === 0 && operator.plannedQty > 0) {
        alertList.push({
          id: `no-production-${operator.operatorNo}-${Date.now()}`,
          type: "NO_PRODUCTION",
          severity: "HIGH",
          operatorNo: operator.operatorNo,
          operatorName: operator.operatorName,
          operationName: operator.operationName,
          style: operator.style,
          plannedQty: operator.plannedQty,
          date: selectedDate,
          line: selectedLine,
          message: `Operator ${operator.operatorNo} (${operator.operatorName}) has zero production for ${operator.operationName}`,
          timestamp: new Date().toISOString()
        });
      }
      
      // Alert 5: Very high negative variance (> 50% below target)
      if (variance < 0 && Math.abs(variance) > operator.plannedQty * 0.5) {
        alertList.push({
          id: `critical-variance-${operator.operatorNo}-${Date.now()}`,
          type: "CRITICAL_VARIANCE",
          severity: "HIGH",
          operatorNo: operator.operatorNo,
          operatorName: operator.operatorName,
          operationName: operator.operationName,
          style: operator.style,
          plannedQty: operator.plannedQty,
          sewedQty: operator.totalSewed,
          variance: variance,
          variancePercentage: ((Math.abs(variance) / operator.plannedQty) * 100).toFixed(1),
          date: selectedDate,
          line: selectedLine,
          message: `CRITICAL: Operator ${operator.operatorNo} (${operator.operatorName}) is ${((Math.abs(variance) / operator.plannedQty) * 100).toFixed(1)}% below target for ${operator.operationName}`,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    // Sort alerts by severity (HIGH first, then MEDIUM, then LOW)
    alertList.sort((a, b) => {
      const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
    
    return alertList;
  };

  useEffect(() => {
    const token = localStorage.getItem("token");
    const storedUser = JSON.parse(localStorage.getItem("user") || "null");

    if (!token || !storedUser) {
      navigate("/login", { replace: true });
      return;
    }

    const roleNorm = String(storedUser?.role || "")
      .toLowerCase()
      .trim()
      .replace(/[\s_-]/g, "");

    if (roleNorm !== "supervisor") {
      navigate("/planner", { replace: true });
      return;
    }

    setUser(storedUser);
    setLines(generateLineOptions());

    // ✅ Get line and date from URL parameters
    const lineParam = searchParams.get("line");
    const dateParam = searchParams.get("date");
    
    // Set default date to today if no date param
    const today = new Date().toISOString().slice(0, 10);
    setSelectedDate(dateParam || today);
    
    // Set line if provided
    if (lineParam) {
      setSelectedLine(lineParam);
    }

    setLoading(false);
  }, [navigate, searchParams]);

  // Auto-fetch data when line and date are set from URL
  useEffect(() => {
    // Only fetch if we have both line and date, loading is complete, and we haven't attempted initial load yet
    if (selectedLine && selectedDate && !loading && !initialLoadAttempted) {
      setInitialLoadAttempted(true);
      // Small delay to ensure state is fully updated
      setTimeout(() => {
        fetchProductionData(false); // Pass false to indicate this is not a manual load
      }, 100);
    }
  }, [selectedLine, selectedDate, loading]);

  // Update URL when line or date changes manually (optional - to keep URL in sync)
  useEffect(() => {
    if (selectedLine && selectedDate && initialLoadAttempted) {
      // Update URL without reloading the page
      const url = new URL(window.location);
      url.searchParams.set('line', selectedLine);
      url.searchParams.set('date', selectedDate);
      window.history.replaceState({}, '', url);
    }
  }, [selectedLine, selectedDate, initialLoadAttempted]);

  const fetchProductionData = async (isManual = true) => {
    if (!selectedLine || !selectedDate) {
      if (isManual) alert("Please select both line and date");
      return;
    }

    setLoadingData(true);
    setAlerts([]); // Clear previous alerts

    try {
      const token = localStorage.getItem("token");

      // ✅ get all runs for this line
      const runsResponse = await axios.get(
        `${API_BASE}/api/line-runs/${selectedLine}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!runsResponse.data?.success || !Array.isArray(runsResponse.data?.runs)) {
        throw new Error("No runs returned from server");
      }

      // ✅ normalize and match by YYYY-MM-DD
      const selectedRun = runsResponse.data.runs.find((run) => {
        return toYMD(run.run_date) === selectedDate;
      });

      if (!selectedRun) {
        setRunData(null);
        setSummary(null);
        setOperatorDetails([]);
        // Only show alert for manual fetches
        if (isManual) {
          alert(`No production data found for Line ${selectedLine} on ${selectedDate}`);
        }
        return;
      }

      // ✅ fetch detailed run data
      const runDetailResponse = await axios.get(
        `${API_BASE}/api/get-run-data/${selectedRun.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!runDetailResponse.data?.success) {
        throw new Error(runDetailResponse.data?.error || "Failed to fetch run details");
      }

      const data = runDetailResponse.data;
      setRunData(data);

      // -------- summary + operator details (same logic as yours) --------
      const operatorsCount = data.operators?.length || 0;
      const targetPcs = Number(data.run?.target_pcs || 0);

      let totalSewed = 0;
      const operatorData = [];

      (data.operations || []).forEach((operatorGroup) => {
        const operator = operatorGroup.operator;

        (operatorGroup.operations || []).forEach((operation) => {
          const sewedData = operation.sewed_data || {};
          let operationSewed = 0;
          Object.values(sewedData).forEach((qty) => {
            operationSewed += parseFloat(qty) || 0;
          });

          totalSewed += operationSewed;

          const stitchedData = operation.stitched_data || {};
          let operationPlanned = 0;
          Object.values(stitchedData).forEach((qty) => {
            operationPlanned += parseFloat(qty) || 0;
          });

          const capacityPerHour = Number(operation.capacity_per_hour || 0);

          operatorData.push({
            operatorNo: operator.operator_no,
            operatorName: operator.operator_name || `Operator ${operator.operator_no}`,
            operationName: operation.operation_name,
            style: data.run.style,
            totalSewed: operationSewed,
            plannedQty: operationPlanned,
            capacityPerHour,
            efficiency: capacityPerHour > 0 ? (operationSewed / capacityPerHour).toFixed(2) : "0",
          });
        });
      });

      setOperatorDetails(operatorData);
      
      // Generate alerts from operator data
      const generatedAlerts = generateAlertsFromOperatorData(operatorData);
      setAlerts(generatedAlerts);

      setSummary({
        line: data.run.line_no,
        date: toYMD(data.run.run_date),
        style: data.run.style,
        operatorsCount,
        totalTarget: targetPcs,
        totalSewed,
        workingHours: data.run.working_hours,
        sam: data.run.sam_minutes,
        efficiency: Number(data.run.efficiency || 0) * 100,
        achievement: targetPcs > 0 ? ((totalSewed / targetPcs) * 100).toFixed(2) + "%" : "0%",
      });
      // ----------------------------------------------------------------

    } catch (error) {
      console.error("Error fetching production data:", error);
      // Only show alert for manual fetches
      if (isManual) {
        alert(error.response?.data?.error || error.message || "Failed to load production data");
      }
      setRunData(null);
      setSummary(null);
      setOperatorDetails([]);
      setAlerts([]);
    } finally {
      setLoadingData(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/", { replace: true });
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case "HIGH": return "bg-red-100 text-red-800 border-red-300";
      case "MEDIUM": return "bg-yellow-100 text-yellow-800 border-yellow-300";
      case "LOW": return "bg-blue-100 text-blue-800 border-blue-300";
      default: return "bg-gray-100 text-gray-800 border-gray-300";
    }
  };

  const getAlertIcon = (type) => {
    switch (type) {
      case "VARIANCE": return "⚠️";
      case "CRITICAL_VARIANCE": return "🔥";
      case "EFFICIENCY": return "📊";
      case "NO_PRODUCTION": return "🛑";
      default: return "ℹ️";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <NavAdmin user={user} onLogout={handleLogout} />

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Line and Date Selection */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Select Production Line and Date
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Production Line
              </label>
              <select
                value={selectedLine}
                onChange={(e) => setSelectedLine(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900/20"
              >
                <option value="">Select Line</option>
                {lines.map((line) => (
                  <option key={line} value={line}>
                    Line {line}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Date
              </label>

              {/* ✅ calendar date picker */}
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900/20"
              />

              {selectedDate ? (
                <div className="text-xs text-gray-500 mt-1">
                  {formatDate(selectedDate)}
                </div>
              ) : null}
            </div>

            <div className="flex items-end">
              <button
                onClick={() => fetchProductionData(true)} // Pass true for manual load
                disabled={loadingData || !selectedLine || !selectedDate}
                className="w-full px-6 py-2.5 bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loadingData ? "Loading..." : "Load Data"}
              </button>
            </div>
          </div>
          
          {/* Show indicator when data is auto-loaded from URL */}
          {selectedLine && selectedDate && initialLoadAttempted && !loadingData && runData && (
            <div className="mt-4 text-xs text-gray-500 flex items-center">
              <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-2"></span>
              Auto-loaded Line {selectedLine} data for {formatDate(selectedDate)}
            </div>
          )}
        </div>

        {/* Alerts Section */}
        {selectedLine && selectedDate && alerts.length > 0 && (
          <div className="mb-6">
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                <div className="flex items-center">
                  <h2 className="text-lg font-semibold text-gray-900 mr-3">
                    Production Alerts
                  </h2>
                  <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">
                    {alerts.length} alert{alerts.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <button
                  onClick={() => setShowAlerts(!showAlerts)}
                  className="text-sm text-gray-600 hover:text-gray-900 flex items-center"
                >
                  {showAlerts ? (
                    <>
                      <span>Hide Details</span>
                      <span className="ml-1">↑</span>
                    </>
                  ) : (
                    <>
                      <span>Show Details</span>
                      <span className="ml-1">↓</span>
                    </>
                  )}
                </button>
              </div>
              
              {showAlerts && (
                <div className="p-6">
                  <div className="space-y-4">
                    {alerts.map((alert, index) => (
                      <div 
                        key={alert.id || index} 
                        className={`border rounded-lg p-4 ${getSeverityColor(alert.severity)}`}
                      >
                        <div className="flex items-start">
                          <div className="flex-shrink-0 text-lg mr-3">
                            {getAlertIcon(alert.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-sm font-semibold text-gray-900 mb-1">
                                  {alert.message}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <span className="text-xs px-2 py-1 bg-white/70 rounded">
                                    Operator: {alert.operatorNo}
                                  </span>
                                  <span className="text-xs px-2 py-1 bg-white/70 rounded">
                                    {alert.operationName}
                                  </span>
                                  {alert.style && (
                                    <span className="text-xs px-2 py-1 bg-white/70 rounded">
                                      Style: {alert.style}
                                    </span>
                                  )}
                                  {alert.variance !== undefined && (
                                    <span className="text-xs px-2 py-1 bg-white/70 rounded">
                                      Variance: {alert.variance}
                                    </span>
                                  )}
                                  {alert.efficiency !== undefined && (
                                    <span className="text-xs px-2 py-1 bg-white/70 rounded">
                                      Efficiency: {(alert.efficiency * 100).toFixed(1)}%
                                    </span>
                                  )}
                                </div>
                              </div>
                              <span className={`px-2 py-1 rounded text-xs font-medium ${
                                alert.severity === 'HIGH' ? 'bg-red-200 text-red-800' :
                                alert.severity === 'MEDIUM' ? 'bg-yellow-200 text-yellow-800' :
                                'bg-blue-200 text-blue-800'
                              }`}>
                                {alert.severity} PRIORITY
                              </span>
                            </div>
                            <div className="mt-3 text-xs text-gray-600 flex justify-between items-center">
                              <span>
                                Line {alert.line} • {formatDate(alert.date)}
                              </span>
                              <span>
                                {new Date(alert.timestamp).toLocaleTimeString([], { 
                                  hour: '2-digit', 
                                  minute: '2-digit' 
                                })}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Alert Summary */}
                  <div className="mt-6 pt-4 border-t border-gray-200">
                    <div className="flex flex-wrap gap-4">
                      <div className="flex items-center">
                        <div className="w-3 h-3 bg-red-500 rounded-full mr-2"></div>
                        <span className="text-sm text-gray-600">
                          High Priority: {alerts.filter(a => a.severity === 'HIGH').length}
                        </span>
                      </div>
                      <div className="flex items-center">
                        <div className="w-3 h-3 bg-yellow-500 rounded-full mr-2"></div>
                        <span className="text-sm text-gray-600">
                          Medium Priority: {alerts.filter(a => a.severity === 'MEDIUM').length}
                        </span>
                      </div>
                      <div className="flex items-center">
                        <div className="w-3 h-3 bg-blue-500 rounded-full mr-2"></div>
                        <span className="text-sm text-gray-600">
                          Total Operators with Issues: {[...new Set(alerts.map(a => a.operatorNo))].length}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Quick Alert Summary (always visible) */}
              <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    {alerts.length > 0 ? (
                      <>
                        <span className="font-medium">
                          {alerts.filter(a => a.severity === 'HIGH').length} high priority
                        </span>
                        {alerts.filter(a => a.severity === 'HIGH').length > 0 && ' • '}
                        <span className="font-medium">
                          {alerts.filter(a => a.severity === 'MEDIUM').length} medium priority
                        </span>
                        {' '}alert{alerts.length !== 1 ? 's' : ''} detected
                      </>
                    ) : (
                      "No alerts detected"
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    Last updated: {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* No Alerts Message (when data is loaded but no alerts) */}
        {selectedLine && selectedDate && operatorDetails.length > 0 && alerts.length === 0 && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-xl p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0 text-green-500 text-2xl mr-4">✅</div>
              <div>
                <h3 className="text-lg font-medium text-green-800">All Operators Meeting Targets</h3>
                <p className="text-green-600 mt-1">
                  No production alerts detected for Line {selectedLine} on {formatDate(selectedDate)}.
                  All operators are performing within acceptable ranges.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-sm font-medium text-gray-500 mb-2">Total Target</div>
              <div className="text-2xl font-bold text-gray-900">
                {Number(summary.totalTarget || 0).toLocaleString()}
              </div>
              <div className="text-sm text-gray-500 mt-1">Pieces</div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-sm font-medium text-gray-500 mb-2">Total Sewed</div>
              <div className="text-2xl font-bold text-gray-900">
                {Number(summary.totalSewed || 0).toLocaleString()}
              </div>
              <div className="text-sm text-gray-500 mt-1">Pieces</div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-sm font-medium text-gray-500 mb-2">Operators</div>
              <div className="text-2xl font-bold text-gray-900">{summary.operatorsCount}</div>
              <div className="text-sm text-gray-500 mt-1">On Line</div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-sm font-medium text-gray-500 mb-2">Achievement</div>
              <div className="text-2xl font-bold text-gray-900">{summary.achievement}</div>
              <div className="text-sm text-gray-500 mt-1">
                Line {summary.line} - {summary.style}
              </div>
            </div>
          </div>
        )}

        {/* Production Details Table */}
        {operatorDetails.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Operator Production Details
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Line {summary?.line} - {summary?.date} - {summary?.style}
              </p>
            </div>
            
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Operator
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Operation
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Style
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Planned Qty
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Sewed Qty
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Capacity/hr
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Efficiency
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Variance
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {operatorDetails.map((operator, index) => {
                    const variance = operator.totalSewed - operator.plannedQty;
                    const varianceClass = variance >= 0 
                      ? "text-green-600 bg-green-50" 
                      : "text-red-600 bg-red-50";
                    
                    // Check if this operator has any alerts
                    const operatorAlerts = alerts.filter(alert => alert.operatorNo === operator.operatorNo);
                    const hasAlert = operatorAlerts.length > 0;
                    const highestSeverity = operatorAlerts.length > 0 
                      ? operatorAlerts.reduce((max, alert) => {
                          const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
                          return severityOrder[alert.severity] < severityOrder[max] ? alert.severity : max;
                        }, operatorAlerts[0].severity)
                      : null;
                    
                    return (
                      <tr key={index} className={`hover:bg-gray-50 ${hasAlert ? 'bg-red-50/30' : ''}`}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-medium text-gray-900">
                            {operator.operatorNo}
                          </div>
                          <div className="text-sm text-gray-500">
                            {operator.operatorName}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{operator.operationName}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                            {operator.style}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {operator.plannedQty.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-semibold text-gray-900">
                            {operator.totalSewed.toLocaleString()}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {operator.capacityPerHour.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            parseFloat(operator.efficiency) >= 1 
                              ? "bg-green-100 text-green-800" 
                              : parseFloat(operator.efficiency) >= 0.8
                              ? "bg-blue-100 text-blue-800"
                              : "bg-yellow-100 text-yellow-800"
                          }`}>
                            {operator.efficiency}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${varianceClass}`}>
                            {variance >= 0 ? '+' : ''}{variance.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {hasAlert ? (
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                              highestSeverity === 'HIGH' 
                                ? 'bg-red-100 text-red-800 border border-red-200'
                                : 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                            }`}>
                              {highestSeverity} Alert
                            </span>
                          ) : (
                            <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                              OK
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {summary && (
                  <tfoot className="bg-gray-50">
                    <tr>
                      <td colSpan="3" className="px-6 py-4 text-right text-sm font-medium text-gray-700">
                        Totals:
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        {operatorDetails.reduce((sum, op) => sum + op.plannedQty, 0).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        {operatorDetails.reduce((sum, op) => sum + op.totalSewed, 0).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        {operatorDetails.reduce((sum, op) => sum + op.capacityPerHour, 0).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        -
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        {operatorDetails.reduce((sum, op) => sum + (op.totalSewed - op.plannedQty), 0).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          alerts.length > 0 
                            ? alerts.filter(a => a.severity === 'HIGH').length > 0
                              ? 'bg-red-100 text-red-800'
                              : 'bg-yellow-100 text-yellow-800'
                            : 'bg-green-100 text-green-800'
                        }`}>
                          {alerts.length} Alert{alerts.length !== 1 ? 's' : ''}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}

        {/* Using the Alert Component (alternative/separate approach) */}
        {selectedLine && selectedDate && (
          <div className="mt-8">
            <Alert 
              lineNo={selectedLine} 
              selectedDate={selectedDate}
              operatorDetails={operatorDetails}
            />
          </div>
        )}

        {/* No Data Message */}
        {selectedLine && selectedDate && !loadingData && !runData && (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center">
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Production Data Found</h3>
            <p className="text-gray-600">
              No production data found for Line {selectedLine} on {formatDate(selectedDate)}.
            </p>
          </div>
        )}

        {/* Instructions */}
        {!selectedLine && !selectedDate && (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Select Line and Date</h3>
            <p className="text-gray-600">Please select a production line and date to view production data.</p>
          </div>
        )}
      </main>

      <footer className="mt-8 py-4 border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-sm text-gray-500">
          Production Monitoring System • Supervisor Dashboard
        </div>
      </footer>
    </div>
  );
}