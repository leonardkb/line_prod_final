// components/planner/LineAssignmentForm.jsx - COMPLETELY FIXED VERSION
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Calendar, Factory, AlertCircle, CheckCircle, Clock, Calculator, Plus, Trash2, Layers } from "lucide-react";

export default function LineAssignmentForm({ workOrder, onAssignmentComplete }) {
  const [availableLines, setAvailableLines] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [existingAssignments, setExistingAssignments] = useState([]);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));

  // Initialize with one empty assignment slot
  useEffect(() => {
    setAssignments([{
      id: Date.now(),
      lineNo: "",
      quantity: 0,
      lineData: null,
      daysInfo: null
    }]);
  }, []);

  useEffect(() => {
    fetchAvailableLines();
    fetchExistingAssignments();
  }, [selectedDate]);

  const fetchAvailableLines = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(
        `http://localhost:5001/api/planning/available-lines?date=${selectedDate}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      if (data.success) {
        setAvailableLines(data.lines);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
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

  // Calculate days needed for a specific line and quantity
  const calculateDaysNeeded = (lineData, quantity) => {
    if (!lineData || !quantity || quantity <= 0) return null;
    
    const qty = quantity;
    const samMinutes = parseFloat(lineData.sam_minutes) || 3.5;
    const operators = parseInt(lineData.operators_count) || 20;
    const workingHours = parseFloat(lineData.working_hours) || 8;
    const efficiency = parseFloat(lineData.efficiency) || 0.85;
    
    const totalMinutesNeeded = qty * samMinutes;
    const dailyAvailableMinutes = operators * workingHours * 60;
    const effectiveDailyMinutes = dailyAvailableMinutes * efficiency;
    const rawDaysNeeded = totalMinutesNeeded / effectiveDailyMinutes;
    const daysNeeded = Math.ceil(rawDaysNeeded);
    
    const piecesPerDay = effectiveDailyMinutes / samMinutes;
    const piecesPerHour = piecesPerDay / workingHours;
    const minutesPerPiece = samMinutes / efficiency;
    
    const startDate = new Date(selectedDate);
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
      effectiveDailyMinutes: Math.round(effectiveDailyMinutes),
      minutesPerPiece: Math.round(minutesPerPiece * 100) / 100,
      efficiency: Math.round(efficiency * 100),
      quantity: qty
    };
  };

  const handleAddAssignment = () => {
    setAssignments([...assignments, {
      id: Date.now(),
      lineNo: "",
      quantity: 0,
      lineData: null,
      daysInfo: null
    }]);
  };

  const handleRemoveAssignment = (id) => {
    if (assignments.length === 1) {
      setError("Debe tener al menos una asignación");
      return;
    }
    setAssignments(assignments.filter(a => a.id !== id));
  };

  // Helper to get max available for a line, optionally excluding a specific assignment
  const getMaxAvailableForLineInternal = (lineNo, excludeAssignmentId = null) => {
    const line = availableLines.find(l => l.line_no === lineNo);
    if (!line) return 0;
    
    // Use the server's available_capacity as the starting point
    // This already accounts for all existing assignments in the database
    let maxAvailable = line.available_capacity;
    
    // Subtract other assignments from the current session
    // (excluding the one we're currently editing if specified)
    const otherAssignmentsToSameLine = assignments
      .filter(a => a.lineNo === lineNo && a.quantity && a.id !== excludeAssignmentId)
      .reduce((sum, a) => sum + (a.quantity || 0), 0);
    
    maxAvailable = maxAvailable - otherAssignmentsToSameLine;
    
    // Ensure we don't return negative values
    return Math.max(0, maxAvailable);
  };

  // Public version for display
  const getMaxAvailableForLine = (lineNo, assignmentId = null) => {
    return getMaxAvailableForLineInternal(lineNo, assignmentId);
  };

  const handleAssignmentChange = (id, field, value) => {
    setAssignments(prev => prev.map(assignment => {
      if (assignment.id === id) {
        const updated = { ...assignment };
        
        if (field === 'lineNo') {
          const selectedLine = availableLines.find(l => l.line_no === value);
          updated.lineNo = value;
          updated.lineData = selectedLine;
          updated.quantity = 0;
          updated.daysInfo = null;
          
          // Clear any previous errors when changing line
          setError("");
        }
        
        if (field === 'quantity') {
          let qty = parseInt(value);
          if (isNaN(qty)) qty = 0;
          if (qty < 0) qty = 0;
          
          // Check against max available for this line, EXCLUDING this assignment
          if (updated.lineData) {
            const maxAvailable = getMaxAvailableForLineInternal(updated.lineNo, id);
            if (qty > maxAvailable && maxAvailable > 0) {
              qty = maxAvailable;
              setError(`⚠️ Línea ${updated.lineNo}: Solo tiene capacidad para ${Math.floor(maxAvailable).toLocaleString()} piezas en esta fecha.`);
              setTimeout(() => setError(""), 3000);
            }
          }
          
          // Check against remaining to assign for this work order
          const remaining = getRemainingToAssignInternal();
          const currentTotalWithoutThis = getTotalToAssignInternal() - (updated.quantity || 0);
          if (currentTotalWithoutThis + qty > remaining) {
            qty = Math.max(0, remaining - currentTotalWithoutThis);
            if (qty > 0 && qty !== parseInt(value)) {
              setError(`⚠️ Solo quedan ${remaining.toLocaleString()} piezas pendientes por asignar.`);
              setTimeout(() => setError(""), 3000);
            }
          }
          
          updated.quantity = qty;
          
          // Update days info
          if (updated.lineData && qty > 0) {
            updated.daysInfo = calculateDaysNeeded(updated.lineData, qty);
          } else {
            updated.daysInfo = null;
          }
        }
        
        return updated;
      }
      return assignment;
    }));
  };

  const getTotalToAssignInternal = () => {
    return assignments.reduce((sum, a) => sum + (a.quantity || 0), 0);
  };

  const getRemainingToAssignInternal = () => {
    const alreadyAssigned = existingAssignments.reduce((sum, a) => sum + parseFloat(a.assigned_quantity || 0), 0);
    const totalToProduce = workOrder.totalToProduce || workOrder.quantity;
    return Math.max(0, totalToProduce - alreadyAssigned);
  };

  // Public versions for display
  const getTotalToAssign = () => {
    return getTotalToAssignInternal();
  };

  const getRemainingToAssign = () => {
    return getRemainingToAssignInternal();
  };

  const handleSubmitAssignments = async () => {
    // Validate all assignments
    const validAssignments = assignments.filter(a => a.lineNo && a.quantity > 0);
    
    if (validAssignments.length === 0) {
      setError("Por favor complete al menos una asignación válida");
      return;
    }
    
    const totalToAssign = getTotalToAssign();
    const remainingToAssign = getRemainingToAssign();
    
    if (totalToAssign > remainingToAssign) {
      setError(`La cantidad total a asignar (${totalToAssign.toLocaleString()} pzas) excede lo pendiente (${remainingToAssign.toLocaleString()} pzas)`);
      return;
    }
    
    // Check each assignment against line capacity
    for (const assignment of validAssignments) {
      // Get max available including this assignment's potential impact
      const maxAvailable = getMaxAvailableForLineInternal(assignment.lineNo, assignment.id);
      const qty = assignment.quantity;
      
      if (qty > maxAvailable) {
        setError(`❌ Línea ${assignment.lineNo}: Solo tiene capacidad para ${Math.floor(maxAvailable).toLocaleString()} piezas en esta fecha. Cantidad solicitada: ${qty.toLocaleString()}`);
        return;
      }
    }
    
    setLoading(true);
    setError("");
    setMessage("");
    
    try {
      const token = localStorage.getItem("token");
      let successCount = 0;
      let errorCount = 0;
      const errors = [];
      
      // Create each assignment
      for (const assignment of validAssignments) {
        try {
          const response = await fetch("http://localhost:5001/api/line-assignments", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              workOrderId: workOrder.id,
              lineNo: assignment.lineNo,
              assignedDate: selectedDate,
              quantity: assignment.quantity,
              plannedStartDate: selectedDate,
            }),
          });
          
          const data = await response.json();
          if (data.success) {
            successCount++;
          } else {
            errorCount++;
            errors.push(`Línea ${assignment.lineNo}: ${data.error}`);
            console.error(`Error assigning to line ${assignment.lineNo}:`, data.error);
          }
        } catch (err) {
          errorCount++;
          errors.push(`Línea ${assignment.lineNo}: ${err.message}`);
          console.error(`Error assigning to line ${assignment.lineNo}:`, err);
        }
      }
      
      // Refresh assignments and available lines
      await fetchExistingAssignments();
      await fetchAvailableLines();
      
      // Clear current assignments
      setAssignments([{
        id: Date.now(),
        lineNo: "",
        quantity: 0,
        lineData: null,
        daysInfo: null
      }]);
      
      if (successCount > 0) {
        const successMsg = `✅ ${successCount} asignación(es) creada(s) exitosamente.`;
        const errorMsg = errorCount > 0 ? `\n❌ ${errorCount} fallaron: ${errors.join("; ")}` : "";
        setMessage(successMsg + errorMsg);
        
        // Check if fully assigned
        const newRemaining = getRemainingToAssign();
        if (newRemaining <= 0) {
          setTimeout(() => {
            if (onAssignmentComplete) onAssignmentComplete();
          }, 2000);
        }
      } else {
        setError("No se pudo crear ninguna asignación. " + (errors.length ? errors.join("; ") : ""));
      }
      
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const alreadyAssigned = existingAssignments.reduce((sum, a) => sum + parseFloat(a.assigned_quantity || 0), 0);
  const remainingToAssign = getRemainingToAssign();
  const isFullyAssigned = remainingToAssign <= 0;
  const totalToAssign = getTotalToAssign();

  return (
    <div className="bg-white rounded-xl border shadow-sm">
      <div className="px-5 py-4 border-b bg-gradient-to-r from-gray-50 to-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900 text-lg">Asignar a Línea de Producción</h2>
            <p className="text-sm text-gray-600">
              Orden: {workOrder.work_order_no} - {workOrder.style_description}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-gray-400" />
            <span className="text-sm text-gray-600">
              Puede asignar a múltiples líneas
            </span>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-6 max-h-[70vh] overflow-y-auto">
        {/* Work Order Info */}
        <div className="bg-gray-50 rounded-xl p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-500">Total a Producir</p>
              <p className="text-lg font-semibold text-gray-900">
                {Math.round(workOrder.totalToProduce || workOrder.quantity).toLocaleString()} pzas
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
              <p className="text-xs text-gray-500">A Asignar en Esta Sesión</p>
              <p className="text-lg font-semibold text-purple-600">
                {Math.round(totalToAssign).toLocaleString()} pzas
              </p>
            </div>
          </div>
        </div>

        {/* Date Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Fecha de Asignación
          </label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full rounded-xl border border-gray-200 pl-10 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
        </div>

        {/* Assignment Slots */}
        {!isFullyAssigned && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">Asignaciones</h3>
              <button
                type="button"
                onClick={handleAddAssignment}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
              >
                <Plus className="w-4 h-4" />
                Agregar Línea
              </button>
            </div>
            
            {assignments.map((assignment, index) => (
              <div key={assignment.id} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-gray-500">Asignación #{index + 1}</span>
                  {assignments.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveAssignment(assignment.id)}
                      className="p-1 text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Seleccionar Línea
                    </label>
                    <select
                      value={assignment.lineNo}
                      onChange={(e) => handleAssignmentChange(assignment.id, 'lineNo', e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                    >
                      <option value="">Seleccionar línea...</option>
                      {availableLines.map(line => {
                        const maxAvailable = getMaxAvailableForLineInternal(line.line_no);
                        const isDisabled = maxAvailable <= 0;
                        return (
                          <option key={line.line_no} value={line.line_no} disabled={isDisabled}>
                            Línea {line.line_no} - {Math.round(line.target_pcs).toLocaleString()} pzas/día - 
                            Disponible: {Math.floor(maxAvailable).toLocaleString()} pzas
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Cantidad a Asignar
                    </label>
                    <input
                      type="number"
                      value={assignment.quantity || ""}
                      onChange={(e) => handleAssignmentChange(assignment.id, 'quantity', e.target.value)}
                      min="1"
                      max={assignment.lineData ? getMaxAvailableForLineInternal(assignment.lineNo, assignment.id) : undefined}
                      disabled={!assignment.lineNo}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10 disabled:bg-gray-100"
                      placeholder="Cantidad en piezas"
                    />
                    {assignment.lineData && (
                      <p className="text-xs text-gray-400 mt-1">
                        Máx: {Math.floor(getMaxAvailableForLineInternal(assignment.lineNo, assignment.id)).toLocaleString()} pzas
                      </p>
                    )}
                  </div>
                </div>
                
                {/* Days Calculation for this assignment */}
                {assignment.daysInfo && assignment.quantity > 0 && (
                  <div className="mt-3 p-2 bg-blue-50 rounded-lg">
                    <div className="flex items-start gap-2">
                      <Calculator className="w-3 h-3 text-blue-600 mt-0.5" />
                      <div className="text-xs text-blue-800">
                        <p className="font-medium">Estimación para Línea {assignment.lineNo}</p>
                        <div className="grid grid-cols-3 gap-2 mt-1">
                          <span>Días: {assignment.daysInfo.daysNeeded}</span>
                          <span>Ritmo: {assignment.daysInfo.dailyRate.toLocaleString()} pzas/día</span>
                          <span>Fin: {assignment.daysInfo.endDate}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            
            {/* Summary of assignments */}
            {totalToAssign > 0 && (
              <div className="bg-blue-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-800">Resumen de Asignaciones</span>
                </div>
                <div className="space-y-1 text-sm text-blue-700">
                  {assignments.filter(a => a.lineNo && a.quantity > 0).map((a, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span>Línea {a.lineNo}:</span>
                      <span className="font-medium">{a.quantity.toLocaleString()} pzas</span>
                    </div>
                  ))}
                  <div className="pt-2 mt-2 border-t border-blue-200 flex justify-between font-semibold">
                    <span>Total a asignar:</span>
                    <span>{totalToAssign.toLocaleString()} pzas</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span>Pendiente después de asignar:</span>
                    <span className={remainingToAssign - totalToAssign <= 0 ? "text-green-600" : "text-orange-600"}>
                      {(remainingToAssign - totalToAssign).toLocaleString()} pzas
                    </span>
                  </div>
                </div>
              </div>
            )}
            
            {/* Existing Assignments Display */}
            {existingAssignments.length > 0 && (
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Asignaciones Existentes</h3>
                <div className="space-y-1">
                  {existingAssignments.map((a, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span>Línea {a.line_no}:</span>
                      <span className="font-medium">{Math.round(a.assigned_quantity).toLocaleString()} pzas</span>
                      <span className="text-xs text-gray-500">
                        {a.status === 'completed' ? '✓ Completada' : a.status === 'planned' ? '📋 Planificada' : a.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Error/Message Display */}
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
                onClick={handleSubmitAssignments}
                disabled={loading || totalToAssign === 0}
                className="flex-1 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Asignando..." : `Asignar ${totalToAssign > 0 ? totalToAssign.toLocaleString() : ""} Piezas`}
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
              Esta orden ya tiene todas sus {Math.round(workOrder.totalToProduce || workOrder.quantity).toLocaleString()} piezas asignadas.
            </p>
            <p className="text-xs text-green-600 mt-2">
              {existingAssignments.length} asignaciones a líneas: {existingAssignments.map(a => a.line_no).join(', ')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}