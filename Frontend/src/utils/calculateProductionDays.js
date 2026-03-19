// [file name]: daysCalculator.js
export function calculateProductionDays(quantity, targetPerDay, workingHours, operators) {
  if (!quantity || !targetPerDay || quantity <= 0 || targetPerDay <= 0) {
    return null;
  }

  const daysNeeded = quantity / targetPerDay;
  const workingDaysNeeded = Math.ceil(daysNeeded);
  
  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + workingDaysNeeded);
  
  // Calculate hourly production rate
  const hourlyRate = targetPerDay / workingHours;
  
  // Calculate minutes per piece
  const minutesPerPiece = (workingHours * 60) / targetPerDay;
  
  // Calculate total minutes needed
  const totalMinutesNeeded = quantity * minutesPerPiece;
  
  // Calculate minutes available per day
  const minutesPerDay = workingHours * 60 * operators;
  
  // Calculate utilization percentage
  const utilization = (totalMinutesNeeded / (minutesPerDay * workingDaysNeeded)) * 100;

  return {
    daysNeeded: Math.round(daysNeeded * 10) / 10,
    workingDaysNeeded,
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    hourlyRate: Math.round(hourlyRate * 100) / 100,
    minutesPerPiece: Math.round(minutesPerPiece * 100) / 100,
    totalMinutesNeeded: Math.round(totalMinutesNeeded),
    minutesPerDay: Math.round(minutesPerDay),
    targetPerDay: Math.round(targetPerDay),
    quantity: quantity,
    utilization: Math.round(utilization),
  };
}

export function calculateLineCapacity(lineRun) {
  if (!lineRun) return null;
  
  const totalDailyMinutes = lineRun.working_hours * 60 * lineRun.operators_count;
  const minutesPerPiece = lineRun.sam_minutes / lineRun.efficiency;
  const theoreticalCapacity = Math.floor(totalDailyMinutes / minutesPerPiece);
  
  return {
    totalDailyMinutes,
    minutesPerPiece: Math.round(minutesPerPiece * 100) / 100,
    theoreticalCapacity,
    actualTarget: lineRun.target_pcs,
    efficiency: lineRun.efficiency * 100,
    utilizationRate: Math.round((lineRun.target_pcs / theoreticalCapacity) * 100),
  };
}

export function suggestOptimalLine(quantity, availableLines) {
  if (!quantity || !availableLines.length) return null;
  
  return availableLines
    .map(line => ({
      ...line,
      daysNeeded: quantity / line.target_pcs,
      capacity: line.target_pcs,
    }))
    .sort((a, b) => a.daysNeeded - b.daysNeeded)
    .map(line => ({
      ...line,
      daysNeeded: Math.round(line.daysNeeded * 10) / 10,
      willFinishInDays: Math.ceil(line.daysNeeded),
    }));
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default {
  calculateProductionDays,
  calculateLineCapacity,
  suggestOptimalLine,
};