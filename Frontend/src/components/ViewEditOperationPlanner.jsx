import { useState, useEffect, useMemo } from "react";
import { safeNum, calcCapacityPerHourFromTimes } from "../utils/calc";
import HourlyGrid from "./HourlyGrid";

function normalizeNo(v) {
  const s = String(v ?? "").trim();
  return s === "" ? "" : s;
}

function sumStitchedForRow(row, slots) {
  let sum = 0;
  (slots || []).forEach((s) => {
    const v = Number(row.stitched?.[s.id]);
    if (Number.isFinite(v)) sum += v;
  });
  return sum;
}

function sumStitchedForRowAtSlot(row, slotId) {
  const v = Number(row.stitched?.[slotId]);
  return Number.isFinite(v) ? v : 0;
}

export default function ViewEditOperationPlanner({
  runId,
  target,
  slots,
  initialRows,
  slotTargets,
  cumulativeTargets,
  onUpdateHourly,
  onClose,
}) {
  const [rows, setRows] = useState(initialRows || []);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [searchText, setSearchText] = useState("");
  const [operatorFilterNo, setOperatorFilterNo] = useState("ALL");
  
  useEffect(() => {
    setRows(initialRows || []);
  }, [initialRows]);
  
  const computedRows = useMemo(() => {
    return rows.map(row => ({
      ...row,
      capPerOperator: row.capPerOperator || 0
    }));
  }, [rows]);
  
  // Operator No options for dropdown
  const operatorNoOptions = useMemo(() => {
    const set = new Set();
    computedRows.forEach(r => {
      const no = normalizeNo(r.operatorNo);
      if (no) set.add(no);
    });
    return Array.from(set).sort((a, b) => Number(a) - Number(b));
  }, [computedRows]);
  
  // Filter rows
  const visibleRows = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    
    return computedRows.filter(r => {
      const opNo = normalizeNo(r.operatorNo);
      const parentOk = operatorFilterNo === "ALL" ? true : opNo === operatorFilterNo;
      const searchOk = !q || 
        (r.operation || "").toLowerCase().includes(q) ||
        (r.operatorName || "").toLowerCase().includes(q) ||
        opNo.toLowerCase().includes(q);
      
      return parentOk && searchOk;
    });
  }, [computedRows, operatorFilterNo, searchText]);
  
  // Group by operator
  const groups = useMemo(() => {
    const map = new Map();
    visibleRows.forEach(r => {
      const no = normalizeNo(r.operatorNo) || "UNASSIGNED";
      if (!map.has(no)) map.set(no, []);
      map.get(no).push(r);
    });
    
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === "UNASSIGNED") return 1;
      if (b === "UNASSIGNED") return -1;
      return Number(a) - Number(b);
    });
    
    return keys.map(k => ({ operatorNo: k, rows: map.get(k) }));
  }, [visibleRows]);
  
  const updateRowStitched = (rowId, slotId, value) => {
    setRows(prev => prev.map(row => {
      if (row.id === rowId) {
        return {
          ...row,
          stitched: { ...row.stitched, [slotId]: value }
        };
      }
      return row;
    }));
  };
  
  const handleSaveHourlyUpdates = async () => {
    if (!runId) {
      setMessage("❌ No run selected");
      return;
    }
    
    if (computedRows.length === 0) {
      setMessage("❌ No operation data");
      return;
    }
    
    setSaving(true);
    setMessage("");
    
    try {
      await onUpdateHourly(computedRows);
      setMessage("✅ Hourly data saved successfully!");
    } catch (err) {
      setMessage(`❌ Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };
  
  const totalStitched = useMemo(() => {
    return computedRows.reduce((total, row) => {
      let rowTotal = 0;
      Object.values(row.stitched || {}).forEach(val => {
        if (val && !isNaN(val)) rowTotal += Number(val);
      });
      return total + rowTotal;
    }, 0);
  }, [computedRows]);
  
  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="px-5 py-4 border-b">
        <h2 className="font-semibold text-gray-900">Operations & Hourly Tracking</h2>
        <p className="text-sm text-gray-600">
          View and update hourly stitched quantities. Changes are saved separately.
        </p>
      </div>
      
      {/* Controls */}
      <div className="px-5 py-4 border-b bg-gray-50">
        <div className="flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="w-full sm:w-72">
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search operations..."
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none"
              />
            </div>
            
            <div className="w-full sm:w-60">
              <select
                value={operatorFilterNo}
                onChange={(e) => setOperatorFilterNo(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none"
              >
                <option value="ALL">All operators</option>
                {operatorNoOptions.map(no => (
                  <option key={no} value={no}>Operator {no}</option>
                ))}
              </select>
            </div>
            
            <button
              onClick={() => {
                setSearchText("");
                setOperatorFilterNo("ALL");
              }}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50"
            >
              Reset Filters
            </button>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-600">
              Total Sewed: <span className="font-semibold">{totalStitched}</span>
            </div>
            <button
              onClick={handleSaveHourlyUpdates}
              disabled={saving}
              className="rounded-xl px-6 py-3 text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "💾 Save Hourly Updates"}
            </button>
          </div>
        </div>
        
        {message && (
          <div className={`mt-3 p-3 rounded-lg text-sm ${
            message.includes("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}>
            {message}
          </div>
        )}
      </div>
      
      {/* Operations Groups */}
      <div className="p-5 space-y-6">
        {groups.length === 0 ? (
          <div className="rounded-xl border bg-gray-50 p-8 text-center text-gray-600">
            No operations found.
          </div>
        ) : (
          groups.map(g => {
            const opNoLabel = g.operatorNo === "UNASSIGNED" ? "Unassigned" : `Operator ${g.operatorNo}`;
            
            // Calculate operator total across all operations
            const operatorTotal = g.rows.reduce((total, row) => total + sumStitchedForRow(row, slots), 0);
            
            // Calculate per-hour totals for this operator (sum across operations)
            const perHourTotals = (slots || []).map((s) =>
              g.rows.reduce((acc, r) => acc + sumStitchedForRowAtSlot(r, s.id), 0)
            );
            
            return (
              <div key={g.operatorNo} className="rounded-2xl border border-gray-200 overflow-hidden">
                {/* Operator Header - SIMPLIFIED to match image */}
                <div className="px-5 py-4 bg-gray-50 border-b">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-gray-900">{opNoLabel}</div>
                    <div className="text-sm text-gray-600">
                      Operator Name: {g.rows[0]?.operatorName || "Not specified"}
                    </div>
                  </div>
                  
                  <div className="text-sm text-gray-600 mb-3">
                    Total stitched (all operations): <span className="font-semibold">{operatorTotal}</span>
                  </div>
                  
                  {/* Per-hour totals for this operator - MATCHING IMAGE FORMAT */}
                  {slots?.length > 0 && (
                    <div className="grid grid-cols-10 gap-1">
                      {slots.map((s, i) => (
                        <div
                          key={s.id}
                          className="text-center"
                        >
                          <div className="text-xs text-gray-500 font-medium mb-1">{s.label}</div>
                          <div className="text-sm font-semibold text-gray-900 bg-white rounded border px-1 py-0.5">
                            {perHourTotals[i]}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                {/* Operations List */}
                <div className="p-5 space-y-5">
                  {g.rows.map((row, idx) => (
                    <div key={row.id} className="rounded-xl border border-gray-200 overflow-hidden">
                      <div className="p-4 bg-white border-b">
                        <div className="flex items-center justify-between mb-4">
                          <div className="font-semibold text-gray-900">
                            {row.operation || `Operation ${idx + 1}`}
                          </div>
                          <div className="text-sm text-gray-600">
                            Capacity: {row.capPerOperator?.toFixed(2) || "0.00"}/hour
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                          <div>
                            <div className="text-gray-500">t1</div>
                            <div className="font-medium">{row.t1 || "-"} sec</div>
                          </div>
                          <div>
                            <div className="text-gray-500">t2</div>
                            <div className="font-medium">{row.t2 || "-"} sec</div>
                          </div>
                          <div>
                            <div className="text-gray-500">t3</div>
                            <div className="font-medium">{row.t3 || "-"} sec</div>
                          </div>
                          <div>
                            <div className="text-gray-500">t4</div>
                            <div className="font-medium">{row.t4 || "-"} sec</div>
                          </div>
                          <div>
                            <div className="text-gray-500">t5</div>
                            <div className="font-medium">{row.t5 || "-"} sec</div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Hourly Grid for this operation */}
                      <div className="p-4">
                        <HourlyGrid
                          target={target}
                          slots={slots}
                          stitched={row.stitched}
                          onChangeStitched={(slotId, value) => 
                            updateRowStitched(row.id, slotId, value)
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}