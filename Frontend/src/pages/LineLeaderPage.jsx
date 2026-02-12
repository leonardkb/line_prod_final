import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import MetaSummary from "../components/MetaSummary";
import NavBarline from "../components/NavBarline";

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRole(role) {
  return String(role || "").toLowerCase().trim().replace(/[\s_-]/g, "");
}

/**
 * Alarm Notification Component (without pause button)
 */
function AlarmNotification({ visible, onDismiss, onSnooze, lastSavedTime }) {
  if (!visible) return null;

  return (
    <div className="fixed top-4 right-4 z-50 animate-fade-in">
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-lg max-w-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <span className="text-lg">⏰</span>
            </div>
            <div>
              <div className="text-sm font-semibold text-red-800">Time to Update Data!</div>
              <div className="mt-1 text-xs text-red-600">
                Please update your hourly production data.
                {lastSavedTime && (
                  <span className="block mt-1">
                    Last saved: {new Date(lastSavedTime).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="text-red-400 hover:text-red-600"
          >
            ✕
          </button>
        </div>
        
       
      </div>
    </div>
  );
}

/**
 * Alarm Status Indicator
 */
function AlarmStatusIndicator({ isActive, isPaused, nextAlarmTime }) {
  const getStatusColor = () => {
    if (isPaused) return "bg-gray-500";
    if (isActive) return "bg-green-500 animate-pulse";
    return "bg-yellow-500";
  };

  const getStatusText = () => {
    if (isPaused) return "Alarm Paused";
    if (isActive) return "Alarm Active";
    return "Waiting";
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`h-3 w-3 rounded-full ${getStatusColor()}`} />
      <span className="text-xs text-gray-600">{getStatusText()}</span>
      {nextAlarmTime && !isPaused && (
        <span className="text-xs text-gray-500">
          Next: {nextAlarmTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  );
}

/**
 * Hourly Plan UI exactly like your screenshot:
 * Row / Slot Hours / Slot Target / Cum Target / Sewed (input) / Cum Sewed
 * + Total Sewed box + Tip.
 */
function HourlyPlanCard({
  slots, // [{slot_label, planned_hours}]
  slotTargetsMap, // { [slot_label]: {slot_target, cumulative_target} }
  sewedBySlot, // { [slot_label]: string|number } - SPECIFIC to selected operation
  onChangeSewed, // (slotLabel, nextValue) => void
  operationName = "", // Add operation name for context
}) {
  const totalSewed = useMemo(() => {
    let sum = 0;
    for (const s of slots) sum += safeNum(sewedBySlot?.[s.slot_label]);
    return sum;
  }, [slots, sewedBySlot]);

  const cumSewed = useMemo(() => {
    let running = 0;
    const out = {};
    for (const s of slots) {
      running += safeNum(sewedBySlot?.[s.slot_label]);
      out[s.slot_label] = running;
    }
    return out;
  }, [slots, sewedBySlot]);

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">Hourly Plan</div>
          <div className="mt-1 text-xs text-gray-600">
            {operationName && (
              <span className="font-medium text-gray-900">Operation: {operationName}</span>
            )}
            <br />
            Slot target = (Target / WorkingHours) × SlotHours.
            <br />
            Cumulative target stops at final meta.
          </div>
        </div>

        <div className="rounded-2xl border bg-white px-4 py-3 text-center">
          <div className="text-xs text-gray-500">Total Sewed</div>
          <div className="text-lg font-semibold text-gray-900">{totalSewed}</div>
        </div>
      </div>

      <div className="mt-4 border-t pt-4 overflow-x-auto">
        <table className="min-w-[620px] w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-700 border-y border-gray-200 border-r border-gray-200 rounded-tl-xl after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-gray-200">
                Row
              </th>
              {slots.map((s, i) => (
                <th
                  key={s.slot_label}
                  className={`
                    bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-700 
                    border-y border-gray-200 border-r border-gray-200 whitespace-nowrap
                    ${i === slots.length - 1 ? 'border-r-0 rounded-tr-xl' : ''}
                  `}
                >
                  {s.slot_label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            <HourlyRow
              label="Slot Hours"
              slots={slots}
              renderCell={(slot) => safeNum(slot.planned_hours).toFixed(2)}
            />

            <HourlyRow
              label="Slot Target"
              slots={slots}
              renderCell={(slot) =>
                safeNum(slotTargetsMap?.[slot.slot_label]?.slot_target).toFixed(2)
              }
            />

            <HourlyRow
              label="Cum Target"
              slots={slots}
              renderCell={(slot) =>
                safeNum(slotTargetsMap?.[slot.slot_label]?.cumulative_target).toFixed(2)
              }
            />

            <tr>
              <td className="sticky left-0 z-10 px-3 py-3 text-sm font-semibold text-gray-900 border-b border-gray-200 border-r border-gray-200 bg-white after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-gray-200">
                Sewed (input)
              </td>
              {slots.map((slot, idx) => {
                const label = slot.slot_label;
                const v = sewedBySlot?.[label] ?? "";
                return (
                  <td
                    key={label}
                    className={`
                      px-3 py-3 border-b border-gray-200 border-r border-gray-200 bg-white
                      ${idx === slots.length - 1 ? 'border-r-0' : ''}
                    `}
                  >
                    <input
                      value={v}
                      onChange={(e) => onChangeSewed(label, e.target.value)}
                      placeholder="0"
                      inputMode="numeric"
                      className="w-28 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm
                                 outline-none focus:ring-2 focus:ring-gray-900/10"
                    />
                  </td>
                );
              })}
            </tr>

            <HourlyRow
              label="Cum Sewed"
              slots={slots}
              renderCell={(slot) => String(safeNum(cumSewed?.[slot.slot_label] ?? 0))}
              strong
              last
            />
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-gray-500">
        Tip: This table scrolls horizontally on mobile. It&apos;s responsive.
      </div>
    </div>
  );
}

function HourlyRow({ label, slots, renderCell, strong = false, last = false }) {
  return (
    <tr>
      <td
        className={`
          sticky left-0 z-10 px-3 py-3 text-sm font-semibold text-gray-900 bg-white 
          border-b border-gray-200 border-r border-gray-200
          after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-gray-200
          ${last ? 'rounded-bl-xl' : ''}
        `}
      >
        {label}
      </td>
      {slots.map((slot, idx) => (
        <td
          key={slot.slot_label}
          className={`
            px-3 py-3 text-sm bg-white border-b border-gray-200 border-r border-gray-200 whitespace-nowrap
            ${strong ? 'font-semibold text-gray-900' : 'text-gray-800'}
            ${last && idx === slots.length - 1 ? 'rounded-br-xl' : ''}
            ${idx === slots.length - 1 ? 'border-r-0' : ''}
          `}
        >
          {renderCell(slot)}
        </td>
      ))}
    </tr>
  );
}

export default function LineLeaderPage() {
  const navigate = useNavigate();

  const [tab, setTab] = useState("summary"); // "summary" | "operations"
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Alarm System State
  const [alarmVisible, setAlarmVisible] = useState(false);
  const [alarmPaused, setAlarmPaused] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState(null);
  const [nextAlarmTime, setNextAlarmTime] = useState(null);
  const [alarmInterval, setAlarmInterval] = useState(20); // 20 minutes default
  const [snoozeUntil, setSnoozeUntil] = useState(null);
  const alarmSoundRef = useRef(null);
  const alarmTimerRef = useRef(null);

  const [latest, setLatest] = useState(null); // { run, slots }
  const [runData, setRunData] = useState(null); // { run, slots, operators, operations, slotTargets }

  // sewedInputs[operationId][slotLabel] = value
  const [sewedInputs, setSewedInputs] = useState({});

  // Filters
  const [search, setSearch] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("all");

  // Operator panel toggles + which operation HourlyPlan writes to
  const [openOperatorIds, setOpenOperatorIds] = useState({});
  const [applyOpByOperatorId, setApplyOpByOperatorId] = useState({}); // operatorId -> operationId

  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  }, []);

  // Initialize alarm sound
  useEffect(() => {
    alarmSoundRef.current = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=");
    // Create a simple beep sound
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.5);
    
    return () => {
      if (alarmTimerRef.current) {
        clearTimeout(alarmTimerRef.current);
      }
      audioContext.close();
    };
  }, []);

  // Alarm system effect
  useEffect(() => {
    const setupAlarm = () => {
      if (alarmTimerRef.current) {
        clearTimeout(alarmTimerRef.current);
      }

      if (alarmPaused || snoozeUntil > Date.now()) {
        return;
      }

      const intervalMs = alarmInterval * 60 * 1000; // Convert minutes to milliseconds
      const nextTime = new Date(Date.now() + intervalMs);
      setNextAlarmTime(nextTime);

      alarmTimerRef.current = setTimeout(() => {
        if (!alarmPaused && snoozeUntil < Date.now()) {
          setAlarmVisible(true);
          // Play alarm sound
          try {
            alarmSoundRef.current.play();
          } catch (e) {
            console.log("Alarm sound failed:", e);
          }
        }
        setupAlarm(); // Schedule next alarm
      }, intervalMs);
    };

    setupAlarm();

    return () => {
      if (alarmTimerRef.current) {
        clearTimeout(alarmTimerRef.current);
      }
    };
  }, [alarmInterval, alarmPaused, snoozeUntil]);

  // Check snooze status periodically
  useEffect(() => {
    const snoozeCheck = setInterval(() => {
      if (snoozeUntil && Date.now() > snoozeUntil) {
        setSnoozeUntil(null);
      }
    }, 60000); // Check every minute

    return () => clearInterval(snoozeCheck);
  }, [snoozeUntil]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token || !user) return navigate("/", { replace: true });

    if (normalizeRole(user.role) !== "lineleader") {
      return navigate("/planner", { replace: true });
    }

    const lineNo = user.line_number;
    if (!lineNo) {
      setErrMsg("No line assigned to this user. Please contact admin.");
      setLoading(false);
      return;
    }

    fetchLatestRun(lineNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Alarm handlers
  const handleDismissAlarm = () => {
    setAlarmVisible(false);
    // Reset alarm timer
    if (alarmTimerRef.current) {
      clearTimeout(alarmTimerRef.current);
    }
    const intervalMs = alarmInterval * 60 * 1000;
    alarmTimerRef.current = setTimeout(() => {
      setAlarmVisible(true);
    }, intervalMs);
  };

  const handleSnoozeAlarm = () => {
    setAlarmVisible(false);
    setSnoozeUntil(Date.now() + (10 * 60 * 1000)); // Snooze for 10 minutes
  };

  const handleTogglePauseAlarm = () => {
    setAlarmPaused(!alarmPaused);
    if (!alarmPaused) {
      setAlarmVisible(false);
    }
  };

  // Update last saved time when data is saved
  const updateLastSavedTime = () => {
    setLastSavedTime(new Date());
    localStorage.setItem('lineLeader_lastSaved', new Date().toISOString());
  };

  // Check for existing last saved time on mount
  useEffect(() => {
    const saved = localStorage.getItem('lineLeader_lastSaved');
    if (saved) {
      setLastSavedTime(new Date(saved));
    }
  }, []);

  async function fetchLatestRun(lineNo) {
    setLoading(true);
    setErrMsg("");
    setSaveMsg("");

    try {
      const res = await fetch(
        `http://localhost:5000/api/lineleader/latest-run?line=${encodeURIComponent(
          lineNo
        )}`
      );
      const json = await res.json();

      if (!json.success) {
        setErrMsg(json.error || "Failed to load run for your line.");
        setLatest(null);
        setRunData(null);
        return;
      }

      setLatest(json);

      if (json?.run?.id) {
        await fetchRunData(json.run.id);
      } else {
        setErrMsg("Latest run found but missing run id.");
      }
    } catch (e) {
      setErrMsg(e.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function fetchRunData(runId) {
    try {
      const res = await fetch(`http://localhost:5000/api/get-run-data/${runId}`);
      const json = await res.json();

      if (!json.success) {
        setErrMsg(json.error || "Failed to load run details.");
        setRunData(null);
        return;
      }

      setRunData(json);

      // Initialize inputs from DB sewed_data
      const next = {};
      for (const block of json.operations || []) {
        for (const op of block.operations || []) {
          const opId = op.id;
          const sewed = op.sewed_data || {};
          next[opId] = {};
          for (const s of json.slots || []) {
            const label = s.slot_label;
            next[opId][label] = sewed?.[label] ?? "";
          }
        }
      }
      setSewedInputs(next);

      // Open first operator and set default "apply operation" for each operator
      const openInit = {};
      const applyInit = {};
      for (let i = 0; i < (json.operations || []).length; i++) {
        const block = json.operations[i];
        const operatorId = block.operator?.id;
        const firstOpId = block.operations?.[0]?.id;
        if (operatorId) {
          if (i === 0) openInit[operatorId] = true;
          if (firstOpId) applyInit[operatorId] = firstOpId;
        }
      }
      setOpenOperatorIds((prev) => ({ ...openInit, ...prev }));
      setApplyOpByOperatorId((prev) => ({ ...applyInit, ...prev }));
    } catch (e) {
      setErrMsg(e.message || "Network error loading run details");
    }
  }

  // ----- MetaSummary props (keep unchanged) -----
  const header = useMemo(() => {
    const r = latest?.run;
    return {
      line: String(r?.line_no ?? ""),
      date: String(r?.run_date ?? ""),
      style: String(r?.style ?? ""),
      operators: String(r?.operators_count ?? ""),
      sam: String(r?.sam_minutes ?? ""),
      workingHours: String(r?.working_hours ?? ""),
      efficiency: Number(r?.efficiency ?? 0.7),
    };
  }, [latest]);

  const target = useMemo(() => Number(latest?.run?.target_pcs || 0), [latest]);

  const slotsForSummary = useMemo(() => {
    return (latest?.slots || []).map((s) => ({
      id: s.slot_label,
      label: s.slot_label,
      hours: Number(s.planned_hours || 0),
      startTime: s.slot_start,
      endTime: s.slot_end,
    }));
  }, [latest]);

  // ops view data
  const slots = useMemo(() => runData?.slots || [], [runData]);

  const slotTargetsMap = useMemo(() => {
    const map = {};
    for (const row of runData?.slotTargets || []) {
      map[row.slot_label] = {
        slot_target: safeNum(row.slot_target),
        cumulative_target: safeNum(row.cumulative_target),
      };
    }
    return map;
  }, [runData]);

  const operatorsList = useMemo(() => runData?.operators || [], [runData]);

  const quickAccess = useMemo(() => {
    return (operatorsList || []).map((o) => ({
      operatorNo: o.operator_no,
      operatorName: o.operator_name || "",
    }));
  }, [operatorsList]);

  // Filter blocks by operator + search
  const operationsBlocks = useMemo(() => {
    const blocks = runData?.operations || [];

    const filteredByOperator =
      operatorFilter === "all"
        ? blocks
        : blocks.filter(
            (b) => String(b.operator?.operator_no) === String(operatorFilter)
          );

    const q = search.trim().toLowerCase();
    if (!q) return filteredByOperator;

    return filteredByOperator
      .map((b) => {
        const ops = (b.operations || []).filter((op) =>
          String(op.operation_name || "").toLowerCase().includes(q)
        );
        return { ...b, operations: ops };
      })
      .filter((b) => (b.operations || []).length > 0);
  }, [runData, operatorFilter, search]);

  function setSewed(opId, slotLabel, value) {
    setSewedInputs((prev) => ({
      ...prev,
      [opId]: {
        ...(prev[opId] || {}),
        [slotLabel]: value,
      },
    }));
  }

  function resetFilters() {
    setSearch("");
    setOperatorFilter("all");
  }

  function toggleOperator(operatorId) {
    setOpenOperatorIds((prev) => ({
      ...prev,
      [operatorId]: !prev[operatorId],
    }));
  }

  // Total sewed across ALL operations
  const totalSewed = useMemo(() => {
    let sum = 0;
    for (const opId of Object.keys(sewedInputs || {})) {
      const bySlot = sewedInputs[opId] || {};
      for (const sl of Object.keys(bySlot)) sum += safeNum(bySlot[sl]);
    }
    return sum;
  }, [sewedInputs]);

  // Helper to get selected operation's data
  const getSelectedOperationData = useMemo(() => {
    return (block) => {
      const applyOpId = applyOpByOperatorId[block.operator?.id];
      if (!applyOpId) return null;
      
      return block.operations?.find(op => op.id === applyOpId) || null;
    };
  }, [applyOpByOperatorId]);

  // Helper to get sewed data for specific operation
  const getOperationSewedData = useMemo(() => {
    return (opId) => {
      if (!opId) return {};
      return sewedInputs[opId] || {};
    };
  }, [sewedInputs]);


  

  async function handleSave() {
    if (!runData?.run?.id) return;

    setSaving(true);
    setSaveMsg("");
    setErrMsg("");

    try {
      const runId = runData.run.id;

      const entries = [];
      for (const block of runData.operations || []) {
        const operatorNo = block.operator?.operator_no;

        for (const op of block.operations || []) {
          const opId = op.id;
          const opName = op.operation_name;

          for (const s of slots) {
            const slotLabel = s.slot_label;
            const raw = sewedInputs?.[opId]?.[slotLabel];
            const qty = raw === "" ? 0 : safeNum(raw);

            entries.push({ operatorNo, operationName: opName, slotLabel, sewedQty: qty });
          }
        }
      }

      const res = await fetch(
        `http://localhost:5000/api/lineleader/update-sewed/${runId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries }),
        }
      );

      const json = await res.json();
      if (!json.success) {
        setErrMsg(json.error || "Failed to save sewed data.");
        return;
      }

      // Update last saved time and dismiss alarm
      updateLastSavedTime();
      setAlarmVisible(false);
      
      setSaveMsg("✅ Saved hourly updates");
      await fetchRunData(runId);
    } catch (e) {
      setErrMsg(e.message || "Network error while saving");
    } finally {
      setSaving(false);
    }
  }

  // Calculate total for an operation (for display)
  const getOperationTotal = useMemo(() => {
    return (opId) => {
      if (!opId) return 0;
      let sum = 0;
      const data = sewedInputs[opId] || {};
      for (const slotLabel of Object.keys(data)) {
        sum += safeNum(data[slotLabel]);
      }
      return sum;
    };
  }, [sewedInputs]);

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBarline />

      {/* Alarm Notification */}
      <AlarmNotification
        visible={alarmVisible}
        onDismiss={handleDismissAlarm}
        onSnooze={handleSnoozeAlarm}
        lastSavedTime={lastSavedTime}
      />

      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        {/* Top meta card like screenshot */}
        <div className="rounded-3xl border bg-white shadow-sm p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xl font-semibold text-gray-900">
                {header.line} • {header.style || "Run"}
                <span className="ml-3 inline-flex items-center rounded-full border bg-gray-50 px-3 py-1 text-sm text-gray-700">
                  {header.date || ""}
                </span>
              </div>

              <div className="mt-2 text-sm text-gray-700">
                Operators: {header.operators} &nbsp;&nbsp; Working Hours: {header.workingHours}
                &nbsp;&nbsp; SAM: {header.sam} min
              </div>
              <div className="mt-1 text-sm text-gray-700">
                Efficiency: {Math.round(safeNum(header.efficiency) * 100)}%
              </div>
              <div className="mt-1 text-sm text-gray-700">
                Total Sewed: {totalSewed} 
              </div>

              
              
              {/* Alarm Status */}
              <div className="mt-2">
                <AlarmStatusIndicator 
                  isActive={!alarmPaused && !snoozeUntil}
                  isPaused={alarmPaused}
                  nextAlarmTime={nextAlarmTime}
                />
              </div>
            </div>

            <div className="flex flex-col items-end gap-3">
              <div className="flex gap-3">
                <button
                  onClick={() => setTab("summary")}
                  className={
                    tab === "summary"
                      ? "rounded-xl bg-gray-900 text-white px-5 py-2 text-sm font-semibold"
                      : "rounded-xl border bg-white px-5 py-2 text-sm font-semibold text-gray-900"
                  }
                >
                  Summary
                </button>
                <button
                  onClick={() => setTab("operations")}
                  className={
                    tab === "operations"
                      ? "rounded-xl bg-gray-900 text-white px-5 py-2 text-sm font-semibold"
                      : "rounded-xl border bg-white px-5 py-2 text-sm font-semibold text-gray-900"
                  }
                >
                  Operations
                </button>
              </div>
              
              {/* Last saved indicator */}
              {lastSavedTime && (
                <div className="text-xs text-gray-500">
                  Last saved: {new Date(lastSavedTime).toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>
        </div>

        {saveMsg ? (
          <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            {saveMsg}
          </div>
        ) : null}

        <div className="mt-4">
          {loading ? (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">Loading…</div>
          ) : errMsg ? (
            <div className="rounded-2xl border bg-white p-5 shadow-sm text-red-600">
              {errMsg}
            </div>
          ) : tab === "summary" ? (
            <MetaSummary header={header} target={target} slots={slotsForSummary} />
          ) : (
            <>
              {/* Operations & Hourly Tracking */}
              <div className="mt-4 rounded-3xl border bg-white shadow-sm p-6">
                <div className="text-lg font-semibold text-gray-900">
                  Operations & Hourly Tracking
                </div>
                <div className="mt-1 text-sm text-gray-600">
                  View and update hourly sewed quantities. Changes are saved separately.
                </div>

                {/* Filters */}
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search operations..."
                    className="rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                  />

                  <select
                    value={operatorFilter}
                    onChange={(e) => setOperatorFilter(e.target.value)}
                    className="rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                  >
                    <option value="all">All operators</option>
                    {operatorsList.map((o) => (
                      <option key={o.id} value={String(o.operator_no)}>
                        Operator {o.operator_no}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={resetFilters}
                    className="rounded-xl border bg-white px-4 py-3 text-sm font-semibold hover:bg-gray-50"
                  >
                    Reset Filters
                  </button>
                </div>

                {/* Alarm Control Buttons - Added here instead of separate section */}
                {/* <div className="mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Alarm Interval:</span>
                    <select
                      value={alarmInterval}
                      onChange={(e) => setAlarmInterval(Number(e.target.value))}
                      className="rounded-xl border px-3 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-900/10"
                    >
                      <option value="15">15 min</option>
                      <option value="20">20 min</option>
                      <option value="30">30 min</option>
                      <option value="60">60 min</option>
                    </select>
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={handleTogglePauseAlarm}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                        alarmPaused
                          ? "bg-green-600 text-white hover:bg-green-700"
                          : "bg-yellow-100 text-yellow-800 hover:bg-yellow-200"
                      }`}
                    >
                      {alarmPaused ? "▶ Resume Alarm" : "⏸ Pause Alarm"}
                    </button>
                  </div>
                </div> */}

                {/* Total + Save button row */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-gray-700">
                    Total Sewed: <span className="font-semibold">{totalSewed}</span>
                  </div>

                  <div className="flex gap-2">
                    {alarmVisible && (
                      <button
                        onClick={handleDismissAlarm}
                        className="rounded-xl bg-red-100 text-red-700 px-4 py-2 text-sm font-semibold hover:bg-red-200"
                      >
                        ⏰ Dismiss Alarm
                      </button>
                    )}
                    
                    <button
                      onClick={handleSave}
                      disabled={saving || !runData}
                      className="rounded-xl bg-green-600 text-white px-6 py-3 text-sm font-semibold
                                 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saving ? "Saving..." : "💾 Save Hourly Updates"}
                    </button>
                  </div>
                </div>

                {/* Quick Tips */}
                {alarmVisible && (
                  <div className="mt-4 rounded-2xl border border-orange-200 bg-orange-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-orange-800">
                      ⚡ REMINDER: Time to update your production data!
                    </div>
                    <div className="mt-1 text-xs text-orange-600">
                      Please enter the latest sewed quantities and click "Save Hourly Updates"
                    </div>
                  </div>
                )}

                {/* Operator sections with Show/Hide + Hourly Plan inside */}
                <div className="mt-6 space-y-4">
                  {operationsBlocks.map((block) => {
                    const operatorId = block.operator?.id;
                    const operatorNo = block.operator?.operator_no;
                    const operatorName = block.operator?.operator_name || "";
                    const isOpen = !!openOperatorIds[operatorId];

                    const selectedOperation = getSelectedOperationData(block);
                    const selectedOperationId = selectedOperation?.id;
                    const selectedOperationName = selectedOperation?.operation_name || "";
                    
                    // Get sewed data for the SELECTED operation only
                    const selectedOperationSewedData = getOperationSewedData(selectedOperationId);
                    const selectedOperationTotal = getOperationTotal(selectedOperationId);

                    // Calculate total for all operations of this operator
                    const operatorTotal = block.operations?.reduce((sum, op) => {
                      return sum + getOperationTotal(op.id);
                    }, 0) || 0;

                    return (
                      <div
                        key={operatorId}
                        id={`operator-${operatorNo}`}
                        className="rounded-3xl border bg-white shadow-sm"
                      >
                        {/* Header */}
                        <div className="p-5 flex items-start justify-between gap-4">
                          <div>
                            <div className="text-lg font-semibold text-gray-900">
                              Operator {operatorNo}
                            </div>
                            <div className="text-sm text-gray-600">
                              Operator Name:{" "}
                              <span className="font-medium">{operatorName || "-"}</span>
                            </div>
                            <div className="mt-2 text-sm text-gray-700">
                              Total sewed (all operations):{" "}
                              <span className="font-semibold">{operatorTotal}</span>
                            </div>
                            {selectedOperation && (
                              <div className="mt-1 text-sm text-gray-700">
                                Selected operation total:{" "}
                                <span className="font-semibold text-blue-600">
                                  {selectedOperationTotal}
                                </span>
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => toggleOperator(operatorId)}
                            className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50"
                          >
                            {isOpen ? "Hide" : "Show"}
                          </button>
                        </div>

                        {isOpen ? (
                          <div className="px-5 pb-5 space-y-4">
                            {/* Apply-to operation selector */}
                            <div className="rounded-2xl border bg-gray-50 p-4">
                              <div className="text-sm font-semibold text-gray-900">
                                Apply Sewed Input To Operation
                              </div>
                              <div className="mt-2">
                                <select
                                  value={selectedOperationId || ""}
                                  onChange={(e) =>
                                    setApplyOpByOperatorId((prev) => ({
                                      ...prev,
                                      [operatorId]: Number(e.target.value),
                                    }))
                                  }
                                  className="w-full sm:w-[520px] rounded-xl border px-4 py-3 text-sm outline-none
                                             focus:ring-2 focus:ring-gray-900/10 bg-white"
                                >
                                  {(block.operations || []).map((op) => (
                                    <option key={op.id} value={op.id}>
                                      {op.operation_name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="mt-2 text-xs text-gray-600">
                                Hourly Plan below shows data for the selected operation only.
                              </div>
                            </div>

                            {/* Hourly Plan card for SELECTED operation */}
                            {selectedOperation && (
                              <HourlyPlanCard
                                slots={slots}
                                slotTargetsMap={slotTargetsMap}
                                sewedBySlot={selectedOperationSewedData}
                                onChangeSewed={(slotLabel, nextValue) => {
                                  if (!selectedOperationId) return;
                                  setSewed(selectedOperationId, slotLabel, nextValue);
                                }}
                                operationName={selectedOperationName}
                              />
                            )}

                            {/* Operations list */}
                            <div className="rounded-2xl border bg-gray-50 p-4">
                              <div className="text-sm font-semibold text-gray-900 mb-3">
                                All Operations for This Operator
                              </div>
                              <div className="space-y-2">
                                {(block.operations || []).map((op) => {
                                  const opTotal = getOperationTotal(op.id);
                                  const isSelected = op.id === selectedOperationId;
                                  
                                  return (
                                    <div
                                      key={op.id}
                                      className={`p-3 rounded-xl border ${
                                        isSelected 
                                          ? "border-blue-500 bg-blue-50" 
                                          : "border-gray-200 bg-white"
                                      }`}
                                      onClick={() => setApplyOpByOperatorId(prev => ({
                                        ...prev,
                                        [operatorId]: op.id
                                      }))}
                                    >
                                      <div className="flex justify-between items-center">
                                        <div>
                                          <div className="font-medium text-gray-900">
                                            {op.operation_name}
                                            {isSelected && (
                                              <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                                Selected
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-xs text-gray-600 mt-1">
                                            Capacity: {op.capacity_per_hour}/hr
                                          </div>
                                        </div>
                                        <div className="text-sm font-semibold text-gray-900">
                                          Total: {opTotal}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}