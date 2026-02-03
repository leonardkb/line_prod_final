import { safeNum } from "./calc";

/**
 * Creates slots like: 09:00, 10:00, ... 17:00, 17:36
 * And distributes working hours across them in an "Excel-like" pattern:
 * - first slot is 0.75h (45 min) by default
 * - lunch slot at 13:00 is 0.5h (30 min) by default
 * - last slot is 0.6h (36 min) by default, label 17:36
 * Then it scales the distribution to match EXACT workingHours.
 */
export function buildShiftSlots({
  workingHours,
  startHour = 9,
  endHour = 17,
  lunchHour = 13,
  firstSlotHours = 0.75,
  lunchSlotHours = 0.5,
  lastSlotHours = 0.6,
  lastSlotLabelMinutes = 36,
}) {
  const wh = safeNum(workingHours);
  if (wh <= 0) return [];

  const labels = [];
  for (let h = startHour; h <= endHour; h++) labels.push(`${h}`);
  labels.push(`${endHour}:${String(lastSlotLabelMinutes).padStart(2, "0")}`);

  // Base distribution aligned to labels:
  // [startHour] -> firstSlotHours
  // [lunchHour] -> lunchSlotHours
  // [endHour:last] -> lastSlotHours
  const base = labels.map((lab) => {
    const hourOnly = Number(lab.split(":")[0]);
    if (lab === `${endHour}:${String(lastSlotLabelMinutes).padStart(2, "0")}`) return lastSlotHours;
    if (hourOnly === startHour) return firstSlotHours;
    if (hourOnly === lunchHour) return lunchSlotHours;
    return 1; // normal full hour
  });

  const baseSum = base.reduce((a, b) => a + b, 0) || 1;
  const scale = wh / baseSum;

  const slots = labels.map((label, idx) => ({
    id: `slot-${idx}`,
    label,
    hours: Number((base[idx] * scale).toFixed(2)),
  }));

  // Fix tiny rounding drift: adjust last slot to match exact total.
  const sum = slots.reduce((a, s) => a + s.hours, 0);
  const diff = Number((wh - sum).toFixed(2));
  if (Math.abs(diff) >= 0.01) {
    slots[slots.length - 1].hours = Number((slots[slots.length - 1].hours + diff).toFixed(2));
  }

  return slots;
}

export function cumulative(arr, pick) {
  let run = 0;
  return arr.map((x) => {
    run += pick(x);
    return run;
  });
}