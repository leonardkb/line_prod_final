import { useState, useEffect, useMemo } from "react";
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
    return rows.map((row) => ({
      ...row,
      capPerOperator: row.capPerOperator || 0,
    }));
  }, [rows]);

  // Opciones de No. de Operador para el dropdown
  const operatorNoOptions = useMemo(() => {
    const set = new Set();
    computedRows.forEach((r) => {
      const no = normalizeNo(r.operatorNo);
      if (no) set.add(no);
    });
    return Array.from(set).sort((a, b) => Number(a) - Number(b));
  }, [computedRows]);

  // Filtrar filas
  const visibleRows = useMemo(() => {
    const q = searchText.trim().toLowerCase();

    return computedRows.filter((r) => {
      const opNo = normalizeNo(r.operatorNo);
      const parentOk = operatorFilterNo === "ALL" ? true : opNo === operatorFilterNo;

      const searchOk =
        !q ||
        (r.operation || "").toLowerCase().includes(q) ||
        (r.operatorName || "").toLowerCase().includes(q) ||
        opNo.toLowerCase().includes(q);

      return parentOk && searchOk;
    });
  }, [computedRows, operatorFilterNo, searchText]);

  // Agrupar por operador (solo filas visibles)
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

    return keys.map((k) => {
      const rows = map.get(k);
      // Para operadores asignados, usamos la primera fila como referencia (todas compartirán el mismo stitched)
      const firstRow = rows[0];
      const operatorTotal = firstRow ? sumStitchedForRow(firstRow, slots) : 0;
      const perHourTotals = (slots || []).map((s) =>
        firstRow ? sumStitchedForRowAtSlot(firstRow, s.id) : 0
      );
      return { operatorNo: k, rows, operatorTotal, perHourTotals };
    });
  }, [visibleRows, slots]);

  // Actualizar stitched: si el operador tiene número, se sincronizan todas sus filas
  const updateRowStitched = (rowId, slotId, value) => {
    setRows((prev) => {
      const targetRow = prev.find((r) => r.id === rowId);
      if (!targetRow) return prev;
      const operatorNo = normalizeNo(targetRow.operatorNo);

      // Sin número de operador → solo actualizar esa fila
      if (!operatorNo) {
        return prev.map((row) =>
          row.id === rowId
            ? { ...row, stitched: { ...row.stitched, [slotId]: value } }
            : row
        );
      }

      // Con número → actualizar TODAS las filas del mismo operador
      return prev.map((row) => {
        if (normalizeNo(row.operatorNo) === operatorNo) {
          return { ...row, stitched: { ...row.stitched, [slotId]: value } };
        }
        return row;
      });
    });
  };

  const handleSaveHourlyUpdates = async () => {
    if (!runId) {
      setMessage("❌ No hay una corrida seleccionada");
      return;
    }

    if (computedRows.length === 0) {
      setMessage("❌ No hay datos de operaciones");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      await onUpdateHourly(computedRows);
      setMessage("✅ ¡Datos por hora guardados correctamente!");
    } catch (err) {
      setMessage(`❌ No se pudo guardar: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Total general (sin duplicar operadores con varias operaciones)
  const totalStitched = useMemo(() => {
    const operatorMap = new Map();

    const getRowTotal = (row) =>
      Object.values(row.stitched || {}).reduce(
        (sum, v) => sum + (Number.isFinite(Number(v)) ? Number(v) : 0),
        0
      );

    computedRows.forEach((row) => {
      const opNo = normalizeNo(row.operatorNo);
      const rowTotal = getRowTotal(row);

      if (opNo) {
        // Solo guardamos el primer valor del operador
        if (!operatorMap.has(opNo)) {
          operatorMap.set(opNo, rowTotal);
        }
        // Si el operador ya está, ignoramos las demás filas (para no duplicar)
      } else {
        // Sin asignar → cada fila cuenta por separado
        operatorMap.set(`unassigned-${row.id}`, rowTotal);
      }
    });

    return Array.from(operatorMap.values()).reduce((sum, val) => sum + val, 0);
  }, [computedRows]);

  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="px-5 py-4 border-b">
        <h2 className="font-semibold text-gray-900">Operaciones y seguimiento por hora</h2>
        <p className="text-sm text-gray-600">
          Consulta y actualiza las cantidades cosidas por hora. Los cambios se guardan por separado.
        </p>
      </div>

      {/* Controles */}
      <div className="px-5 py-4 border-b bg-gray-50">
        <div className="flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="w-full sm:w-72">
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Buscar operaciones..."
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none"
              />
            </div>

            <div className="w-full sm:w-60">
              <select
                value={operatorFilterNo}
                onChange={(e) => setOperatorFilterNo(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none"
              >
                <option value="ALL">Todos los operadores</option>
                {operatorNoOptions.map((no) => (
                  <option key={no} value={no}>
                    Operador {no}
                  </option>
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
              Restablecer filtros
            </button>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-600">
              Total cosido: <span className="font-semibold">{totalStitched}</span>
            </div>
            <button
              onClick={handleSaveHourlyUpdates}
              disabled={saving}
              className="rounded-xl px-6 py-3 text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? "Guardando..." : "💾 Guardar actualizaciones por hora"}
            </button>
          </div>
        </div>

        {message && (
          <div
            className={`mt-3 p-3 rounded-lg text-sm ${
              message.includes("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}
          >
            {message}
          </div>
        )}
      </div>

      {/* Grupos de operaciones */}
      <div className="p-5 space-y-6">
        {groups.length === 0 ? (
          <div className="rounded-xl border bg-gray-50 p-8 text-center text-gray-600">
            No se encontraron operaciones.
          </div>
        ) : (
          groups.map((g) => {
            const opNoLabel =
              g.operatorNo === "UNASSIGNED" ? "Sin asignar" : `Operador ${g.operatorNo}`;

            return (
              <div
                key={g.operatorNo}
                className="rounded-2xl border border-gray-200 overflow-hidden"
              >
                {/* Encabezado del operador */}
                <div className="px-5 py-4 bg-gray-50 border-b">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-gray-900">{opNoLabel}</div>
                    <div className="text-sm text-gray-600">
                      Nombre del operador: {g.rows[0]?.operatorName || "No especificado"}
                    </div>
                  </div>

                  <div className="text-sm text-gray-600 mb-3">
                    Total piezas producidas (todas las operaciones):{" "}
                    <span className="font-semibold">{g.operatorTotal}</span>
                  </div>

                  {/* Totales por hora del operador (valor común) */}
                  {slots?.length > 0 && (
                    <div className="grid grid-cols-10 gap-1">
                      {slots.map((s, i) => (
                        <div key={s.id} className="text-center">
                          <div className="text-xs text-gray-500 font-medium mb-1">{s.label}</div>
                          <div className="text-sm font-semibold text-gray-900 bg-white rounded border px-1 py-0.5">
                            {g.perHourTotals[i]}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Lista de operaciones */}
                <div className="p-5 space-y-5">
                  {g.rows.map((row, idx) => (
                    <div
                      key={row.id}
                      className="rounded-xl border border-gray-200 overflow-hidden"
                    >
                      <div className="p-4 bg-white border-b">
                        <div className="flex items-center justify-between mb-4">
                          <div className="font-semibold text-gray-900">
                            {row.operation || `Operación ${idx + 1}`}
                          </div>
                          <div className="text-sm text-gray-600">
                            Capacidad: {row.capPerOperator?.toFixed(2) || "0.00"}/hora
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                          <div>
                            <div className="text-gray-500">t1</div>
                            <div className="font-medium">{row.t1 || "-"} seg</div>
                          </div>
                          <div>
                            <div className="text-gray-500">t2</div>
                            <div className="font-medium">{row.t2 || "-"} seg</div>
                          </div>
                          <div>
                            <div className="text-gray-500">t3</div>
                            <div className="font-medium">{row.t3 || "-"} seg</div>
                          </div>
                          <div>
                            <div className="text-gray-500">t4</div>
                            <div className="font-medium">{row.t4 || "-"} seg</div>
                          </div>
                          <div>
                            <div className="text-gray-500">t5</div>
                            <div className="font-medium">{row.t5 || "-"} seg</div>
                          </div>
                        </div>
                      </div>

                      {/* Tabla por hora para esta operación */}
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