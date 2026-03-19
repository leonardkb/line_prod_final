// [file name]: StyleSelector.jsx
import { useState } from "react";
import { format } from "date-fns";

export default function StyleSelector({ lineRuns, onSelect, selectedRun, loading }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterLine, setFilterLine] = useState("ALL");
  const [filterDate, setFilterDate] = useState("");

  // Get unique line numbers for filter
  const lineOptions = ["ALL", ...new Set(lineRuns.map(run => run.line_no))].sort();

  // Filter runs based on search and filters
  const filteredRuns = lineRuns.filter(run => {
    const matchesSearch = searchTerm === "" || 
      run.style.toLowerCase().includes(searchTerm.toLowerCase()) ||
      run.line_no.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesLine = filterLine === "ALL" || run.line_no === filterLine;
    
    const matchesDate = filterDate === "" || run.run_date === filterDate;
    
    return matchesSearch && matchesLine && matchesDate;
  });

  // Group by style for better organization
  const groupedByStyle = filteredRuns.reduce((acc, run) => {
    if (!acc[run.style]) {
      acc[run.style] = [];
    }
    acc[run.style].push(run);
    return acc;
  }, {});

  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="px-5 py-4 border-b">
        <h2 className="font-semibold text-gray-900">Seleccionar Estilo Existente</h2>
        <p className="text-sm text-gray-600">
          Elija un estilo de las corridas guardadas para planificar
        </p>
      </div>

      {/* Filters */}
      <div className="p-5 border-b bg-gray-50">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Buscar</label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Estilo o línea..."
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Filtrar por Línea</label>
            <select
              value={filterLine}
              onChange={(e) => setFilterLine(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            >
              {lineOptions.map(line => (
                <option key={line} value={line}>
                  {line === "ALL" ? "Todas las líneas" : `Línea ${line}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Filtrar por Fecha</label>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
        </div>

        {(searchTerm || filterLine !== "ALL" || filterDate) && (
          <button
            onClick={() => {
              setSearchTerm("");
              setFilterLine("ALL");
              setFilterDate("");
            }}
            className="mt-3 text-sm text-gray-600 hover:text-gray-900"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Results */}
      <div className="p-5 max-h-[500px] overflow-y-auto">
        {loading ? (
          <div className="text-center py-8 text-gray-600">Cargando estilos...</div>
        ) : Object.keys(groupedByStyle).length === 0 ? (
          <div className="text-center py-8 text-gray-600">
            No se encontraron estilos. Primero guarda una corrida desde el planificador.
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedByStyle).map(([style, runs]) => (
              <div key={style} className="space-y-3">
                <h3 className="font-medium text-gray-700 border-b pb-1">{style}</h3>
                
                {runs.map((run) => (
                  <div
                    key={run.id}
                    onClick={() => onSelect(run)}
                    className={`p-4 rounded-xl border cursor-pointer transition ${
                      selectedRun?.id === run.id
                        ? "border-gray-900 bg-gray-50"
                        : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold text-gray-900">
                        Línea {run.line_no}
                      </div>
                      <div className="text-xs text-gray-500">
                        {format(new Date(run.run_date), "dd/MM/yyyy")}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <span className="text-gray-500">Operadores:</span>
                        <span className="ml-1 font-medium">{run.operators_count}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">SAM:</span>
                        <span className="ml-1 font-medium">{run.sam_minutes} min</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Meta:</span>
                        <span className="ml-1 font-medium">{Math.round(run.target_pcs)} pzas</span>
                      </div>
                    </div>

                    <div className="mt-2 text-xs text-gray-500">
                      Horas: {run.working_hours} • Eficiencia: {Math.round(run.efficiency * 100)}%
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}