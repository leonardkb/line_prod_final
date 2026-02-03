import { safeNum } from "../utils/calc";

export default function MetaSummary({ header, target, slots }) {
  const wh = safeNum(header.workingHours);
  const perHour = wh > 0 ? target / wh : 0;

  const eff = safeNum(header.efficiency, 0.7);
  const effPct = Math.round(eff * 100);

  return (
    <div className="rounded-2xl border bg-white shadow-sm h-full">
      <div className="px-5 py-4 border-b">
        <h2 className="font-semibold text-gray-900">Meta Summary</h2>
        <p className="text-sm text-gray-600">
          Target is calculated using SAM and selected efficiency ({effPct}%).
        </p>
      </div>

      <div className="p-5 space-y-3">
        <Row k="Line" v={header.line || "—"} />
        <Row k="Date" v={header.date || "—"} />
        <Row k="Style" v={header.style || "—"} />

        <div className="my-3 h-px bg-gray-100" />

        <Row k="Operators" v={header.operators || "—"} />
        <Row k="SAM (min/piece)" v={header.sam || "—"} />
        <Row k="Working Hours" v={header.workingHours || "—"} />
        <Row k="Efficiency" v={`${effPct}%`} />

        <div className="my-3 h-px bg-gray-100" />

        <div className="rounded-xl bg-gray-900 text-white p-4">
          <div className="text-xs opacity-80">Meta / Target ({effPct}%)</div>
          <div className="text-2xl font-semibold">
            {target ? target.toFixed(2) : "0.00"}
          </div>
          <div className="text-xs opacity-80 mt-1">
            Per-hour target: {perHour ? perHour.toFixed(2) : "0.00"}
          </div>
        </div>

        <div className="rounded-xl border bg-gray-50 p-3">
          <div className="text-xs font-medium text-gray-700 mb-2">
            Shift Hours Distribution
          </div>

          {slots?.length ? (
            <div className="grid grid-cols-2 gap-2 text-sm">
              {slots.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-lg bg-white border px-3 py-2"
                >
                  <span className="text-gray-700">{s.label}</span>
                  <span className="font-medium text-gray-900">{s.hours}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-600">
              Enter working hours to generate slots.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="text-gray-600">{k}</div>
      <div className="font-medium text-gray-900">{v}</div>
    </div>
  );
}