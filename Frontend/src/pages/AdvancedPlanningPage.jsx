// AdvancedPlanningPage.jsx - Complete Fixed Version
import { useState, useEffect } from "react";
import NavPlanner from "../components/planner/NavPlanner";
import PlanningDashboard from "../components/planner/PlanningDashboard";
import WorkOrderList from "../components/planner/WorkOrderList";
import WorkOrderForm from "../components/planner/WorkOrderForm";
import LineAssignmentForm from "../components/planner/LineAssignmentForm";
import { format } from "date-fns";
import PlanBoard from "../components/planner/PlanBoard";

export default function AdvancedPlanningPage() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [selectedWorkOrder, setSelectedWorkOrder] = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [message, setMessage] = useState("");

  const [workOrderData, setWorkOrderData] = useState({
    workOrderNo: "",
    quantity: "",
    customerName: "",
    styleDescription: "",
    color: "",
    fabricSupplier: "",
    styleCode: "",
    lineNo: "",
    runDate: "",
  });

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    setUserRole(user.role);
  }, []);

  const handleSelectWorkOrder = (workOrder) => {
    setSelectedWorkOrder(workOrder);
    setActiveTab("assign");
  };

  
  const handleCreateWorkOrder = () => {
    setSelectedWorkOrder(null);
    setWorkOrderData({
      workOrderNo: "",
      quantity: "",
      customerName: "",
      styleDescription: "",
      color: "",
      fabricSupplier: "",
      styleCode: "",
      lineNo: "",
      runDate: "",
    });
    setActiveTab("create");
  };

  const handleWorkOrderChange = (field, value) => {
    setWorkOrderData(prev => ({ ...prev, [field]: value }));
  };

  const handleStyleSelect = (run) => {
    setSelectedRun(run);
    setWorkOrderData(prev => ({
      ...prev,
      styleDescription: run.style,
      styleCode: run.style,
      lineNo: run.line_no,
      runDate: run.run_date,
    }));
  };

  const tabs = [
    { id: "dashboard", label: "Dashboard", visible: true },
    { id: "list", label: "Órdenes", visible: true },
     { id: "planboard", label: "Plan Board", visible: true },  // NEW
    { id: "create", label: "Crear Orden", visible: ["engineer", "supervisor", "soporte_it", "skyrina", "planner"].includes(userRole) },
    { id: "assign", label: "Asignar", visible: selectedWorkOrder !== null },
  ];

  // Clear message after 5 seconds
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  return (
    <div className="min-h-screen bg-gray-50">
      <NavPlanner />

      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">
            Planificación Avanzada
          </h1>
          <p className="text-sm text-gray-600">
            Gestione órdenes de trabajo y asignaciones a líneas de producción
          </p>
        </div>

        {/* Message Display */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.includes("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}>
            {message}
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6 flex flex-wrap gap-2 border-b">
          {tabs.map(tab => tab.visible && (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition ${
                activeTab === tab.id
                  ? "text-gray-900 border-b-2 border-gray-900"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="space-y-6">
          {activeTab === "dashboard" && <PlanningDashboard />}
          {activeTab === "planboard" && <PlanBoard />}  {/* NEW */ }
{activeTab === "list" && (
  <WorkOrderList 
    onSelectWorkOrder={handleSelectWorkOrder}
    onEdit={(order) => {
      setSelectedWorkOrder(order);
      setWorkOrderData({
        workOrderNo: order.work_order_no,
        quantity: order.quantity,
        customerName: order.customer_name,
        styleDescription: order.style_description,
        color: order.color || "",
        fabricSupplier: order.fabric_supplier || "",
        styleCode: order.style_code || "",
        lineNo: order.line_no || "",
        runDate: order.run_date || "",
      });
      setActiveTab("create");
    }}
    onDelete={(id) => {
      setMessage(`✅ Orden cancelada exitosamente`);
      // Refresh the list automatically
    }}
  />
)}
          
          {activeTab === "create" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <WorkOrderForm
                  workOrderData={workOrderData}
                  onChange={handleWorkOrderChange}
                  selectedRun={selectedRun}
                  onSuccess={(newOrder) => {
                    setMessage(`✅ Orden ${newOrder.work_order_no} creada exitosamente`);
                    setActiveTab("list");
                    // Reset form
                    setWorkOrderData({
                      workOrderNo: "",
                      quantity: "",
                      customerName: "",
                      styleDescription: "",
                      color: "",
                      fabricSupplier: "",
                      styleCode: "",
                      lineNo: "",
                      runDate: "",
                    });
                    setSelectedRun(null);
                  }}
                  isEditMode={false}
                />
              </div>
              <div className="lg:col-span-1">
                <div className="bg-white rounded-xl border p-4">
                  <h3 className="font-medium text-gray-900 mb-2">Información</h3>
                  <p className="text-sm text-gray-600 mb-3">
                    Complete todos los campos obligatorios para crear una nueva orden de trabajo.
                  </p>
                  
                  {/* Style selection quick link */}
                  <button
                    onClick={() => {
                      setActiveTab("dashboard");
                      // You might want to navigate to style selector
                    }}
                    className="w-full mb-3 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 text-left"
                  >
                    📦 Buscar estilo existente
                  </button>
                  
                  <div className="bg-blue-50 rounded-lg p-3">
                    <p className="text-xs text-blue-800 font-medium mb-2">📋 Consejos:</p>
                    <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
                      <li>Use un número de orden único y descriptivo</li>
                      <li>Si seleccionó un estilo, la capacidad diaria se usará para estimar días</li>
                      <li>La orden se creará con estado "Pendiente"</li>
                      <li>Después de crear, puede asignarla a líneas desde la lista</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === "assign" && selectedWorkOrder && (
            <LineAssignmentForm
              workOrder={selectedWorkOrder}
              onAssignmentComplete={() => {
                setShowAssignmentForm(false);
                setActiveTab("list");
                setSelectedWorkOrder(null);
                setMessage("✅ Asignación completada exitosamente");
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}