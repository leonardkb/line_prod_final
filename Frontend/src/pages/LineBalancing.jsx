import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function LineBalancing() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [runData, setRunData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [saving, setSaving] = useState(false);

  const user = JSON.parse(localStorage.getItem("user") || "null");
  const token = localStorage.getItem("token");

  useEffect(() => {
    if (!token || !user) return navigate("/", { replace: true });
    if (user.role !== "engineer") {
      return navigate("/planner", { replace: true });
    }
    fetchRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchRuns() {
    try {
      const res = await fetch("http://localhost:5000/api/line-runs");
      const json = await res.json();
      if (json.success) setRuns(json.runs);
    } catch (err) {
      setError("Error cargando corridas");
    }
  }

  async function fetchBalancingData(runId) {
    setLoading(true);
    setError("");
    setInfoMessage("");
    setRunData(null);
    setSuggestions([]);
    setAssignments([]);
    try {
      const res = await fetch(`http://localhost:5000/api/engineer/line-balancing/${runId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.status === 401) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/");
        return;
      }
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Error");
      setRunData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const handleRunChange = (e) => {
    const id = e.target.value;
    setSelectedRunId(id);
    if (id) fetchBalancingData(id);
  };

  // Simple balancing algorithm (greedy) with safeNum
  const suggestBalancing = () => {
    if (!runData) return;

    setInfoMessage("");
    const targetPerHour = safeNum(runData.run.target_per_hour);
    const operators = runData.operators.map(op => {
      // Assume first operation is the main one; fallback if none
      const mainOp = op.operations[0] || { capacity_per_hour: 0, operation_id: null, operation_name: "" };
      const capacity = safeNum(mainOp.capacity_per_hour);
      const required = targetPerHour;
      const gap = capacity - required;
      const neededHelp = gap < 0 ? -gap : 0;
      const spare = gap > 0 ? gap : 0;
      return {
        ...op,
        mainOp,
        capacity,
        required,
        gap,
        neededHelp,
        spare
      };
    });

    const bottlenecks = operators.filter(op => op.gap < 0).sort((a,b) => a.gap - b.gap);
    const helpers = operators.filter(op => op.gap > 0).sort((a,b) => b.gap - a.gap);

    console.log("Bottlenecks:", bottlenecks.length, "Helpers:", helpers.length);
    console.log("Target per hour:", targetPerHour);
    console.log("Operators data:", operators);

    const sugg = [];
    for (let b of bottlenecks) {
      let need = b.neededHelp;
      for (let h of helpers) {
        if (need <= 0) break;
        const take = Math.min(need, h.spare);
        if (take > 0) {
          sugg.push({
            sourceOperatorId: b.operator_id,
            sourceOperatorNo: b.operator_no,
            targetOperatorId: h.operator_id,
            targetOperatorNo: h.operator_no,
            operationId: b.mainOp.operation_id,
            quantity: take
          });
          need -= take;
          h.spare -= take; // reduce spare for next iterations
        }
      }
    }

    if (sugg.length === 0) {
      if (bottlenecks.length === 0) {
        setInfoMessage("No hay cuellos de botella (todos los operadores cumplen o superan el objetivo).");
      } else if (helpers.length === 0) {
        setInfoMessage("Hay cuellos de botella, pero no hay operadores con capacidad de sobra para ayudar.");
      } else {
        setInfoMessage("No se pudo generar ninguna sugerencia. Verifique los datos.");
      }
    }

    setSuggestions(sugg);
    // Pre-fill assignments with suggestions (user can edit)
    setAssignments(sugg.map(s => ({ ...s, assignedQtyPerHour: s.quantity })));
  };

  const handleQuantityChange = (index, newQty) => {
    const updated = [...assignments];
    updated[index].assignedQtyPerHour = safeNum(newQty);
    setAssignments(updated);
  };

  const saveAssignments = async () => {
    setSaving(true);
    setError("");
    setInfoMessage("");
    try {
      const payload = {
        assignments: assignments.map(a => ({
          sourceOperatorId: a.sourceOperatorId,
          targetOperatorId: a.targetOperatorId,
          operationId: a.operationId,
          assignedQtyPerHour: a.assignedQtyPerHour
        }))
      };
      const res = await fetch(`http://localhost:5000/api/engineer/line-balancing/${selectedRunId}/assign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload)
      });
      if (res.status === 401) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/");
        return;
      }
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Error al guardar");
      alert("Asignaciones guardadas correctamente");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Balance de Línea</h1>
        <p className="text-sm text-gray-600 mb-6">
          Selecciona una corrida para analizar capacidades y equilibrar la carga entre operadores.
        </p>

        <div className="mb-6 max-w-md">
          <label className="block text-sm font-medium text-gray-700 mb-1">Corrida</label>
          <select
            value={selectedRunId}
            onChange={handleRunChange}
            className="w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
          >
            <option value="">Seleccionar...</option>
            {runs.map(r => (
              <option key={r.id} value={r.id}>
                Línea {r.line_no} – {r.run_date} – {r.style}
              </option>
            ))}
          </select>
        </div>

        {loading && <div className="text-center py-8">Cargando datos de la línea...</div>}
        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>}
        {infoMessage && (
          <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-800">
            {infoMessage}
          </div>
        )}

        {runData && !loading && (
          <>
            <div className="rounded-3xl border bg-white shadow-sm p-6 mb-6">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <div className="text-xs text-gray-500">Línea</div>
                  <div className="text-lg font-semibold">{runData.run.line_no}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Objetivo por hora</div>
                  <div className="text-lg font-semibold">{safeNum(runData.run.target_per_hour).toFixed(2)} pcs</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Horas de trabajo</div>
                  <div className="text-lg font-semibold">{runData.run.working_hours}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Operadores</div>
                  <div className="text-lg font-semibold">{runData.run.operators_count}</div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border bg-white shadow-sm p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold">Capacidades por operador</h2>
                <button
                  onClick={suggestBalancing}
                  className="rounded-xl bg-gray-900 text-white px-5 py-2 text-sm font-semibold hover:bg-gray-800"
                >
                  Sugerir balance
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 border-y border-gray-200 rounded-tl-xl">Operador</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 border-y border-gray-200">Operación</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 border-y border-gray-200">Capacidad (pcs/h)</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 border-y border-gray-200">Requerido (pcs/h)</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 border-y border-gray-200">Brecha</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 border-y border-gray-200 rounded-tr-xl">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runData.operators.map(op => {
                      const mainOp = op.operations[0] || { capacity_per_hour: 0, operation_name: "" };
                      const capacity = safeNum(mainOp.capacity_per_hour);
                      const required = safeNum(runData.run.target_per_hour);
                      const gap = capacity - required;
                      return (
                        <tr key={op.operator_id}>
                          <td className="px-4 py-3 border-b border-gray-200">
                            {op.operator_no} {op.operator_name && `(${op.operator_name})`}
                          </td>
                          <td className="px-4 py-3 border-b border-gray-200">{mainOp.operation_name || "—"}</td>
                          <td className="px-4 py-3 border-b border-gray-200">{capacity.toFixed(2)}</td>
                          <td className="px-4 py-3 border-b border-gray-200">{required.toFixed(2)}</td>
                          <td className="px-4 py-3 border-b border-gray-200">{gap.toFixed(2)}</td>
                          <td className="px-4 py-3 border-b border-gray-200">
                            {gap < -0.01 && <span className="text-red-600 font-medium">Bajo</span>}
                            {gap > 0.01 && <span className="text-green-600 font-medium">Exceso</span>}
                            {Math.abs(gap) <= 0.01 && <span className="text-gray-500">Equilibrado</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {suggestions.length > 0 && (
              <div className="mt-6 rounded-3xl border bg-white shadow-sm p-6">
                <h2 className="text-lg font-semibold mb-4">Propuesta de balance</h2>
                <div className="space-y-4">
                  {assignments.map((a, idx) => (
                    <div key={idx} className="flex flex-wrap items-center gap-3 p-3 border rounded-2xl bg-gray-50">
                      <span className="text-sm">
                        Operador <span className="font-medium">{a.sourceOperatorNo}</span> (lento) ←
                        Ayuda de operador <span className="font-medium">{a.targetOperatorNo}</span> (rápido)
                      </span>
                      <input
                        type="number"
                        value={a.assignedQtyPerHour}
                        onChange={(e) => handleQuantityChange(idx, e.target.value)}
                        className="w-24 rounded-xl border px-3 py-1 text-sm"
                        step="0.1"
                        min="0"
                      />
                      <span className="text-sm">pcs/h</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={saveAssignments}
                    disabled={saving}
                    className="rounded-xl bg-green-600 text-white px-6 py-3 text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
                  >
                    {saving ? "Guardando..." : "💾 Guardar asignaciones"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}