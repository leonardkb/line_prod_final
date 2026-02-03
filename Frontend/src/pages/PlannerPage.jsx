import { useMemo, useState } from "react";
import HeaderForm from "../components/HeaderForm";
import MetaSummary from "../components/MetaSummary";
import OperationPlanner from "../components/OperationPlanner";
import SavedRunsViewer from "../components/SavedRunsViewer"; // ✅ Import the new component
import { calcTargetFromSAM } from "../utils/calc";
import { buildShiftSlots } from "../utils/timeslots";
import Navbar from "../components/Navbar";

const initialHeader = {
  line: "",
  date: "",
  sam: "",
  workingHours: "",
  style: "",
  operators: "",
  efficiency: 0.7,
};

export default function PlannerPage() {
  const [header, setHeader] = useState(initialHeader);
  const [currentRunId, setCurrentRunId] = useState(null); // ✅ Added: store current run ID
  const [mode, setMode] = useState("planner"); // ✅ "planner" or "view"

  // ✅ Quick nav state
  const [activePanel, setActivePanel] = useState("inputs"); // inputs | summary | operations

  // ✅ Operator No filter state (NOT name)
  const [selectedOperatorNo, setSelectedOperatorNo] = useState("ALL");

  // ✅ Used to build operator buttons (numbers)
  const [operatorNos, setOperatorNos] = useState([]);

  const target = useMemo(
    () =>
      calcTargetFromSAM(
        header.operators,
        header.workingHours,
        header.sam,
        header.efficiency
      ),
    [header.operators, header.workingHours, header.sam, header.efficiency]
  );

  const slots = useMemo(
    () =>
      buildShiftSlots({
        workingHours: header.workingHours,
        startHour: 9,
        endHour: 17,
        lunchHour: 13,
        lastSlotLabelMinutes: 36,
      }),
    [header.workingHours]
  );

  // ✅ Create operator pills from operator numbers (unique + numeric sort)
  const operatorButtons = useMemo(() => {
    const uniq = Array.from(
      new Set((operatorNos || []).map((x) => String(x || "").trim()).filter(Boolean))
    );
    return uniq.sort((a, b) => Number(a) - Number(b));
  }, [operatorNos]);

  // ✅ Handle save success from HeaderForm to get the run ID
  const handleSaveSuccess = (runId) => {
    setCurrentRunId(runId);
    console.log(`✅ Step 1 saved. Current Run ID: ${runId}`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
     <Navbar/>
      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">
                Line Planner
              </h1>
              <p className="text-sm text-gray-600">
                Enter line details → get target/meta → plan operations → track hourly output with running totals.
              </p>
            </div>

            <div className="hidden sm:block rounded-2xl border bg-white px-4 py-3 shadow-sm">
              <div className="text-xs text-gray-500">Status</div>
              <div className="text-sm font-medium text-gray-900">
                {target > 0 ? "Ready to Track" : "Waiting for Inputs"}
                {currentRunId && ` • Run ID: ${currentRunId}`}
              </div>
            </div>
          </div>

          {/* ✅ MODE TOGGLE BUTTONS */}
          <div className="flex gap-3">
            <button
              onClick={() => setMode("planner")}
              className={`rounded-xl px-4 py-2 text-sm font-medium border ${
                mode === "planner" 
                  ? "bg-gray-900 text-white border-gray-900" 
                  : "bg-white text-gray-800 border-gray-200 hover:border-gray-300"
              }`}
            >
              Create New
            </button>
            <button
              onClick={() => setMode("view")}
              className={`rounded-xl px-4 py-2 text-sm font-medium border ${
                mode === "view" 
                  ? "bg-gray-900 text-white border-gray-900" 
                  : "bg-white text-gray-800 border-gray-200 hover:border-gray-300"
              }`}
            >
              View Saved
            </button>
          </div>

          {/* ✅ QUICK ACCESS BUTTONS (only shown in planner mode) */}
          {mode === "planner" && (
            <div className="flex flex-wrap gap-2">
              <QuickBtn active={activePanel === "inputs"} onClick={() => setActivePanel("inputs")}>
                Line Inputs
              </QuickBtn>
              <QuickBtn active={activePanel === "summary"} onClick={() => setActivePanel("summary")}>
                Meta Summary
              </QuickBtn>
              <QuickBtn active={activePanel === "operations"} onClick={() => setActivePanel("operations")}>
                Operations
              </QuickBtn>
            </div>
          )}

          {/* ✅ OPERATOR NO FILTER BUTTONS (only shown in planner mode) */}
          {mode === "planner" && (
            <div className="rounded-2xl border bg-white shadow-sm p-3">
              <div className="text-xs font-medium text-gray-700 mb-2">
                Quick Operator Filter (by No)
              </div>

              <div className="flex flex-wrap gap-2">
                <Pill
                  active={selectedOperatorNo === "ALL"}
                  onClick={() => setSelectedOperatorNo("ALL")}
                >
                  All
                </Pill>

                {operatorButtons.length ? (
                  operatorButtons.map((no) => (
                    <Pill
                      key={no}
                      active={selectedOperatorNo === no}
                      onClick={() => setSelectedOperatorNo(no)}
                      title={`Operator ${no}`}
                    >
                      Operator {no}
                    </Pill>
                  ))
                ) : (
                  <div className="text-xs text-gray-500">
                    Add Operator No in Step 2 to enable quick filtering.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ✅ MAIN CONTENT AREA */}
        {mode === "planner" ? (
          // Existing planner content
          <>
            {activePanel === "inputs" && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2">
                  {/* Pass onSaveSuccess callback to HeaderForm */}
                  <HeaderForm 
                    value={header} 
                    onChange={setHeader}  
                    slots={slots}
                    onSaveSuccess={handleSaveSuccess}
                  />
                </div>
                <div className="lg:col-span-1">
                  <MetaSummary header={header} target={target} slots={slots} />
                </div>
              </div>
            )}

            {activePanel === "summary" && (
              <div className="grid grid-cols-1">
                <MetaSummary header={header} target={target} slots={slots} />
              </div>
            )}

            {activePanel === "operations" && (
              <div className="mt-2">
                <OperationPlanner
                  target={target}
                  slots={slots}
                  selectedOperatorNo={selectedOperatorNo} // ✅ filter by operator no
                  onOperatorNosChange={setOperatorNos}   // ✅ collect operator nos for buttons
                  currentRunId={currentRunId}            // ✅ pass current run ID for saving
                />
              </div>
            )}

            <div className="mt-10 text-xs text-gray-500">
              Notes: Target uses SAM (minutes/piece) and the selected efficiency. 
              Capacity/hour uses 3600 / average(t1..t5).
            </div>
          </>
        ) : (
          <SavedRunsViewer onBack={() => setMode("planner")} />
        )}
      </div>
    </div>
  );
}

function QuickBtn({ children, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-xl px-4 py-2 text-sm font-medium border transition",
        active
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-800 border-gray-200 hover:border-gray-300",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Pill({ children, active, onClick, title }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={[
        "rounded-full px-3 py-1.5 text-xs font-medium border transition max-w-[220px] truncate",
        active
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-800 border-gray-200 hover:border-gray-300",
      ].join(" ")}
    >
      {children}
    </button>
  );
}