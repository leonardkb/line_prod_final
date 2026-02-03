import { useEffect, useMemo, useRef, useState } from "react";
import {
  safeNum,
  calcCapacityPerHourFromTimes,
  calcCapacityPerHourForMultipleOperations,
} from "../utils/calc";

function makeId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `row_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

function newRow(slots, operatorNo = "") {
  const id = makeId();
  const stitched = {};
  (slots || []).forEach((s) => (stitched[s.id] = "")); // kept for compatibility

  return {
    id,
    operatorNo: operatorNo ? String(operatorNo) : "",
    operatorName: "",
    operation: "",
    t1: "",
    t2: "",
    t3: "",
    t4: "",
    t5: "",
    stitched,
  };
}

function ensureRowHasAllSlotKeys(row, slots) {
  const next = { ...row, stitched: { ...(row.stitched || {}) } };
  (slots || []).forEach((s) => {
    if (!(s.id in next.stitched)) next.stitched[s.id] = "";
  });
  return next;
}

function normalizeNo(v) {
  const s = String(v ?? "").trim();
  return s === "" ? "" : s;
}

function Chip({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border transition",
        active
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-800 border-gray-200 hover:bg-gray-50",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export default function OperationPlanner({
  target,
  slots,
  selectedOperatorNo = "ALL",
  onOperatorNosChange,
  currentRunId,
}) {
  const [rows, setRows] = useState(() => [newRow(slots || [])]);

  // ✅ operator tabs state (chips)
  const [activeOperatorTab, setActiveOperatorTab] = useState("ALL");

  // ✅ accordion: which operator group is expanded
  // "ALL" => open all groups, "NONE" => collapse all, "UNASSIGNED"/"1"/"2" => open only that group
  const [expandedOperator, setExpandedOperator] = useState("ALL");

  const chipRefs = useRef({}); // { opNo: element }
  const groupRefs = useRef({}); // { opNo: element }

  const [savingOperations, setSavingOperations] = useState(false);
  const [saveOpsMessage, setSaveOpsMessage] = useState("");

  useEffect(() => {
    setRows((prev) => prev.map((r) => ensureRowHasAllSlotKeys(r, slots)));
  }, [slots]);

  // ✅ send operator numbers up (for parent quick buttons if needed)
  useEffect(() => {
    const nos = rows.map((r) => normalizeNo(r.operatorNo)).filter(Boolean);
    onOperatorNosChange?.(nos);
  }, [rows, onOperatorNosChange]);

  const hasReady = safeNum(target) > 0 && (slots?.length || 0) > 0;

  const computedRows = useMemo(() => {
    const rowsByOperator = {};
    rows.forEach((row) => {
      const operatorNo = normalizeNo(row.operatorNo);
      if (!operatorNo) return;
      if (!rowsByOperator[operatorNo]) rowsByOperator[operatorNo] = [];
      rowsByOperator[operatorNo].push(row);
    });

    return rows.map((row) => {
      const operatorNo = normalizeNo(row.operatorNo);
      let capPerOperator = 0;

      if (operatorNo && rowsByOperator[operatorNo]) {
        capPerOperator = calcCapacityPerHourForMultipleOperations(
          rowsByOperator[operatorNo]
        );
      } else {
        capPerOperator = calcCapacityPerHourFromTimes(
          row.t1,
          row.t2,
          row.t3,
          row.t4,
          row.t5
        );
      }

      return { ...row, capPerOperator };
    });
  }, [rows]);

  const operatorNoOptions = useMemo(() => {
    const set = new Set();
    computedRows.forEach((r) => {
      const no = normalizeNo(r.operatorNo);
      if (no) set.add(no);
    });
    return Array.from(set).sort((a, b) => Number(a) - Number(b));
  }, [computedRows]);

  // ✅ align chip state if parent passes selection
  useEffect(() => {
    if (selectedOperatorNo === "ALL") return;
    setActiveOperatorTab(String(selectedOperatorNo));
    setExpandedOperator(String(selectedOperatorNo));
  }, [selectedOperatorNo]);

  // ✅ scroll chip into view
  useEffect(() => {
    const el = chipRefs.current[String(activeOperatorTab)];
    if (el?.scrollIntoView) {
      el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [activeOperatorTab]);

  // ✅ when chip changes: open accordion + scroll group into view
  useEffect(() => {
    if (activeOperatorTab === "ALL") {
      setExpandedOperator("ALL");
      return;
    }
    setExpandedOperator(String(activeOperatorTab));

    requestAnimationFrame(() => {
      const el = groupRefs.current[String(activeOperatorTab)];
      if (el?.scrollIntoView) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, [activeOperatorTab]);

  // ✅ key fix: if operatorNo is edited while a section is open,
  // update expandedOperator/activeOperatorTab so the accordion does NOT close.
  const updateRow = (id, patch) => {
    setRows((prev) => {
      const rowBefore = prev.find((x) => x.id === id);
      const oldNo = normalizeNo(rowBefore?.operatorNo) || "UNASSIGNED";

      const next = prev.map((r) => {
        if (r.id !== id) return r;
        const merged = { ...r, ...patch };
        if ("operatorNo" in patch) merged.operatorNo = normalizeNo(patch.operatorNo);
        return ensureRowHasAllSlotKeys(merged, slots);
      });

      // if operatorNo changed, keep accordion open on the new operator group
      if ("operatorNo" in patch) {
        const newNo = normalizeNo(patch.operatorNo) || "UNASSIGNED";

        // Only adjust if the user is currently focused on the same group (avoid surprising jumps)
        setExpandedOperator((cur) => (cur === oldNo ? newNo : cur));
        setActiveOperatorTab((cur) => (cur === oldNo ? newNo : cur));
      }

      return next;
    });
  };

  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));

  const addOperationForOperator = (operatorNo) => {
    const opKey = operatorNo ? String(operatorNo) : "";
    setRows((prev) => [...prev, newRow(slots || [], opKey)]);

    // keep UI focused
    const nextKey = opKey ? opKey : "UNASSIGNED";
    setActiveOperatorTab(nextKey);
    setExpandedOperator(nextKey);
  };

  const addNewOperator = () => {
    setRows((prev) => [...prev, newRow(slots || [])]);
    setActiveOperatorTab("UNASSIGNED");
    setExpandedOperator("UNASSIGNED");
  };

  // ✅ rows visible for current tab (NO extra operator filter section)
  const visibleRows = useMemo(() => {
    return computedRows.filter((r) => {
      const opNo = normalizeNo(r.operatorNo) || "UNASSIGNED";
      return activeOperatorTab === "ALL" ? true : opNo === String(activeOperatorTab);
    });
  }, [computedRows, activeOperatorTab]);

  const groups = useMemo(() => {
    const map = new Map();
    visibleRows.forEach((r) => {
      const no = normalizeNo(r.operatorNo) || "UNASSIGNED";
      if (!map.has(no)) map.set(no, []);
      map.get(no).push(r);
    });

    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === "UNASSIGNED") return 1;
      if (b === "UNASSIGNED") return -1;
      return Number(a) - Number(b);
    });

    return keys.map((k) => ({ operatorNo: k, rows: map.get(k) }));
  }, [visibleRows]);

  // ✅ SAVE OPERATORS & OPERATIONS (Step 2 data)
  const handleSaveOperations = async () => {
    if (!currentRunId) {
      setSaveOpsMessage("❌ Please save Line Inputs (Step 1) first to get a Run ID");
      return;
    }
    if (computedRows.length === 0) {
      setSaveOpsMessage("❌ No operation data to save");
      return;
    }

    setSavingOperations(true);
    setSaveOpsMessage("");

    try {
      const wh = (slots || []).reduce((a, s) => a + safeNum(s.hours), 0);
      const t = safeNum(target);
      const targetPerHour = wh > 0 ? t / wh : 0;

      const slotTargets = (slots || []).map((s) =>
        Number((targetPerHour * safeNum(s.hours)).toFixed(2))
      );

      const cumulativeTargets = slotTargets.map((_, i) => {
        const cum = slotTargets.slice(0, i + 1).reduce((a, b) => a + b, 0);
        return Number(Math.min(t, cum).toFixed(2));
      });

      const operations = computedRows.map((row) => ({
        operatorNo: row.operatorNo,
        operatorName: row.operatorName,
        operation: row.operation,
        t1: row.t1,
        t2: row.t2,
        t3: row.t3,
        t4: row.t4,
        t5: row.t5,
        capacityPerHour: row.capPerOperator || 0,
      }));

      const payload = {
        runId: currentRunId,
        operations,
        slotTargets,
        cumulativeTargets,
      };

      const response = await fetch("http://localhost:5000/api/save-operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (data.success) {
        setSaveOpsMessage(
          `✅ Saved ${data.operationsCount || operations.length} operations! Slot targets saved.`
        );
      } else {
        setSaveOpsMessage(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      setSaveOpsMessage(`❌ Failed to save operations: ${err.message}`);
    } finally {
      setSavingOperations(false);
    }
  };

  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      {/* HEADER */}
      <div className="px-5 py-4 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900">Step 2 — Operators & Operations</h2>
          <p className="text-sm text-gray-600">
            Operator tabs + accordion sections (mobile friendly).
          </p>
        </div>

        <button
          onClick={addNewOperator}
          className="inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium
                     bg-gray-900 text-white hover:bg-gray-800 active:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!hasReady}
          title={!hasReady ? "Enter working hours + SAM + operators first" : "Add operator group"}
        >
          + Add Operator
        </button>
      </div>

      {!hasReady ? (
        <div className="p-5 text-sm text-gray-600">
          Please complete Step 1 (Operators, SAM, Working Hours). Then operations tracking will unlock.
        </div>
      ) : (
        <>
          {/* ✅ OPERATOR TABS */}
          <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
            <div className="px-5 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-gray-600">Operators</div>

                <button
                  onClick={() =>
                    addOperationForOperator(
                      activeOperatorTab === "ALL" ? "" : String(activeOperatorTab)
                    )
                  }
                  className="rounded-xl bg-gray-900 text-white px-3 py-2 text-sm font-medium
                             hover:bg-gray-800 active:bg-gray-900"
                  title="Add operation to current operator"
                >
                  + Add Operation
                </button>
              </div>

              <div
                className="mt-2 flex gap-2 overflow-x-auto pb-2 -mx-1 px-1"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                <span ref={(el) => (chipRefs.current["ALL"] = el)} className="shrink-0">
                  <Chip active={activeOperatorTab === "ALL"} onClick={() => setActiveOperatorTab("ALL")}>
                    All
                  </Chip>
                </span>

                {operatorNoOptions.map((no) => (
                  <span
                    key={no}
                    ref={(el) => (chipRefs.current[String(no)] = el)}
                    className="shrink-0"
                  >
                    <Chip
                      active={String(activeOperatorTab) === String(no)}
                      onClick={() => setActiveOperatorTab(String(no))}
                    >
                      {no}
                    </Chip>
                  </span>
                ))}

                {computedRows.some((r) => !normalizeNo(r.operatorNo)) ? (
                  <span ref={(el) => (chipRefs.current["UNASSIGNED"] = el)} className="shrink-0">
                    <Chip
                      active={activeOperatorTab === "UNASSIGNED"}
                      onClick={() => setActiveOperatorTab("UNASSIGNED")}
                    >
                      Unassigned
                    </Chip>
                  </span>
                ) : null}
              </div>

              <div className="text-[11px] text-gray-500">
                Tap operator → that section expands automatically (accordion).
              </div>
            </div>
          </div>

          {/* ✅ SAVE BUTTON (KEEP) */}
          <div className="px-5 py-4 border-b bg-gray-50">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">
                  Save Operators & Operations
                </div>
                <div className="text-xs text-gray-600">
                  Save operator details, operations, and hourly targets.
                  {!currentRunId && " (Save Step 1 first to get Run ID)"}
                </div>
              </div>

              <button
                onClick={handleSaveOperations}
                disabled={savingOperations || !currentRunId || computedRows.length === 0}
                className="inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-medium
                           bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800
                           disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {savingOperations ? "Saving..." : "💾 Save Step 2 Data"}
              </button>
            </div>

            {saveOpsMessage && (
              <div
                className={`mt-3 p-3 rounded-lg text-sm ${
                  saveOpsMessage.includes("✅")
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : saveOpsMessage.includes("⚠️")
                    ? "bg-yellow-50 text-yellow-700 border border-yellow-200"
                    : "bg-red-50 text-red-700 border border-red-200"
                }`}
              >
                {saveOpsMessage}
              </div>
            )}
          </div>

          {/* CONTENT (Accordion) */}
          <div className="p-5 space-y-4">
            {groups.length === 0 ? (
              <div className="rounded-xl border bg-gray-50 p-4 text-sm text-gray-700">
                No rows.
              </div>
            ) : (
              groups.map((g) => {
                const opKey = String(g.operatorNo);
                const opNoLabel =
                  opKey === "UNASSIGNED" ? "Unassigned" : `Operator ${opKey}`;

                const isOpen = expandedOperator === "ALL" || expandedOperator === opKey;

                return (
                  <div
                    key={opKey}
                    ref={(el) => (groupRefs.current[opKey] = el)}
                    className="rounded-2xl border border-gray-200 overflow-hidden"
                  >
                    {/* Header toggle */}
                    <button
                      type="button"
                      onClick={() => setExpandedOperator(isOpen ? "NONE" : opKey)}
                      className="w-full px-4 sm:px-5 py-4 bg-gray-50 border-b flex items-center justify-between text-left"
                    >
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{opNoLabel}</div>
                        <div className="text-xs text-gray-600">{g.rows.length} operation(s)</div>
                      </div>

                      <div className="text-sm font-medium text-gray-700">
                        {isOpen ? "Hide" : "Show"}
                      </div>
                    </button>

                    {isOpen ? (
                      <div className="p-4 sm:p-5 space-y-4">
                        <div className="flex items-center justify-end">
                          <button
                            onClick={() =>
                              addOperationForOperator(opKey === "UNASSIGNED" ? "" : opKey)
                            }
                            className="inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium
                                       bg-white border border-gray-200 hover:bg-gray-50 active:bg-gray-100"
                          >
                            + Add Operation
                          </button>
                        </div>

                        {g.rows.map((row, idx) => (
                          <div key={row.id} className="rounded-2xl border border-gray-200 overflow-hidden">
                            <div className="p-4 bg-white">
                              <div className="flex items-start justify-between gap-3">
                                <div className="text-sm font-semibold text-gray-900">
                                  Operation {idx + 1}
                                </div>
                                <button
                                  onClick={() => removeRow(row.id)}
                                  className="text-sm font-medium text-gray-700 hover:text-gray-900"
                                  disabled={rows.length === 1}
                                  title={rows.length === 1 ? "At least one row required" : "Remove operation row"}
                                >
                                  Remove
                                </button>
                              </div>

                              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                                <Field
                                  label="Operator No"
                                  placeholder="e.g., 1"
                                  value={row.operatorNo}
                                  onChange={(v) => updateRow(row.id, { operatorNo: v })}
                                />

                                <Field
                                  label="Operator Name (optional)"
                                  placeholder="e.g., Juan / Maria"
                                  value={row.operatorName}
                                  onChange={(v) => updateRow(row.id, { operatorName: v })}
                                />

                                <Field
                                  label="Operation"
                                  placeholder="e.g., Attach collar"
                                  value={row.operation}
                                  onChange={(v) => updateRow(row.id, { operation: v })}
                                />

                                <div className="rounded-xl border bg-gray-50 p-3">
                                  <div className="text-xs text-gray-500">Capacity / Hour</div>
                                  <div className="text-lg font-semibold text-gray-900">
                                    {row.capPerOperator ? row.capPerOperator.toFixed(2) : "0.00"}
                                  </div>
                                  <div className="text-xs text-gray-500">Per operator</div>
                                </div>
                              </div>

                              <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3">
                                <Field label="t1 (sec)" value={row.t1} onChange={(v) => updateRow(row.id, { t1: v })} />
                                <Field label="t2 (sec)" value={row.t2} onChange={(v) => updateRow(row.id, { t2: v })} />
                                <Field label="t3 (sec)" value={row.t3} onChange={(v) => updateRow(row.id, { t3: v })} />
                                <Field label="t4 (sec)" value={row.t4} onChange={(v) => updateRow(row.id, { t4: v })} />
                                <Field label="t5 (sec)" value={row.t5} onChange={(v) => updateRow(row.id, { t5: v })} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-gray-800 mb-1">{label}</div>
      <input
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm
                   outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300"
      />
    </label>
  );
}