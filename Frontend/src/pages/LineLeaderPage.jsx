import { useEffect, useMemo, useState, useRef, useCallback } from "react";
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
              <div className="text-sm font-semibold text-red-800">¡Hora de actualizar datos!</div>
              <div className="mt-1 text-xs text-red-600">
                Por favor actualiza tu producción por hora.
                {lastSavedTime && (
                  <span className="block mt-1">
                    Último guardado: {new Date(lastSavedTime).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button onClick={onDismiss} className="text-red-400 hover:text-red-600">
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
    if (isPaused) return "Alarma en pausa";
    if (isActive) return "Alarma activa";
    return "En espera";
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`h-3 w-3 rounded-full ${getStatusColor()}`} />
      <span className="text-xs text-gray-600">{getStatusText()}</span>
      {nextAlarmTime && !isPaused && (
        <span className="text-xs text-gray-500">
          Próxima: {nextAlarmTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
  slots,
  slotTargetsMap,
  sewedBySlot,
  onChangeSewed,
  operationName = "",
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
          <div className="text-sm font-semibold text-gray-900">Plan por hora</div>
          <div className="mt-1 text-xs text-gray-600">
            {operationName && (
              <span className="font-medium text-gray-900">Operación: {operationName}</span>
            )}
            <br />
            Objetivo por bloque = (Objetivo / Horas de trabajo) × Horas del bloque.
            <br />
            El objetivo acumulado se detiene en el último meta.
          </div>
        </div>

        
      </div>

      <div className="mt-4 border-t pt-4 overflow-x-auto">
        <table className="min-w-[620px] w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-700 border-y border-gray-200 border-r border-gray-200 rounded-tl-xl after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-gray-200">
                Fila
              </th>
              {slots.map((s, i) => (
                <th
                  key={s.slot_label}
                  className={`
                    bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-700 
                    border-y border-gray-200 border-r border-gray-200 whitespace-nowrap
                    ${i === slots.length - 1 ? "border-r-0 rounded-tr-xl" : ""}
                  `}
                >
                  {s.slot_label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            <HourlyRow
              label="Objetivo del bloque"
              slots={slots}
              renderCell={(slot) =>
                safeNum(slotTargetsMap?.[slot.slot_label]?.slot_target).toFixed(2)
              }
            />

            <HourlyRow
              label="Objetivo acumulado"
              slots={slots}
              renderCell={(slot) =>
                safeNum(slotTargetsMap?.[slot.slot_label]?.cumulative_target).toFixed(2)
              }
            />

            <tr>
              <td className="sticky left-0 z-10 px-3 py-3 text-sm
               font-semibold text-gray-900 border-b border-gray-200
                border-r border-gray-200 bg-white after:absolute 
                after:top-0 after:right-0 after:h-full after:w-px after:bg-gray-200">
                Cosido (entrada)
              </td>
              {slots.map((slot, idx) => {
                const label = slot.slot_label;
                const v = sewedBySlot?.[label] ?? "";
                return (
                  <td
                    key={label}
                    className={`
                      px-3 py-3 border-b border-gray-200 border-r border-gray-200 bg-white
                      ${idx === slots.length - 1 ? "border-r-0" : ""}
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
              label="Cosido acumulado"
              slots={slots}
              renderCell={(slot) => String(safeNum(cumSewed?.[slot.slot_label] ?? 0))}
              strong
              last
            />
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-gray-500">
        Tip: Esta tabla se desliza horizontalmente en móvil. Es responsiva.
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
          ${last ? "rounded-bl-xl" : ""}
        `}
      >
        {label}
      </td>
      {slots.map((slot, idx) => (
        <td
          key={slot.slot_label}
          className={`
            px-3 py-3 text-sm bg-white border-b border-gray-200 border-r border-gray-200 whitespace-nowrap
            ${strong ? "font-semibold text-gray-900" : "text-gray-800"}
            ${last && idx === slots.length - 1 ? "rounded-br-xl" : ""}
            ${idx === slots.length - 1 ? "border-r-0" : ""}
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
  const [alarmInterval, setAlarmInterval] = useState(20);
  const [snoozeUntil, setSnoozeUntil] = useState(null);
  const alarmSoundRef = useRef(null);
  const alarmTimerRef = useRef(null);

  const [latest, setLatest] = useState(null);
  const [runData, setRunData] = useState(null);
  const [sewedInputs, setSewedInputs] = useState({});

  // State for line balancing assignments
  const [assignments, setAssignments] = useState([]);

  // New state for time-based view
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null);

  // ========== NEW: Summary Banner States ==========
  const [realTimeTarget, setRealTimeTarget] = useState(0);
  const [realTimeProgress, setRealTimeProgress] = useState(0);
  const [overallEfficiency, setOverallEfficiency] = useState(0);
  const [targetAchievement, setTargetAchievement] = useState(0);
  const [realTimeEfficiency, setRealTimeEfficiency] = useState(0);
  // ================================================

  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  }, []);

  // Helper to get token from localStorage (always fresh)
  const getToken = () => localStorage.getItem("token");

  useEffect(() => {
    alarmSoundRef.current = new Audio(
      "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
    );
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = "sine";
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);

    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.5);

    return () => {
      if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
      audioContext.close();
    };
  }, []);

  useEffect(() => {
    const setupAlarm = () => {
      if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);

      if (alarmPaused || snoozeUntil > Date.now()) return;

      const intervalMs = alarmInterval * 60 * 1000;
      const nextTime = new Date(Date.now() + intervalMs);
      setNextAlarmTime(nextTime);

      alarmTimerRef.current = setTimeout(() => {
        if (!alarmPaused && snoozeUntil < Date.now()) {
          setAlarmVisible(true);
          try {
            alarmSoundRef.current.play();
          } catch (e) {
            console.log("Alarm sound failed:", e);
          }
        }
        setupAlarm();
      }, intervalMs);
    };

    setupAlarm();

    return () => {
      if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
    };
  }, [alarmInterval, alarmPaused, snoozeUntil]);

  useEffect(() => {
    const snoozeCheck = setInterval(() => {
      if (snoozeUntil && Date.now() > snoozeUntil) setSnoozeUntil(null);
    }, 60000);

    return () => clearInterval(snoozeCheck);
  }, [snoozeUntil]);

  useEffect(() => {
    const token = getToken();
    if (!token || !user) return navigate("/", { replace: true });

    if (normalizeRole(user.role) !== "lineleader") {
      return navigate("/planner", { replace: true });
    }

    const lineNo = user.line_number;
    if (!lineNo) {
      setErrMsg("No hay una línea asignada a este usuario. Por favor contacte al administrador.");
      setLoading(false);
      return;
    }

    fetchLatestRun(lineNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleDismissAlarm = () => {
    setAlarmVisible(false);
    if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
    const intervalMs = alarmInterval * 60 * 1000;
    alarmTimerRef.current = setTimeout(() => {
      setAlarmVisible(true);
    }, intervalMs);
  };

  const handleSnoozeAlarm = () => {
    setAlarmVisible(false);
    setSnoozeUntil(Date.now() + 10 * 60 * 1000);
  };

  const handleTogglePauseAlarm = () => {
    setAlarmPaused(!alarmPaused);
    if (!alarmPaused) setAlarmVisible(false);
  };

  const updateLastSavedTime = () => {
    setLastSavedTime(new Date());
    localStorage.setItem("lineLeader_lastSaved", new Date().toISOString());
  };

  useEffect(() => {
    const saved = localStorage.getItem("lineLeader_lastSaved");
    if (saved) setLastSavedTime(new Date(saved));
  }, []);

  async function fetchLatestRun(lineNo) {
    setLoading(true);
    setErrMsg("");
    setSaveMsg("");

    const token = getToken();
    if (!token) {
      setErrMsg("No estás autenticado. Por favor inicia sesión de nuevo.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(
        `http://localhost:5000/api/lineleader/latest-run?line=${encodeURIComponent(lineNo)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const json = await res.json();

      if (!json.success) {
        setErrMsg(json.error || "No se pudo cargar la corrida de tu línea.");
        setLatest(null);
        setRunData(null);
        return;
      }

      setLatest(json);

      if (json?.run?.id) {
        await fetchRunData(json.run.id);
        await fetchAssignments(json.run.id);
      } else {
        setErrMsg("Se encontró la última corrida pero falta el ID de la corrida.");
      }
    } catch (e) {
      setErrMsg(e.message || "Error de red");
    } finally {
      setLoading(false);
    }
  }

  async function fetchRunData(runId) {
    const token = getToken();
    if (!token) {
      setErrMsg("No estás autenticado. Por favor inicia sesión de nuevo.");
      return;
    }

    try {
      const res = await fetch(`http://localhost:5000/api/get-run-data/${runId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!json.success) {
        setErrMsg(json.error || "No se pudieron cargar los detalles de la corrida.");
        setRunData(null);
        return;
      }

      setRunData(json);

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

      // Auto-select first time slot
      if (json.slots?.length > 0) {
        setSelectedTimeSlot(json.slots[0].slot_label);
      }
    } catch (e) {
      setErrMsg(e.message || "Error de red al cargar los detalles de la corrida");
    }
  }

  // Fetch assignments for the current run
  async function fetchAssignments(runId) {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`http://localhost:5000/api/lineleader/assignments/${runId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) setAssignments(json.assignments);
    } catch (e) {
      console.error("Error fetching assignments:", e);
      // Don't show error to user; it's non‑critical
    }
  }

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

  // ========== SYNCHRONIZATION LOGIC ==========
  const operationToOperatorMap = useMemo(() => {
    const map = new Map();
    if (runData?.operations) {
      runData.operations.forEach(block => {
        const operatorId = block.operator?.id;
        if (operatorId) {
          block.operations?.forEach(op => map.set(op.id, operatorId));
        }
      });
    }
    return map;
  }, [runData]);

  const operatorToOperationIds = useMemo(() => {
    const map = new Map();
    if (runData?.operations) {
      runData.operations.forEach(block => {
        const operatorId = block.operator?.id;
        if (operatorId) {
          const opIds = block.operations?.map(op => op.id) || [];
          map.set(operatorId, opIds);
        }
      });
    }
    return map;
  }, [runData]);

  const handleSewedChange = useCallback((opId, slotLabel, value) => {
    setSewedInputs(prev => {
      const operatorId = operationToOperatorMap.get(opId);
      if (!operatorId) {
        return {
          ...prev,
          [opId]: {
            ...(prev[opId] || {}),
            [slotLabel]: value,
          },
        };
      }

      const affectedOpIds = operatorToOperationIds.get(operatorId) || [];
      const newState = { ...prev };
      affectedOpIds.forEach(id => {
        newState[id] = {
          ...(newState[id] || {}),
          [slotLabel]: value,
        };
      });
      return newState;
    });
  }, [operationToOperatorMap, operatorToOperationIds]);

  useEffect(() => {
    if (!runData || !operatorToOperationIds.size) return;

    setSewedInputs(prev => {
      let changed = false;
      const newState = { ...prev };
      for (const [operatorId, opIds] of operatorToOperationIds.entries()) {
        if (opIds.length <= 1) continue;
        const firstOpId = opIds[0];
        const firstOpData = prev[firstOpId] || {};
        opIds.slice(1).forEach(id => {
          if (JSON.stringify(prev[id]) !== JSON.stringify(firstOpData)) {
            newState[id] = { ...firstOpData };
            changed = true;
          }
        });
      }
      return changed ? newState : prev;
    });
  }, [runData, operatorToOperationIds]);

  // ========== Helper functions for time-based view ==========
  const handleTimeSlotChange = (operatorId, slotLabel, value) => {
    if (!operatorId || !slotLabel) return;
    
    const opIds = operatorToOperationIds.get(operatorId) || [];
    if (opIds.length === 0) return;
    
    // Use the first operation as the primary one for data entry
    const primaryOpId = opIds[0];
    handleSewedChange(primaryOpId, slotLabel, value);
  };

  const getOperatorValueForSlot = (operatorId, slotLabel) => {
    const opIds = operatorToOperationIds.get(operatorId) || [];
    if (opIds.length === 0) return '';
    
    const primaryOpId = opIds[0];
    return sewedInputs[primaryOpId]?.[slotLabel] || '';
  };

  // ========== TOTAL FOR ALL OPERATIONS ==========
  const allOperationsTotal = useMemo(() => {
    const operatorSeen = new Set();
    let total = 0;

    for (const [opId, opData] of Object.entries(sewedInputs)) {
      const operatorId = operationToOperatorMap.get(opId);
      if (!operatorId) {
        for (const slotLabel of Object.keys(opData)) {
          total += safeNum(opData[slotLabel]);
        }
      } else {
        if (!operatorSeen.has(operatorId)) {
          operatorSeen.add(operatorId);
          for (const slotLabel of Object.keys(opData)) {
            total += safeNum(opData[slotLabel]);
          }
        }
      }
    }
    return total;
  }, [sewedInputs, operationToOperatorMap]);

  // ========== FINISHED GARMENTS TOTAL (packing / empaque) ==========
  const finishedGarmentsTotal = useMemo(() => {
    if (!runData) return 0;
    let total = 0;
    const packingKeywords = ['pack', 'emp'];
    for (const block of runData.operations || []) {
      for (const op of block.operations || []) {
        const opName = (op.operation_name || '').toLowerCase();
        if (packingKeywords.some(keyword => opName.includes(keyword))) {
          const sewedData = op.sewed_data || {};
          for (const qty of Object.values(sewedData)) {
            total += safeNum(qty);
          }
        }
      }
    }
    return total;
  }, [runData]);

  const getOperationTotal = useMemo(() => {
    return (opId) => {
      if (!opId) return 0;
      let sum = 0;
      const data = sewedInputs[opId] || {};
      for (const slotLabel of Object.keys(data)) sum += safeNum(data[slotLabel]);
      return sum;
    };
  }, [sewedInputs]);

  async function handleSave() {
    if (!runData?.run?.id) return;

    const token = getToken();
    if (!token) {
      setErrMsg("No estás autenticado. Por favor inicia sesión de nuevo.");
      return;
    }

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

      const res = await fetch(`http://localhost:5000/api/lineleader/update-sewed/${runId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ entries }),
      });

      const json = await res.json();
      if (!json.success) {
        setErrMsg(json.error || "No se pudieron guardar los datos cosidos.");
        return;
      }

      updateLastSavedTime();
      setAlarmVisible(false);

      setSaveMsg("✅ Actualizaciones por hora guardadas");
      await fetchRunData(runId);
      await fetchAssignments(runId);
    } catch (e) {
      setErrMsg(e.message || "Error de red al guardar");
    } finally {
      setSaving(false);
    }
  }

  // ========== Real‑time target calculation ==========
  useEffect(() => {
    if (!runData || !slots.length || !slotTargetsMap || !target) return;

    const calculateRealtime = () => {
      const now = new Date();
      const dateStr = header.date ? header.date.split('T')[0] : new Date().toISOString().split('T')[0];

      const slotsWithTime = slots
        .map(slot => {
          if (!slot.slot_start || !slot.slot_end) return null;
          const start = new Date(`${dateStr}T${slot.slot_start}`);
          const end = new Date(`${dateStr}T${slot.slot_end}`);
          return { ...slot, start, end };
        })
        .filter(s => s !== null);

      let cumulative = 0;
      for (const slot of slotsWithTime) {
        const slotTarget = slotTargetsMap[slot.slot_label]?.slot_target || 0;
        if (now >= slot.end) {
          cumulative += Number(slotTarget);
        } else if (now >= slot.start && now < slot.end) {
          const elapsed = (now - slot.start) / (slot.end - slot.start);
          cumulative += Number(slotTarget) * elapsed;
          break;
        } else {
          break;
        }
      }
      setRealTimeTarget(Math.round(cumulative * 100) / 100);
      setRealTimeProgress(target > 0 ? (cumulative / target) * 100 : 0);
    };

    calculateRealtime();
    const interval = setInterval(calculateRealtime, 60000);
    return () => clearInterval(interval);
  }, [runData, slots, slotTargetsMap, target, header.date]);

  // ========== Compute efficiency, achievement, real‑time efficiency using finished garments ==========
  useEffect(() => {
    if (!runData || target === 0 || finishedGarmentsTotal === undefined) return;

    const operatorsCount = Number(header.operators) || 0;
    const workingHours = Number(header.workingHours) || 0;
    const sam = Number(header.sam) || 0;

    const availableMinutes = operatorsCount * workingHours * 60;
    const totalSAMOutput = finishedGarmentsTotal * sam;
    const eff = availableMinutes > 0 ? (totalSAMOutput / availableMinutes) * 100 : 0;
    setOverallEfficiency(Math.round(eff * 100) / 100);

    const ach = target > 0 ? (finishedGarmentsTotal / target) * 100 : 0;
    setTargetAchievement(Math.round(ach * 100) / 100);

    const rtEff = realTimeTarget > 0 ? (finishedGarmentsTotal / realTimeTarget) * 100 : 0;
    setRealTimeEfficiency(Math.round(rtEff * 100) / 100);
  }, [runData, target, finishedGarmentsTotal, header.operators, header.workingHours, header.sam, realTimeTarget]);

  // ========== Helper for status dots ==========
  const getStatusDot = (value, type) => {
    if (value === undefined || value === null) return 'bg-gray-400';
    if (type === 'efficiency') {
      if (value < 60) return 'bg-red-500';
      if (value < 80) return 'bg-yellow-500';
      return 'bg-green-500';
    }
    if (type === 'cumplimiento') {
      if (value < 70) return 'bg-red-500';
      if (value < 90) return 'bg-yellow-500';
      return 'bg-green-500';
    }
    if (type === 'realtimeEfficiency') {
      if (value < 60) return 'bg-red-500';
      if (value < 80) return 'bg-yellow-500';
      return 'bg-green-500';
    }
    return 'bg-gray-400';
  };
  // ============================================

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBarline />

      <AlarmNotification
        visible={alarmVisible}
        onDismiss={handleDismissAlarm}
        onSnooze={handleSnoozeAlarm}
        lastSavedTime={lastSavedTime}
      />

      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <div className="rounded-3xl border bg-white shadow-sm p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xl font-semibold text-gray-900">
                {header.line} • {header.style || "Corrida"}
                <span className="ml-3 inline-flex items-center rounded-full border
                 bg-gray-50 px-3 py-1 text-sm text-gray-700">
                  {header.date || ""}
                </span>
              </div>

              <div className="mt-2 text-sm text-gray-700">
                Operadores: {header.operators} &nbsp;&nbsp; Horas de trabajo: {header.workingHours}
                &nbsp;&nbsp; SAM: {header.sam} min
              </div>
              <div className="mt-1 text-sm text-gray-700">
                Eficiencia: {Math.round(safeNum(header.efficiency) * 100)}%
              </div>
              <div className="mt-1 text-sm text-gray-700">Total cosido: {finishedGarmentsTotal}</div>

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
                  Resumen
                </button>
                <button
                  onClick={() => setTab("operations")}
                  className={
                    tab === "operations"
                      ? "rounded-xl bg-gray-900 text-white px-5 py-2 text-sm font-semibold"
                      : "rounded-xl border bg-white px-5 py-2 text-sm font-semibold text-gray-900"
                  }
                >
                  Operaciones
                </button>
              </div>

              {lastSavedTime && (
                <div className="text-xs text-gray-500">
                  Último guardado: {new Date(lastSavedTime).toLocaleTimeString()}
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
            <div className="rounded-2xl border bg-white p-5 shadow-sm">Cargando…</div>
          ) : errMsg ? (
            <div className="rounded-2xl border bg-white p-5 shadow-sm text-red-600">
              {errMsg}
            </div>
          ) : tab === "summary" ? (
            <>
              {/* Summary Cards Banner */}
              {runData && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-5 mb-6">
                  {/* Objetivo Total */}
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">Objetivo Total</p>
                    <p className="text-3xl font-bold text-gray-900">{Math.round(target).toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-2">piezas</p>
                  </div>

                  {/* Total Cosido (finished garments) */}
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">Total Cosido</p>
                    <p className="text-3xl font-bold text-gray-900">{Math.round(finishedGarmentsTotal).toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-2">piezas terminadas</p>
                  </div>

                  {/* Eficiencia con indicador */}
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-3 h-3 rounded-full ${getStatusDot(overallEfficiency, 'efficiency')}`}></span>
                      <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Eficiencia</p>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{overallEfficiency.toFixed(1)}%</p>
                    <p className="text-xs text-gray-500 mt-2">basada en SAM</p>
                  </div>

                  {/* Cumplimiento con indicador */}
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-3 h-3 rounded-full ${getStatusDot(targetAchievement, 'cumplimiento')}`}></span>
                      <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Cumplimiento</p>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{targetAchievement.toFixed(1)}%</p>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                      <div
                        className="bg-gray-900 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(targetAchievement, 100)}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Meta en tiempo real */}
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">Meta en tiempo real</p>
                    <p className="text-3xl font-bold text-gray-900">
                      {realTimeTarget.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-gray-500 mt-2">piezas esperadas hasta ahora</p>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 mt-3">
                      <div
                        className="bg-blue-600 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(realTimeProgress, 100)}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{realTimeProgress.toFixed(1)}% del objetivo</p>
                  </div>

                  {/* Real‑time Efficiency con indicador */}
                  <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-3 h-3 rounded-full ${getStatusDot(realTimeEfficiency, 'realtimeEfficiency')}`}></span>
                      <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Real‑time Efficiency</p>
                    </div>
                    <p className="text-3xl font-bold text-gray-900">{realTimeEfficiency.toFixed(1)}%</p>
                    <p className="text-xs text-gray-500 mt-2">de la meta en tiempo real</p>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 mt-3">
                      <div
                        className="bg-purple-600 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(realTimeEfficiency, 100)}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {Math.round(finishedGarmentsTotal).toLocaleString()} /{' '}
                      {realTimeTarget.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} piezas
                    </p>
                  </div>
                </div>
              )}

              <MetaSummary header={header} target={target} slots={slotsForSummary} />
              {assignments.length > 0 && (
                <div className="mt-6 rounded-3xl border bg-white shadow-sm p-6">
                  <h2 className="text-lg font-semibold mb-4">Asignaciones de ayuda</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="px-4 py-2 text-left">Operador lento</th>
                          <th className="px-4 py-2 text-left">Operación</th>
                          <th className="px-4 py-2 text-left">Ayudado por</th>
                          <th className="px-4 py-2 text-left">Cantidad por hora</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assignments.map((a) => (
                          <tr key={a.id} className="border-t">
                            <td className="px-4 py-2">
                              Op. {a.source_operator_no}{" "}
                              {a.source_operator_name ? `(${a.source_operator_name})` : ""}
                            </td>
                            <td className="px-4 py-2">{a.operation_name}</td>
                            <td className="px-4 py-2">
                              Op. {a.target_operator_no}{" "}
                              {a.target_operator_name ? `(${a.target_operator_name})` : ""}
                            </td>
                            <td className="px-4 py-2">{a.assigned_quantity_per_hour} pcs/h</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            // SIMPLIFIED TIME-BASED OPERATIONS SECTION
            <div className="space-y-4">
              {/* Time Slot Selection Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                {slots.map((slot) => {
                  const isSelected = selectedTimeSlot === slot.slot_label;
                  const slotTarget = slotTargetsMap[slot.slot_label]?.slot_target || 0;
                  
                  return (
                    <button
                      key={slot.slot_label}
                      onClick={() => setSelectedTimeSlot(slot.slot_label)}
                      className={`
                        rounded-2xl border p-4 text-center transition-all
                        ${isSelected 
                          ? 'bg-gray-900 text-white border-gray-900 shadow-lg ring-2 ring-gray-900 ring-offset-2' 
                          : 'bg-white hover:border-gray-300 hover:shadow-md'
                        }
                      `}
                    >
                      <div className="font-bold text-xl">{slot.slot_label}</div>
                      <div className={`text-xs mt-1 ${isSelected ? 'text-gray-300' : 'text-gray-500'}`}>
                        Meta: {Math.round(slotTarget)}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Selected Time Slot Data Entry Section - Clean like the image */}
              {selectedTimeSlot && (
                <div className="rounded-3xl border bg-white shadow-sm overflow-hidden">
                  <div className="p-6">
                    <div className="mb-6">
                      <h3 className="text-lg font-semibold text-gray-900">
                        Ingresar producción por hora
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Ingresa las piezas cosidas en cada bloque horario
                      </p>
                    </div>

                    {/* Clean operator input grid with operator number and name */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                      {operatorsList.map((op) => {
                        const operatorId = op.id;
                        const currentValue = getOperatorValueForSlot(operatorId, selectedTimeSlot);
                        
                        return (
                          <div key={op.id} className="flex flex-col items-center">
                            <div className="text-xl font-semibold text-gray-900">
                              Op. {op.operator_no}
                            </div>
                            <div className="text-sm text-gray-600 mb-2 text-center">
                              {op.operator_name || 'Sin nombre'}
                            </div>
                            <input
                              type="number"
                              value={currentValue}
                              onChange={(e) => handleTimeSlotChange(
                                operatorId,
                                selectedTimeSlot,
                                e.target.value
                              )}
                              placeholder="0"
                              className="w-24 h-24 rounded-2xl border-2 border-gray-200 text-center
                                       text-3xl font-bold outline-none focus:ring-2 
                                       focus:ring-gray-900/10 focus:border-gray-400"
                              min="0"
                            />
                            <div className="text-sm text-gray-500 mt-2">
                              Meta: {Math.round(slotTargetsMap[selectedTimeSlot]?.slot_target || 0)}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Collapsible operations details */}
                    <details className="mt-8">
                      <summary className="text-sm font-medium text-gray-700 cursor-pointer hover:text-gray-900">
                        ► Ver todas las operaciones de este operador
                      </summary>
                      <div className="mt-4 space-y-4 border-t pt-4">
                        {operatorsList.map((op) => {
                          const block = runData?.operations?.find(b => b.operator?.id === op.id);
                          return (
                            <div key={op.id} className="bg-gray-50 rounded-xl p-4">
                              <div className="font-semibold text-gray-900 mb-2">Operador {op.operator_no} - {op.operator_name}</div>
                              <div className="space-y-2">
                                {block?.operations?.map((operation) => {
                                  const opTotal = getOperationTotal(operation.id);
                                  return (
                                    <div key={operation.id} className="flex justify-between items-center text-sm">
                                      <span className="text-gray-600">{operation.operation_name}</span>
                                      <span className="font-medium text-gray-900">{opTotal} pcs</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  </div>
                </div>
              )}

              {/* Global Save Button - Always visible */}
              <div className="sticky bottom-4 bg-white rounded-2xl border shadow-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {alarmVisible && (
                      <button
                        onClick={handleDismissAlarm}
                        className="rounded-xl bg-red-100 text-red-700 px-4 py-2 text-sm font-semibold hover:bg-red-200"
                      >
                        ⏰ Cerrar alarma
                      </button>
                    )}
                    <div className="text-sm text-gray-600">
                      {lastSavedTime && (
                        <>Último guardado: {new Date(lastSavedTime).toLocaleTimeString()}</>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleSave}
                    disabled={saving || !runData}
                    className="rounded-xl bg-green-600 text-white px-8 py-3 text-base font-semibold
                             hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed
                             shadow-lg hover:shadow-xl transition-all"
                  >
                    {saving ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Guardando...
                      </span>
                    ) : (
                      '💾 Guardar producción'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}