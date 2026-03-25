// components/planner/LineAssignmentForm.jsx
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Calendar, Factory, AlertCircle, CheckCircle, Clock, Calculator } from "lucide-react";

export default function LineAssignmentForm({ workOrder, onAssignmentComplete }) {
  const [availableLines, setAvailableLines] = useState([]);
  const [selectedLine, setSelectedLine] = useState(null);
  const [assignedDate, setAssignedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [quantity, setQuantity] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [existingAssignments, setExistingAssignments] = useState([]);

  useEffect(() => {
    fetchAvailableLines();
    fetchExistingAssignments();
  }, [assignedDate]);

  const fetchAvailableLines = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(
        `http://localhost:5001/api/planning/available-lines?date=${assignedDate}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      if (data.success) {
        setAvailableLines(data.lines);
        if (data.lines.length > 0 && !selectedLine) {
          setSelectedLine(data.lines[0]);
        }
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchExistingAssignments = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(
        `http://localhost:5001/api/line-assignments?workOrderId=${workOrder.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      if (data.success) {
        setExistingAssignments(data.assignments);
      }
    } catch (err) {
      console.error("Error fetching assignments:", err);
    }
  };

  // Calculate days needed using the improved minute-based formula
  // Formula: Days = (Quantity × SAM) / (Operators × WorkingHours × 60 × Efficiency)
  const calculateDaysNeeded = () => {
    if (!selectedLine || !quantity || parseInt(quantity) <= 0) return null;
    
    const qty = parseInt(quantity);
    const samMinutes = parseFloat(selectedLine.sam_minutes) || 3.5;
    const operators = parseInt(selectedLine.operators_count) || 20;
    const workingHours = parseFloat(selectedLine.working_hours) || 8;
    const efficiency = parseFloat(selectedLine.efficiency) || 0.85;
    
    // Total minutes needed to produce the order (AUTO)
    const totalMinutesNeeded = qty * samMinutes;
    
    // Total available minutes per day (AUTO)
    const dailyAvailableMinutes = operators * workingHours * 60;
    
    // Effective minutes available after efficiency (AUTO)
    const effectiveDailyMinutes = dailyAvailableMinutes * efficiency;
    
    // Days needed (AUTO)
    const rawDaysNeeded = totalMinutesNeeded / effectiveDailyMinutes;
    const daysNeeded = Math.ceil(rawDaysNeeded);
    
    // Calculate daily production rate
    const piecesPerDay = effectiveDailyMinutes / samMinutes;
    const piecesPerHour = piecesPerDay / workingHours;
    const minutesPerPiece = samMinutes / efficiency;
    
    const startDate = new Date(assignedDate);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + daysNeeded);
    
    return {
      daysNeeded,
      rawDaysNeeded: Math.round(rawDaysNeeded * 10) / 10,
      startDate: format(startDate, "dd/MM/yyyy"),
      endDate: format(endDate, "dd/MM/yyyy"),
      dailyRate: Math.floor(piecesPerDay),
      hourlyRate: Math.floor(piecesPerHour),
      totalMinutesNeeded: Math.round(totalMinutesNeeded),
      dailyAvailableMinutes: Math.round(dailyAvailableMinutes),
      effectiveDailyMinutes: Math.round(effectiveDailyMinutes),
      minutesPerPiece: Math.round(minutesPerPiece * 100) / 100,
      efficiency: Math.round(efficiency * 100),
      samMinutes,
      operators,
      workingHours,
      quantity: qty
    };
  };

  const handleQuantityChange = (e) => {
    let value = e.target.value;
    // Remove any non-numeric characters
    value = value.replace(/[^\d]/g, '');
    
    let numValue = parseInt(value);
    if (isNaN(numValue)) {
      setQuantity("");
      return;
    }
    
    // Check against remaining to assign
    if (numValue > remainingToAssign) {
      numValue = remainingToAssign;
    }
    
    // Check against line capacity
    if (selectedLine && numValue > selectedLine.available_capacity) {
      numValue = selectedLine.available_capacity;
    }
    
    setQuantity(numValue === 0 ? "" : numValue.toString());
  };

  const handleAssignAll = () => {
    let maxToAssign = remainingToAssign;
    if (selectedLine && selectedLine.available_capacity < maxToAssign) {
      maxToAssign = selectedLine.available_capacity;
    }
    if (maxToAssign > 0) {
      setQuantity(maxToAssign.toString());
    }
  };

  const handleAssign = async () => {
    if (!selectedLine) {
      setError("Por favor seleccione una línea");
      return;
    }

    const qtyToAssign = parseInt(quantity);
    if (isNaN(qtyToAssign) || qtyToAssign <= 0) {
      setError("La cantidad debe ser mayor a 0");
      return;
    }

    if (qtyToAssign > selectedLine.available_capacity) {
      setError(`La línea ${selectedLine.line_no} solo tiene capacidad para ${Math.round(selectedLine.available_capacity).toLocaleString()} piezas en esta fecha`);
      return;
    }

    if (qtyToAssign > remainingToAssign) {
      setError(`Solo quedan ${Math.round(remainingToAssign).toLocaleString()} piezas por asignar de esta orden`);
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const token = localStorage.getItem("token");
      const response = await fetch("http://localhost:5001/api/line-assignments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          workOrderId: workOrder.id,
          lineNo: selectedLine.line_no,
          assignedDate: assignedDate,
          quantity: qtyToAssign,
          plannedStartDate: assignedDate,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setMessage(`✅ ${qtyToAssign.toLocaleString()} piezas asignadas exitosamente a Línea ${selectedLine.line_no}`);
        
        // Refresh assignments and available lines
        await fetchExistingAssignments();
        await fetchAvailableLines();
        
        // Clear quantity field
        setQuantity("");
        
        // If all assigned, close after 2 seconds
        if (remainingToAssign - qtyToAssign <= 0) {
          setTimeout(() => {
            if (onAssignmentComplete) onAssignmentComplete();
          }, 2000);
        }
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const daysInfo = calculateDaysNeeded();
  const alreadyAssigned = existingAssignments.reduce((sum, a) => sum + parseFloat(a.assigned_quantity || 0), 0);
  const remainingToAssign = Math.max(0, workOrder.quantity - alreadyAssigned);
  const isFullyAssigned = remainingToAssign <= 0;
  const maxAvailable = selectedLine ? Math.min(remainingToAssign, selectedLine.available_capacity) : 0;

  return (
    <div className="bg-white rounded-xl border shadow-sm">
      <div className="px-5 py-4 border-b">
        <h2 className="font-semibold text-gray-900">Asignar a Línea de Producción</h2>
        <p className="text-sm text-gray-600">
          Orden: {workOrder.work_order_no} - {workOrder.style_description}
        </p>
      </div>

      <div className="p-5 space-y-6">
        {/* Work Order Info */}
        <div className="bg-gray-50 rounded-xl p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-500">Cantidad Total</p>
              <p className="text-lg font-semibold text-gray-900">
                {Math.round(workOrder.quantity).toLocaleString()} pzas
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Ya Asignado</p>
              <p className="text-lg font-semibold text-blue-600">
                {Math.round(alreadyAssigned).toLocaleString()} pzas
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Pendiente por Asignar</p>
              <p className={`text-lg font-semibold ${isFullyAssigned ? 'text-green-600' : 'text-orange-600'}`}>
                {Math.round(remainingToAssign).toLocaleString()} pzas
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Estado Actual</p>
              <p className="text-sm font-medium text-gray-700 capitalize">
                {isFullyAssigned ? 'Completada' : workOrder.status}
              </p>
            </div>
          </div>
        </div>

        {/* Assignment Form - Only show if not fully assigned */}
        {!isFullyAssigned && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fecha de Asignación
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="date"
                  value={assignedDate}
                  onChange={(e) => setAssignedDate(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 pl-10 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Seleccionar Línea
              </label>
              <div className="relative">
                <Factory className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <select
                  value={selectedLine?.line_no || ""}
                  onChange={(e) => {
                    const line = availableLines.find(l => l.line_no === e.target.value);
                    setSelectedLine(line);
                    setQuantity(""); // Reset quantity when line changes
                  }}
                  className="w-full rounded-xl border border-gray-200 pl-10 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                >
                  {availableLines.map(line => (
                    <option key={line.line_no} value={line.line_no}>
                      Línea {line.line_no} - Meta: {Math.round(line.target_pcs).toLocaleString()} pzas/día - Disponible: {Math.round(line.available_capacity).toLocaleString()} pzas
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cantidad a Asignar
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={quantity}
                  onChange={handleQuantityChange}
                  className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                  placeholder="Ingrese cantidad en piezas"
                />
                <button
                  onClick={handleAssignAll}
                  disabled={maxAvailable <= 0}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200 disabled:opacity-50"
                >
                  Todo
                </button>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Máximo disponible: {Math.round(maxAvailable).toLocaleString()} pzas
              </div>
            </div>

            {/* Improved Days Calculation Display with Formula */}
            {daysInfo && selectedLine && quantity && parseInt(quantity) > 0 && (
              <div className="bg-blue-50 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <Calculator className="w-4 h-4 text-blue-600 mt-0.5" />
                  <div className="text-sm text-blue-800 flex-1">
                    <p className="font-medium">Estimación de Producción</p>
                    
                    {/* Formula Display */}
                    <div className="mt-2 text-xs bg-blue-100 rounded-lg p-2">
                      <p className="font-mono text-blue-700">
                        Días = (Cantidad × SAM) ÷ (Operadores × Horas × 60 × Eficiencia)
                      </p>
                      <p className="font-mono text-blue-600 mt-1">
                        = ({daysInfo.quantity.toLocaleString()} × {daysInfo.samMinutes}) ÷ 
                        ({daysInfo.operators} × {daysInfo.workingHours} × 60 × {daysInfo.efficiency}%)
                      </p>
                      <p className="font-mono text-blue-600">
                        = {daysInfo.totalMinutesNeeded.toLocaleString()} ÷ {daysInfo.effectiveDailyMinutes.toLocaleString()}
                      </p>
                      <p className="font-mono text-blue-800 font-semibold mt-1">
                        = {daysInfo.rawDaysNeeded} días → {daysInfo.daysNeeded} días hábiles
                      </p>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                      <div>
                        <span className="text-blue-600">Días necesarios:</span>
                        <span className="ml-1 font-semibold">{daysInfo.daysNeeded} días</span>
                      </div>
                      <div>
                        <span className="text-blue-600">Ritmo diario:</span>
                        <span className="ml-1">{Math.round(daysInfo.dailyRate).toLocaleString()} pzas/día</span>
                      </div>
                      <div>
                        <span className="text-blue-600">Ritmo horario:</span>
                        <span className="ml-1">{Math.round(daysInfo.hourlyRate).toLocaleString()} pzas/h</span>
                      </div>
                      <div>
                        <span className="text-blue-600">Minutos por pieza:</span>
                        <span className="ml-1">{daysInfo.minutesPerPiece} min</span>
                      </div>
                      <div>
                        <span className="text-blue-600">Inicio:</span>
                        <span className="ml-1">{daysInfo.startDate}</span>
                      </div>
                      <div>
                        <span className="text-blue-600">Fin estimado:</span>
                        <span className="ml-1 font-medium">{daysInfo.endDate}</span>
                      </div>
                    </div>
                    
                    {/* Efficiency Impact */}
                    <div className="mt-2 text-xs text-blue-600">
                      <span className="font-medium">Eficiencia aplicada:</span> {daysInfo.efficiency}%
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Capacity Info */}
            {selectedLine && (
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-gray-600 mt-0.5" />
                  <div className="text-sm text-gray-700 flex-1">
                    <p className="font-medium">Capacidad - Línea {selectedLine.line_no}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-gray-500">Meta diaria:</span>
                        <span className="ml-1 font-medium">{Math.round(selectedLine.target_pcs).toLocaleString()} pzas</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Operadores:</span>
                        <span className="ml-1 font-medium">{selectedLine.operators_count || 20}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Horas/día:</span>
                        <span className="ml-1 font-medium">{selectedLine.working_hours || 8} hrs</span>
                      </div>
                      <div>
                        <span className="text-gray-500">SAM:</span>
                        <span className="ml-1 font-medium">{selectedLine.sam_minutes || 3.5} min</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Eficiencia:</span>
                        <span className="ml-1 font-medium">{Math.round((selectedLine.efficiency || 0.85) * 100)}%</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Ya asignado:</span>
                        <span className="ml-1 font-medium">{Math.round(selectedLine.assigned_quantity).toLocaleString()} pzas</span>
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-600 rounded-full"
                          style={{ width: `${Math.min(selectedLine.utilization_percentage || 0, 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-blue-600 mt-1">
                        Utilización: {Math.round(selectedLine.utilization_percentage || 0)}% | 
                        Disponible: {Math.round(selectedLine.available_capacity).toLocaleString()} pzas
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Messages */}
            {error && (
              <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {message && (
              <div className="bg-green-50 text-green-700 p-3 rounded-xl text-sm flex items-start gap-2">
                <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{message}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                onClick={handleAssign}
                disabled={loading || !selectedLine || !quantity || parseInt(quantity) <= 0}
                className="flex-1 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Asignando..." : "Asignar a Línea"}
              </button>
              <button
                onClick={() => onAssignmentComplete && onAssignmentComplete()}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Fully Assigned Message */}
        {isFullyAssigned && (
          <div className="bg-green-50 rounded-xl p-6 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-green-800 mb-2">Orden Completamente Asignada</h3>
            <p className="text-sm text-green-700">
              Esta orden ya tiene todas sus {Math.round(workOrder.quantity).toLocaleString()} piezas asignadas a líneas de producción.
            </p>
            <p className="text-xs text-green-600 mt-2">
              Asignaciones: {existingAssignments.length} asignaciones a líneas: {existingAssignments.map(a => a.line_no).join(', ')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}