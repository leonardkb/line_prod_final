import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import NavAdmin from "../components/NavAdmin";
import Alert from "../components/Alert";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

function toYMD(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [lines, setLines] = useState([]);
  const [selectedLine, setSelectedLine] = useState("");
  const [selectedDate, setSelectedDate] = useState("");

  const [runData, setRunData] = useState(null);
  const [summary, setSummary] = useState(null);
  const [operatorDetails, setOperatorDetails] = useState([]);
  const [loadingData, setLoadingData] = useState(false);

  const [alerts, setAlerts] = useState([]);
  const [showAlerts, setShowAlerts] = useState(true);

  const [initialLoadAttempted, setInitialLoadAttempted] = useState(false);

  const generateLineOptions = () => {
    const arr = [];
    for (let i = 1; i <= 26; i++) arr.push(String(i));
    return arr;
  };

  const generateAlertsFromOperatorData = (operatorDetails) => {
    if (!operatorDetails || operatorDetails.length === 0) return [];

    const alertList = [];

    operatorDetails.forEach((operator) => {
      const variance = operator.totalSewed - operator.plannedQty;
      const efficiency = parseFloat(operator.efficiency);

      // Alerta 1: Variación negativa significativa (más del 10% debajo del objetivo)
      if (variance < 0 && Math.abs(variance) > operator.plannedQty * 0.1) {
        const severity =
          Math.abs(variance) > operator.plannedQty * 0.3 ? "HIGH" : "MEDIUM";

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
          message: `Operador ${operator.operatorNo} (${operator.operatorName}) está ${Math.abs(
            variance
          )} piezas debajo del objetivo para ${operator.operationName}`,
          timestamp: new Date().toISOString(),
        });
      }

      // Alerta 2: Eficiencia muy baja (< 60%)
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
          message: `Operador ${operator.operatorNo} (${operator.operatorName}) tiene una eficiencia muy baja de ${(
            efficiency * 100
          ).toFixed(1)}% para ${operator.operationName}`,
          timestamp: new Date().toISOString(),
        });
      }

      // Alerta 3: Eficiencia baja (60-80%)
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
          message: `Operador ${operator.operatorNo} (${operator.operatorName}) tiene baja eficiencia de ${(
            efficiency * 100
          ).toFixed(1)}% para ${operator.operationName}`,
          timestamp: new Date().toISOString(),
        });
      }

      // Alerta 4: Producción cero pero existe cantidad planificada
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
          message: `Operador ${operator.operatorNo} (${operator.operatorName}) tiene producción cero para ${operator.operationName}`,
          timestamp: new Date().toISOString(),
        });
      }

      // Alerta 5: Variación negativa muy alta (> 50% debajo del objetivo)
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
          message: `CRÍTICO: Operador ${operator.operatorNo} (${operator.operatorName}) está ${(
            (Math.abs(variance) / operator.plannedQty) *
            100
          ).toFixed(1)}% debajo del objetivo para ${operator.operationName}`,
          timestamp: new Date().toISOString(),
        });
      }
    });

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

    const lineParam = searchParams.get("line");
    const dateParam = searchParams.get("date");

    const today = new Date().toISOString().slice(0, 10);
    setSelectedDate(dateParam || today);

    if (lineParam) {
      setSelectedLine(lineParam);
    }

    setLoading(false);
  }, [navigate, searchParams]);

  useEffect(() => {
    if (selectedLine && selectedDate && !loading && !initialLoadAttempted) {
      setInitialLoadAttempted(true);
      setTimeout(() => {
        fetchProductionData(false);
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLine, selectedDate, loading]);

  useEffect(() => {
    if (selectedLine && selectedDate && initialLoadAttempted) {
      const url = new URL(window.location);
      url.searchParams.set("line", selectedLine);
      url.searchParams.set("date", selectedDate);
      window.history.replaceState({}, "", url);
    }
  }, [selectedLine, selectedDate, initialLoadAttempted]);

  const fetchProductionData = async (isManual = true) => {
    if (!selectedLine || !selectedDate) {
      if (isManual) alert("Por favor seleccione línea y fecha");
      return;
    }

    setLoadingData(true);
    setAlerts([]);

    try {
      const token = localStorage.getItem("token");

      const runsResponse = await axios.get(
        `${API_BASE}/api/line-runs/${selectedLine}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!runsResponse.data?.success || !Array.isArray(runsResponse.data?.runs)) {
        throw new Error("No se devolvieron corridas desde el servidor");
      }

      const selectedRun = runsResponse.data.runs.find((run) => {
        return toYMD(run.run_date) === selectedDate;
      });

      if (!selectedRun) {
        setRunData(null);
        setSummary(null);
        setOperatorDetails([]);
        if (isManual) {
          alert(`No se encontraron datos de producción para la Línea ${selectedLine} en ${selectedDate}`);
        }
        return;
      }

      const runDetailResponse = await axios.get(
        `${API_BASE}/api/get-run-data/${selectedRun.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!runDetailResponse.data?.success) {
        throw new Error(runDetailResponse.data?.error || "No se pudo obtener el detalle de la corrida");
      }

      const data = runDetailResponse.data;
      setRunData(data);

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
            operatorName: operator.operator_name || `Operador ${operator.operator_no}`,
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
    } catch (error) {
      console.error("Error fetching production data:", error);
      if (isManual) {
        alert(error.response?.data?.error || error.message || "No se pudieron cargar los datos de producción");
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
    return date.toLocaleDateString("es-MX", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case "HIGH":
        return "bg-red-100 text-red-800 border-red-300";
      case "MEDIUM":
        return "bg-yellow-100 text-yellow-800 border-yellow-300";
      case "LOW":
        return "bg-blue-100 text-blue-800 border-blue-300";
      default:
        return "bg-gray-100 text-gray-800 border-gray-300";
    }
  };

  const getAlertIcon = (type) => {
    switch (type) {
      case "VARIANCE":
        return "⚠️";
      case "CRITICAL_VARIANCE":
        return "🔥";
      case "EFFICIENCY":
        return "📊";
      case "NO_PRODUCTION":
        return "🛑";
      default:
        return "ℹ️";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavAdmin user={user} onLogout={handleLogout} />

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Seleccionar Línea de Producción y Fecha
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Línea de Producción
              </label>
              <select
                value={selectedLine}
                onChange={(e) => setSelectedLine(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900/20"
              >
                <option value="">Seleccionar Línea</option>
                {lines.map((line) => (
                  <option key={line} value={line}>
                    Línea {line}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Fecha
              </label>

              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900/20"
              />

              {selectedDate ? (
                <div className="text-xs text-gray-500 mt-1">{formatDate(selectedDate)}</div>
              ) : null}
            </div>

            <div className="flex items-end">
              <button
                onClick={() => fetchProductionData(true)}
                disabled={loadingData || !selectedLine || !selectedDate}
                className="w-full px-6 py-2.5 bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loadingData ? "Cargando..." : "Cargar Datos"}
              </button>
            </div>
          </div>

          {selectedLine && selectedDate && initialLoadAttempted && !loadingData && runData && (
            <div className="mt-4 text-xs text-gray-500 flex items-center">
              <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-2"></span>
              Datos de la Línea {selectedLine} cargados automáticamente para {formatDate(selectedDate)}
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
                    Alertas de Producción
                  </h2>
                  <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">
                    {alerts.length} alerta{alerts.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <button
                  onClick={() => setShowAlerts(!showAlerts)}
                  className="text-sm text-gray-600 hover:text-gray-900 flex items-center"
                >
                  {showAlerts ? (
                    <>
                      <span>Ocultar Detalles</span>
                      <span className="ml-1">↑</span>
                    </>
                  ) : (
                    <>
                      <span>Mostrar Detalles</span>
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
                          <div className="flex-shrink-0 text-lg mr-3">{getAlertIcon(alert.type)}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="text-sm font-semibold text-gray-900 mb-1">
                                  {alert.message}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <span className="text-xs px-2 py-1 bg-white/70 rounded">
                                    Operador: {alert.operatorNo}
                                  </span>
                                  <span className="text-xs px-2 py-1 bg-white/70 rounded">
                                    {alert.operationName}
                                  </span>
                                  {alert.style && (
                                    <span className="text-xs px-2 py-1 bg-white/70 rounded">
                                      Estilo: {alert.style}
                                    </span>
                                  )}
                                  {alert.variance !== undefined && (
                                    <span className="text-xs px-2 py-1 bg-white/70 rounded">
                                      Variación: {alert.variance}
                                    </span>
                                  )}
                                  {alert.efficiency !== undefined && (
                                    <span className="text-xs px-2 py-1 bg-white/70 rounded">
                                      Eficiencia: {(alert.efficiency * 100).toFixed(1)}%
                                    </span>
                                  )}
                                </div>
                              </div>
                              <span
                                className={`px-2 py-1 rounded text-xs font-medium ${
                                  alert.severity === "HIGH"
                                    ? "bg-red-200 text-red-800"
                                    : alert.severity === "MEDIUM"
                                    ? "bg-yellow-200 text-yellow-800"
                                    : "bg-blue-200 text-blue-800"
                                }`}
                              >
                                {alert.severity === "HIGH"
                                  ? "ALTA PRIORIDAD"
                                  : alert.severity === "MEDIUM"
                                  ? "PRIORIDAD MEDIA"
                                  : "PRIORIDAD BAJA"}
                              </span>
                            </div>
                            <div className="mt-3 text-xs text-gray-600 flex justify-between items-center">
                              <span>
                                Línea {alert.line} • {formatDate(alert.date)}
                              </span>
                              <span>
                                {new Date(alert.timestamp).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 pt-4 border-t border-gray-200">
                    <div className="flex flex-wrap gap-4">
                      <div className="flex items-center">
                        <div className="w-3 h-3 bg-red-500 rounded-full mr-2"></div>
                        <span className="text-sm text-gray-600">
                          Alta Prioridad: {alerts.filter((a) => a.severity === "HIGH").length}
                        </span>
                      </div>
                      <div className="flex items-center">
                        <div className="w-3 h-3 bg-yellow-500 rounded-full mr-2"></div>
                        <span className="text-sm text-gray-600">
                          Prioridad Media: {alerts.filter((a) => a.severity === "MEDIUM").length}
                        </span>
                      </div>
                      <div className="flex items-center">
                        <div className="w-3 h-3 bg-blue-500 rounded-full mr-2"></div>
                        <span className="text-sm text-gray-600">
                          Total de Operadores con Problemas:{" "}
                          {[...new Set(alerts.map((a) => a.operatorNo))].length}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    {alerts.length > 0 ? (
                      <>
                        <span className="font-medium">
                          {alerts.filter((a) => a.severity === "HIGH").length} alta prioridad
                        </span>
                        {alerts.filter((a) => a.severity === "HIGH").length > 0 && " • "}
                        <span className="font-medium">
                          {alerts.filter((a) => a.severity === "MEDIUM").length} prioridad media
                        </span>{" "}
                        alerta{alerts.length !== 1 ? "s" : ""} detectada{alerts.length !== 1 ? "s" : ""}
                      </>
                    ) : (
                      "No se detectaron alertas"
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    Última actualización:{" "}
                    {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedLine && selectedDate && operatorDetails.length > 0 && alerts.length === 0 && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-xl p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0 text-green-500 text-2xl mr-4">✅</div>
              <div>
                <h3 className="text-lg font-medium text-green-800">
                  Todos los Operadores Cumplen los Objetivos
                </h3>
                <p className="text-green-600 mt-1">
                  No se detectaron alertas de producción para la Línea {selectedLine} en{" "}
                  {formatDate(selectedDate)}. Todos los operadores están trabajando dentro de rangos
                  aceptables.
                </p>
              </div>
            </div>
          </div>
        )}

        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-sm font-medium text-gray-500 mb-2">Objetivo Total</div>
              <div className="text-2xl font-bold text-gray-900">
                {Number(summary.totalTarget || 0).toLocaleString()}
              </div>
              <div className="text-sm text-gray-500 mt-1">Piezas</div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-sm font-medium text-gray-500 mb-2">Total Cosido</div>
              <div className="text-2xl font-bold text-gray-900">
                {Number(summary.totalSewed || 0).toLocaleString()}
              </div>
              <div className="text-sm text-gray-500 mt-1">Piezas</div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-sm font-medium text-gray-500 mb-2">Operadores</div>
              <div className="text-2xl font-bold text-gray-900">{summary.operatorsCount}</div>
              <div className="text-sm text-gray-500 mt-1">En Línea</div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-sm font-medium text-gray-500 mb-2">Cumplimiento</div>
              <div className="text-2xl font-bold text-gray-900">{summary.achievement}</div>
              <div className="text-sm text-gray-500 mt-1">
                Línea {summary.line} - {summary.style}
              </div>
            </div>
          </div>
        )}

        {operatorDetails.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Detalles de Producción por Operador
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Línea {summary?.line} - {summary?.date} - {summary?.style}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Operador
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Operación
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Estilo
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Cantidad Planificada
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Cantidad Cosida
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Capacidad/hora
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Eficiencia
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Variación
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Estado
                    </th>
                  </tr>
                </thead>

                <tbody className="bg-white divide-y divide-gray-200">
                  {operatorDetails.map((operator, index) => {
                    const variance = operator.totalSewed - operator.plannedQty;
                    const varianceClass =
                      variance >= 0 ? "text-green-600 bg-green-50" : "text-red-600 bg-red-50";

                    const operatorAlerts = alerts.filter((alert) => alert.operatorNo === operator.operatorNo);
                    const hasAlert = operatorAlerts.length > 0;
                    const highestSeverity =
                      operatorAlerts.length > 0
                        ? operatorAlerts.reduce((max, alert) => {
                            const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
                            return severityOrder[alert.severity] < severityOrder[max]
                              ? alert.severity
                              : max;
                          }, operatorAlerts[0].severity)
                        : null;

                    return (
                      <tr key={index} className={`hover:bg-gray-50 ${hasAlert ? "bg-red-50/30" : ""}`}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-medium text-gray-900">{operator.operatorNo}</div>
                          <div className="text-sm text-gray-500">{operator.operatorName}</div>
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
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded-full ${
                              parseFloat(operator.efficiency) >= 1
                                ? "bg-green-100 text-green-800"
                                : parseFloat(operator.efficiency) >= 0.8
                                ? "bg-blue-100 text-blue-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {operator.efficiency}
                          </span>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${varianceClass}`}>
                            {variance >= 0 ? "+" : ""}
                            {variance.toLocaleString()}
                          </span>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          {hasAlert ? (
                            <span
                              className={`px-2 py-1 text-xs font-medium rounded-full ${
                                highestSeverity === "HIGH"
                                  ? "bg-red-100 text-red-800 border border-red-200"
                                  : "bg-yellow-100 text-yellow-800 border border-yellow-200"
                              }`}
                            >
                              {highestSeverity === "HIGH" ? "Alerta Alta" : "Alerta Media"}
                            </span>
                          ) : (
                            <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                              Correcto
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
                        Totales:
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
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">-</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        {operatorDetails
                          .reduce((sum, op) => sum + (op.totalSewed - op.plannedQty), 0)
                          .toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-full ${
                            alerts.length > 0
                              ? alerts.filter((a) => a.severity === "HIGH").length > 0
                                ? "bg-red-100 text-red-800"
                                : "bg-yellow-100 text-yellow-800"
                              : "bg-green-100 text-green-800"
                          }`}
                        >
                          {alerts.length} Alerta{alerts.length !== 1 ? "s" : ""}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}

        {selectedLine && selectedDate && (
          <div className="mt-8">
            <Alert lineNo={selectedLine} selectedDate={selectedDate} operatorDetails={operatorDetails} />
          </div>
        )}

        {selectedLine && selectedDate && !loadingData && !runData && (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center">
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No se Encontraron Datos de Producción
            </h3>
            <p className="text-gray-600">
              No se encontraron datos de producción para la Línea {selectedLine} en {formatDate(selectedDate)}.
            </p>
          </div>
        )}

        {!selectedLine && !selectedDate && (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Seleccionar Línea y Fecha</h3>
            <p className="text-gray-600">
              Por favor seleccione una línea de producción y una fecha para ver los datos de producción.
            </p>
          </div>
        )}
      </main>

      <footer className="mt-8 py-4 border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-sm text-gray-500">
          Sistema de Monitoreo de Producción • Panel de Supervisor
        </div>
      </footer>
    </div>
  );
}
