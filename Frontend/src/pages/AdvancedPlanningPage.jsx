// [file name]: AdvancedPlanningPage.jsx
import { useState, useEffect, useMemo } from "react";
import Navbar from "../components/Navbar";
import StyleSelector from "../components/planner/StyleSelector";
import LineDetailsCard from "../components/planner/LineDetailsCard";
import WorkOrderForm from "../components/planner/WorkOrderForm";
import PlanningSummary from "../components/planner/PlanningSummary";
import DaysCalculator from "../utils/calculateProductionDays";
import { format, addDays } from "date-fns";

export default function AdvancedPlanningPage() {
  const [lineRuns, setLineRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [workOrderData, setWorkOrderData] = useState({
    workOrderNo: "",
    quantity: "",
    customerName: "",
    styleDescription: "",
    color: "",
    fabricSupplier: "",
  });
  const [calculatedDays, setCalculatedDays] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [activePanel, setActivePanel] = useState("selection"); // selection | form | summary

  // Fetch all line runs for style selection
  useEffect(() => {
    fetchLineRuns();
  }, []);

  const fetchLineRuns = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const response = await fetch("http://localhost:5000/api/line-runs", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        setLineRuns(data.runs);
      } else {
        setMessage(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ Error fetching line runs: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle style selection
  const handleStyleSelect = (run) => {
    setSelectedRun(run);
    setWorkOrderData(prev => ({
      ...prev,
      styleDescription: run.style,
    }));
    setActivePanel("form");
  };

  // Calculate days needed based on quantity and line capacity
  const calculateProductionDays = (quantity) => {
    if (!selectedRun || !quantity) return null;

    const targetPerDay = selectedRun.target_pcs;
    const workingHours = selectedRun.working_hours;
    const operators = selectedRun.operators_count;
    
    // Calculate days needed
    const daysNeeded = quantity / targetPerDay;
    const startDate = new Date();
    const endDate = addDays(startDate, Math.ceil(daysNeeded));
    
    // Calculate hourly production rate
    const hourlyRate = targetPerDay / workingHours;
    
    // Calculate minutes per piece
    const minutesPerPiece = (workingHours * 60) / targetPerDay;
    
    // Calculate total minutes needed
    const totalMinutesNeeded = quantity * minutesPerPiece;
    
    // Calculate minutes available per day
    const minutesPerDay = workingHours * 60 * operators;
    
    return {
      daysNeeded: Math.ceil(daysNeeded * 10) / 10,
      workingDaysNeeded: Math.ceil(daysNeeded),
      startDate: format(startDate, "yyyy-MM-dd"),
      endDate: format(endDate, "yyyy-MM-dd"),
      hourlyRate: Math.round(hourlyRate * 100) / 100,
      minutesPerPiece: Math.round(minutesPerPiece * 100) / 100,
      totalMinutesNeeded: Math.round(totalMinutesNeeded),
      minutesPerDay: Math.round(minutesPerDay),
      targetPerDay: Math.round(targetPerDay),
      quantity: quantity,
    };
  };

  // Update calculations when quantity changes
  useEffect(() => {
    if (workOrderData.quantity && selectedRun) {
      setCalculatedDays(calculateProductionDays(parseFloat(workOrderData.quantity)));
    } else {
      setCalculatedDays(null);
    }
  }, [workOrderData.quantity, selectedRun]);

  const handleWorkOrderChange = (field, value) => {
    setWorkOrderData(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveWorkOrder = async () => {
    // Validate required fields
    if (!workOrderData.workOrderNo || !workOrderData.quantity || !workOrderData.customerName) {
      setMessage("❌ Por favor complete todos los campos requeridos");
      return;
    }

    if (!selectedRun) {
      setMessage("❌ Por favor seleccione un estilo primero");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const token = localStorage.getItem("token");
      
      // First create the work order
      const workOrderResponse = await fetch("http://localhost:5000/api/work-orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          workOrderNo: workOrderData.workOrderNo,
          quantity: parseFloat(workOrderData.quantity),
          customerName: workOrderData.customerName,
          styleDescription: workOrderData.styleDescription,
          color: workOrderData.color,
          fabricSupplier: workOrderData.fabricSupplier,
          styleCode: selectedRun.style,
          lineNo: selectedRun.line_no,
          runDate: selectedRun.run_date,
        }),
      });

      const woData = await workOrderResponse.json();
      
      if (!woData.success) {
        throw new Error(woData.error);
      }

      // Then create the line assignment
      const assignmentResponse = await fetch("http://localhost:5000/api/line-assignments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          workOrderId: woData.workOrder.id,
          lineNo: selectedRun.line_no,
          assignedDate: selectedRun.run_date,
          quantity: parseFloat(workOrderData.quantity),
          plannedStartDate: calculatedDays?.startDate,
          plannedEndDate: calculatedDays?.endDate,
        }),
      });

      const assignmentData = await assignmentResponse.json();
      
      if (!assignmentData.success) {
        throw new Error(assignmentData.error);
      }

      setMessage(`✅ Orden de trabajo creada y asignada exitosamente a Línea ${selectedRun.line_no}`);
      setActivePanel("summary");
      
      // Reset form after successful save (optional)
      // setWorkOrderData({...});
      // setSelectedRun(null);
      
    } catch (err) {
      setMessage(`❌ Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">
            Planificador Avanzado de Producción
          </h1>
          <p className="text-sm text-gray-600">
            Seleccione un estilo existente, ingrese los detalles de la orden y calcule los días de producción
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="mb-6 flex gap-3">
          <button
            onClick={() => setActivePanel("selection")}
            className={`rounded-xl px-4 py-2 text-sm font-medium border ${
              activePanel === "selection"
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-800 border-gray-200 hover:border-gray-300"
            }`}
          >
            1. Seleccionar Estilo
          </button>

          <button
            onClick={() => setActivePanel("form")}
            disabled={!selectedRun}
            className={`rounded-xl px-4 py-2 text-sm font-medium border ${
              activePanel === "form" && selectedRun
                ? "bg-gray-900 text-white border-gray-900"
                : !selectedRun
                ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                : "bg-white text-gray-800 border-gray-200 hover:border-gray-300"
            }`}
          >
            2. Detalles de Orden
          </button>

          <button
            onClick={() => setActivePanel("summary")}
            disabled={!calculatedDays}
            className={`rounded-xl px-4 py-2 text-sm font-medium border ${
              activePanel === "summary" && calculatedDays
                ? "bg-gray-900 text-white border-gray-900"
                : !calculatedDays
                ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                : "bg-white text-gray-800 border-gray-200 hover:border-gray-300"
            }`}
          >
            3. Resumen y Guardar
          </button>
        </div>

        {/* Message Display */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-lg ${
              message.includes("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}
          >
            {message}
          </div>
        )}

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Main Form */}
          <div className="lg:col-span-2 space-y-6">
            {activePanel === "selection" && (
              <StyleSelector
                lineRuns={lineRuns}
                onSelect={handleStyleSelect}
                selectedRun={selectedRun}
                loading={loading}
              />
            )}

            {activePanel === "form" && selectedRun && (
              <WorkOrderForm
                workOrderData={workOrderData}
                onChange={handleWorkOrderChange}
                selectedRun={selectedRun}
              />
            )}

            {activePanel === "summary" && calculatedDays && (
              <PlanningSummary
                workOrderData={workOrderData}
                selectedRun={selectedRun}
                calculatedDays={calculatedDays}
                onSave={handleSaveWorkOrder}
                isSaving={loading}
              />
            )}
          </div>

          {/* Right Column - Line Details & Calculations */}
          <div className="lg:col-span-1 space-y-6">
            {selectedRun && (
              <>
                <LineDetailsCard lineRun={selectedRun} />
                
                {calculatedDays && (
                  <div className="rounded-2xl border bg-white shadow-sm p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">
                      Cálculo de Días
                    </h3>
                    
                    <div className="space-y-3">
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-gray-600">Cantidad:</span>
                        <span className="text-sm font-medium">{calculatedDays.quantity} pzas</span>
                      </div>
                      
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-gray-600">Meta diaria:</span>
                        <span className="text-sm font-medium">{calculatedDays.targetPerDay} pzas/día</span>
                      </div>
                      
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-gray-600">Días necesarios:</span>
                        <span className="text-sm font-medium text-blue-600">
                          {calculatedDays.daysNeeded} días
                        </span>
                      </div>
                      
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-gray-600">Inicio:</span>
                        <span className="text-sm font-medium">{calculatedDays.startDate}</span>
                      </div>
                      
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-gray-600">Fin estimado:</span>
                        <span className="text-sm font-medium">{calculatedDays.endDate}</span>
                      </div>
                      
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm text-gray-600">Minutos totales:</span>
                        <span className="text-sm font-medium">{calculatedDays.totalMinutesNeeded} min</span>
                      </div>
                      
                      <div className="flex justify-between py-2">
                        <span className="text-sm text-gray-600">Ritmo horario:</span>
                        <span className="text-sm font-medium">{calculatedDays.hourlyRate} pzas/h</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}