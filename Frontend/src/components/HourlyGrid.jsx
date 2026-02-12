import { useMemo } from "react";
import { safeNum } from "../utils/calc";
import { cumulative } from "../utils/timeslots";

export default function HourlyGrid({ target, slots, stitched, onChangeStitched }) {
  const wh = useMemo(() => (slots || []).reduce((a, s) => a + safeNum(s.hours), 0), [slots]);
  const t = safeNum(target);
  const targetPerHour = wh > 0 ? t / wh : 0;

  const slotTargets = useMemo(() => {
    return (slots || []).map((s) => Number((targetPerHour * safeNum(s.hours)).toFixed(2)));
  }, [slots, targetPerHour]);

  const cumTargets = useMemo(() => {
    const cum = cumulative((slots || []).map((s, i) => ({ ...s, tar: slotTargets[i] })), (x) => x.tar);
    // clamp to final target
    return cum.map((v) => Number(Math.min(t, v).toFixed(2)));
  }, [slots, slotTargets, t]);

  const stitchedNums = useMemo(() => {
    return (slots || []).map((s) => safeNum(stitched?.[s.id]));
  }, [slots, stitched]);

  const cumStitched = useMemo(() => {
    let run = 0;
    return stitchedNums.map((v) => {
      run += v;
      return run;
    });
  }, [stitchedNums]);

  const totalStitched = cumStitched.length ? cumStitched[cumStitched.length - 1] : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">Hourly Plan</div>
          <div className="text-xs text-gray-500">
            Slot target = (Target / WorkingHours) × SlotHours. Cumulative target stops at final meta.
          </div>
        </div>
        <div className="rounded-xl border bg-gray-50 px-3 py-2">
          <div className="text-xs text-gray-500">Total Sewed</div>
          <div className="text-sm font-semibold text-gray-900">{totalStitched}</div>
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <table className="min-w-[900px] w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <Th sticky>Row</Th>
              {(slots || []).map((s) => (
                <Th key={s.id}>{s.label}</Th>
              ))}
              <Th>Total</Th>
            </tr>
          </thead>

          <tbody>
            <tr>
              <Td sticky className="text-gray-600 font-medium border-r border-gray-200">Slot Hours</Td>
              {(slots || []).map((s, i) => (
                <Td 
                  key={s.id} 
                  className={`${i < slots.length - 1 ? 'border-r border-gray-200' : ''}`}
                >
                  {safeNum(s.hours).toFixed(2)}
                </Td>
              ))}
              <Td className="font-semibold border-l border-gray-200">{wh.toFixed(2)}</Td>
            </tr>

            <tr>
              <Td sticky className="text-gray-600 font-medium border-r border-gray-200">Slot Target</Td>
              {slotTargets.map((v, i) => (
                <Td 
                  key={slots[i].id} 
                  className={`font-medium ${i < slots.length - 1 ? 'border-r border-gray-200' : ''}`}
                >
                  {v.toFixed(2)}
                </Td>
              ))}
              <Td className="font-semibold border-l border-gray-200">{t.toFixed(2)}</Td>
            </tr>

            <tr>
              <Td sticky className="text-gray-600 font-medium border-r border-gray-200">Cum Target</Td>
              {cumTargets.map((v, i) => (
                <Td 
                  key={slots[i].id} 
                  className={`font-semibold ${i < slots.length - 1 ? 'border-r border-gray-200' : ''}`}
                >
                  {v.toFixed(2)}
                </Td>
              ))}
              <Td className="font-semibold border-l border-gray-200">{t.toFixed(2)}</Td>
            </tr>

            <tr>
              <td colSpan={(slots?.length || 0) + 2} className="h-3 bg-transparent" />
            </tr>

            <tr>
              <Td sticky className="text-gray-900 font-semibold border-r border-gray-200 border-t border-gray-200">Sewed (input)</Td>
              {(slots || []).map((s, i) => (
                <Td 
                  key={s.id} 
                  className={`border-t border-gray-200 ${i < slots.length - 1 ? 'border-r border-gray-200' : ''}`}
                >
                  <input
                    value={stitched?.[s.id] ?? ""}
                    onChange={(e) => onChangeStitched(s.id, e.target.value)}
                    className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm outline-none
                               focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300 bg-white"
                    placeholder="0"
                    inputMode="numeric"
                  />
                </Td>
              ))}
              <Td className="font-semibold border-t border-gray-200 border-l border-gray-200">{totalStitched}</Td>
            </tr>

            <tr>
              <Td sticky className="text-gray-600 font-medium border-r border-gray-200 border-b border-gray-200">Cum Sewed</Td>
              {cumStitched.map((v, i) => (
                <Td 
                  key={slots[i].id} 
                  className={`font-semibold border-b border-gray-200 ${i < slots.length - 1 ? 'border-r border-gray-200' : ''}`}
                >
                  {v}
                </Td>
              ))}
              <Td className="font-semibold border-b border-gray-200 border-l border-gray-200">{totalStitched}</Td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-500">
        Tip: This table scrolls horizontally on mobile. It’s responsive.
      </div>
    </div>
  );
}

function Th({ children, sticky }) {
  return (
    <th
      className={
        "border-y border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-700 " +
        (sticky ? "sticky left-0 z-10 after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-gray-200" : "")
      }
    >
      {children}
    </th>
  );
}

function Td({ children, sticky, className = "" }) {
  return (
    <td
      className={
        "px-3 py-2 text-sm text-gray-900 bg-white " +
        (sticky ? "sticky left-0 z-10 after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-gray-200" : "") +
        " " + className
      }
    >
      {children}
    </td>
  );
}