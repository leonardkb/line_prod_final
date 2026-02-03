import { useEffect, useState } from "react";
import { calcTargetFromSAM, safeNum } from "../utils/calc";
import { buildShiftSlots } from "../utils/timeslots";
import MetaSummary from "./MetaSummary";
import OperationPlanner from "./OperationPlanner";
import ViewEditOperationPlanner from './ViewEditOperationPlanner'; 

export default function SavedRunsViewer({ onBack }) {
  const [lineRuns, setLineRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [runData, setRunData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [activePanel, setActivePanel] = useState("select"); // select, summary, operations
  
  // Load all saved line runs
  useEffect(() => {
    fetchLineRuns();
  }, []);
  
  const fetchLineRuns = async () => {
    setLoading(true);
    try {
      const response = await fetch("http://localhost:5000/api/line-runs");
      const data = await response.json();
      
      if (data.success) {
        setLineRuns(data.runs);
      } else {
        setMessage(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ Failed to load runs: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  const handleSelectRun = async (runId) => {
    setLoading(true);
    setMessage("");
    
    try {
      const response = await fetch(`http://localhost:5000/api/run/${runId}`);
      const data = await response.json();
      
      if (data.success) {
        setSelectedRun(runId);
        setRunData(data);
        setActivePanel("summary");
      } else {
        setMessage(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ Failed to load run data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  // Refresh operations data without changing panel
  const refreshOperationsData = async () => {
    if (!selectedRun) return;
    
    setLoading(true);
    try {
      const response = await fetch(`http://localhost:5000/api/run/${selectedRun}`);
      const data = await response.json();
      
      if (data.success) {
        setRunData(data); // Just update the data, don't change activePanel
      } else {
        setMessage(`❌ Error refreshing data: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ Failed to refresh data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  // Convert database slots to frontend format
  const getSlotsFromData = () => {
    if (!runData?.slots) return [];
    
    return runData.slots.map(slot => ({
      id: slot.slot_label, // Using label as ID
      label: slot.slot_label,
      hours: parseFloat(slot.planned_hours),
      startTime: slot.slot_start,
      endTime: slot.slot_end
    }));
  };
  
  // Convert database operations to frontend rows format
  const getRowsFromData = () => {
    if (!runData?.operations) return [];
    
    const rows = [];
    
    runData.operations.forEach(opGroup => {
      opGroup.operations.forEach(op => {
        const stitched = {};
        
        // Map stitched data from database
        if (op.stitched_data) {
          Object.entries(op.stitched_data).forEach(([slotLabel, qty]) => {
            if (slotLabel) {
              stitched[slotLabel] = qty;
            }
          });
        }
        
        rows.push({
          id: `db_${op.id}`,
          operatorNo: opGroup.operator.operator_no.toString(),
          operatorName: opGroup.operator.operator_name || "",
          operation: op.operation_name,
          t1: op.t1_sec?.toString() || "",
          t2: op.t2_sec?.toString() || "",
          t3: op.t3_sec?.toString() || "",
          t4: op.t4_sec?.toString() || "",
          t5: op.t5_sec?.toString() || "",
          capPerOperator: parseFloat(op.capacity_per_hour) || 0,
          stitched
        });
      });
    });
    
    return rows;
  };
  
  // Get slot targets from data
  const getSlotTargets = () => {
    if (!runData?.slotTargets) return [];
    return runData.slotTargets.map(st => parseFloat(st.slot_target) || 0);
  };
  
  const getCumulativeTargets = () => {
    if (!runData?.slotTargets) return [];
    return runData.slotTargets.map(st => parseFloat(st.cumulative_target) || 0);
  };
  
  // Update hourly data
  const handleUpdateHourlyData = async (rows) => {
    if (!selectedRun) return;
    
    setLoading(true);
    setMessage("");
    
    try {
      const slots = getSlotsFromData();
      const hourlyPayloads = [];
      
      rows.forEach(row => {
        if (row.stitched) {
          slots.forEach(slot => {
            const stitchedQty = row.stitched[slot.id];
            if (stitchedQty !== "" && stitchedQty !== null && stitchedQty !== undefined) {
              hourlyPayloads.push({
                operatorNo: row.operatorNo,
                operationName: row.operation,
                slotLabel: slot.label,
                stitchedQty: parseFloat(stitchedQty) || 0
              });
            }
          });
        }
      });
      
      if (hourlyPayloads.length === 0) {
        setMessage("⚠️ No hourly data to update");
        setLoading(false);
        return;
      }
      
      const response = await fetch(`http://localhost:5000/api/update-hourly-data/${selectedRun}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: hourlyPayloads })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setMessage(`✅ Updated ${data.savedCount + data.updatedCount} hourly entries`);
        // Refresh ONLY the operations data without changing panel
        await refreshOperationsData();
      } else {
        setMessage(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ Failed to update hourly data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  const handleAddOperation = async (operationData) => {
    if (!selectedRun) return;
    
    setLoading(true);
    setMessage("");
    
    try {
      const response = await fetch(`http://localhost:5000/api/add-operation/${selectedRun}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operationData)
      });
      
      const data = await response.json();
      
      if (data.success) {
        setMessage("✅ Operation added successfully");
        // Refresh ONLY the operations data without changing panel
        await refreshOperationsData();
      } else {
        setMessage(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ Failed to add operation: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">View Saved Runs</h1>
          <p className="text-sm text-gray-600">
            Select a saved line run to view and update data
          </p>
        </div>
        <button
          onClick={onBack}
          className="rounded-xl px-4 py-2 text-sm font-medium border border-gray-200 hover:bg-gray-50"
        >
          ← Back to Planner
        </button>
      </div>
      
      {/* Message Display */}
      {message && (
        <div className={`p-4 rounded-lg ${message.includes("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {message}
        </div>
      )}
      
      {/* Run Selection Panel */}
      {activePanel === "select" && (
        <div className="rounded-2xl border bg-white shadow-sm">
          <div className="px-5 py-4 border-b">
            <h2 className="font-semibold text-gray-900">Select Line Run</h2>
            <p className="text-sm text-gray-600">
              Choose a saved production run to view and edit
            </p>
          </div>
          
          <div className="p-5">
            {lineRuns.length === 0 ? (
              <div className="text-center py-8 text-gray-600">
                No saved runs found. Save a run from the planner first.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {lineRuns.map(run => (
                  <div 
                    key={run.id}
                    onClick={() => handleSelectRun(run.id)}
                    className="rounded-xl border border-gray-200 p-4 hover:border-gray-300 hover:bg-gray-50 cursor-pointer transition"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold text-gray-900">{run.line_no}</div>
                      <div className="text-xs text-gray-500">{new Date(run.run_date).toLocaleDateString()}</div>
                    </div>
                    <div className="text-sm text-gray-600 mb-1">Style: {run.style}</div>
                    <div className="text-sm text-gray-600 mb-1">Operators: {run.operators_count}</div>
                    <div className="text-sm text-gray-600">Target: {run.target_pcs} pcs</div>
                    <div className="mt-3 text-xs text-gray-500">
                      Created: {new Date(run.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Run Details View */}
      {activePanel !== "select" && runData && (
        <div className="space-y-6">
          {/* Run Info Header */}
          <div className="rounded-2xl border bg-white shadow-sm p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-semibold text-gray-900">
                    {runData.run.line_no} • {runData.run.style}
                  </h2>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-800">
                    {new Date(runData.run.run_date).toLocaleDateString()}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-sm text-gray-600">
                  <span>Operators: {runData.run.operators_count}</span>
                  <span>Working Hours: {runData.run.working_hours}</span>
                  <span>SAM: {runData.run.sam_minutes} min</span>
                  <span>Efficiency: {Math.round(runData.run.efficiency * 100)}%</span>
                </div>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => setActivePanel("summary")}
                  className={`rounded-xl px-4 py-2 text-sm font-medium border ${
                    activePanel === "summary"
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-800 border-gray-200 hover:border-gray-300"
                  }`}
                >
                  Summary
                </button>
                <button
                  onClick={() => setActivePanel("operations")}
                  className={`rounded-xl px-4 py-2 text-sm font-medium border ${
                    activePanel === "operations"
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-800 border-gray-200 hover:border-gray-300"
                  }`}
                >
                  Operations
                </button>
                <button
                  onClick={() => {
                    setActivePanel("select");
                    setSelectedRun(null);
                    setRunData(null);
                  }}
                  className="rounded-xl px-4 py-2 text-sm font-medium border border-gray-200 hover:bg-gray-50"
                >
                  Back to List
                </button>
              </div>
            </div>
          </div>
          
          {/* Meta Summary Panel */}
          {activePanel === "summary" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <MetaSummary 
                  header={{
                    line: runData.run.line_no,
                    date: runData.run.run_date,
                    style: runData.run.style,
                    operators: runData.run.operators_count.toString(),
                    workingHours: runData.run.working_hours.toString(),
                    sam: runData.run.sam_minutes.toString(),
                    efficiency: runData.run.efficiency
                  }}
                  target={parseFloat(runData.run.target_pcs)}
                  slots={getSlotsFromData()}
                />
              </div>
              
              {/* Operators List */}
              <div className="rounded-2xl border bg-white shadow-sm">
                <div className="px-5 py-4 border-b">
                  <h2 className="font-semibold text-gray-900">Assigned Operators</h2>
                  <p className="text-sm text-gray-600">
                    {runData.operators?.length || 0} operators assigned
                  </p>
                </div>
                
                <div className="p-5">
                  {runData.operators && runData.operators.length > 0 ? (
                    <div className="space-y-3">
                      {runData.operators.map(operator => (
                        <div key={operator.id} className="rounded-lg border border-gray-200 p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-semibold text-gray-900">
                              Operator {operator.operator_no}
                            </div>
                            <div className="text-sm text-gray-600">
                              {runData.operations
                                .find(op => op.operator.id === operator.id)
                                ?.operations.length || 0} operations
                            </div>
                          </div>
                          {operator.operator_name && (
                            <div className="text-sm text-gray-600 mb-3">
                              Name: {operator.operator_name}
                            </div>
                          )}
                          <button
                            onClick={() => setActivePanel("operations")}
                            className="text-sm text-blue-600 hover:text-blue-800"
                          >
                            View Operations →
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-600">
                      No operators assigned yet
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          
          {/* Operations Panel */}
          {activePanel === "operations" && (
            <div>
              <div className="mb-4 rounded-2xl border bg-white shadow-sm p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h2 className="font-semibold text-gray-900">Operations Management</h2>
                    <p className="text-sm text-gray-600">
                      View and update operator operations and hourly output
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Modified OperationPlanner for View/Edit mode */}
              <ViewEditOperationPlanner
                runId={selectedRun}
                target={parseFloat(runData.run.target_pcs)}
                slots={getSlotsFromData()}
                initialRows={getRowsFromData()}
                slotTargets={getSlotTargets()}
                cumulativeTargets={getCumulativeTargets()}
                onUpdateHourly={handleUpdateHourlyData}
                onAddOperation={handleAddOperation}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}