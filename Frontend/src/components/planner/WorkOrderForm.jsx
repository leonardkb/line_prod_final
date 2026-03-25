// components/planner/WorkOrderForm.jsx (Updated with Add Customer feature)
import { useState, useEffect } from "react";
import StyleSelectorModal from "./StyleSelectorModal";

export default function WorkOrderForm({ 
  workOrderData, 
  onChange, 
  selectedRun, 
  onSuccess,
  isEditMode = false 
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [fabrics, setFabrics] = useState([]);
  const [selectedFabrics, setSelectedFabrics] = useState([]);
  const [newCustomer, setNewCustomer] = useState("");
  const [newCustomerMarket, setNewCustomerMarket] = useState("domestico");
  const [newFabric, setNewFabric] = useState("");
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);

  useEffect(() => {
    fetchCustomers();
    fetchFabrics();
    
    // Initialize selected fabrics from workOrderData
    if (workOrderData.fabrics && workOrderData.fabrics.length > 0) {
      setSelectedFabrics(workOrderData.fabrics);
    }
  }, []);

  const fetchCustomers = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch("http://localhost:5001/api/customers", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        setCustomers(data.customers);
      }
    } catch (err) {
      console.error("Error fetching customers:", err);
    }
  };

  const fetchFabrics = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch("http://localhost:5001/api/fabrics", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        setFabrics(data.fabrics);
      }
    } catch (err) {
      console.error("Error fetching fabrics:", err);
    }
  };

  const addNewCustomer = async () => {
    if (!newCustomer.trim()) {
      setError("Por favor ingrese el nombre del cliente");
      return;
    }

    try {
      const token = localStorage.getItem("token");
      const response = await fetch("http://localhost:5001/api/customers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ 
          name: newCustomer.trim(), 
          market_type: newCustomerMarket 
        })
      });
      const data = await response.json();
      if (data.success) {
        setCustomers([...customers, data.customer]);
        onChange("customerId", data.customer.id);
        setNewCustomer("");
        setShowNewCustomerForm(false);
        setSuccess(`✅ Cliente "${newCustomer}" agregado correctamente`);
        setTimeout(() => setSuccess(""), 3000);
      }
    } catch (err) {
      setError(`Error al agregar cliente: ${err.message}`);
    }
  };

  const addNewFabric = async () => {
    if (!newFabric.trim()) return;
    
    try {
      const token = localStorage.getItem("token");
      const response = await fetch("http://localhost:5001/api/fabrics", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name: newFabric.trim() })
      });
      const data = await response.json();
      if (data.success) {
        setFabrics([...fabrics, data.fabric]);
        setNewFabric("");
        setSuccess(`✅ Tela "${newFabric}" agregada correctamente`);
        setTimeout(() => setSuccess(""), 3000);
      }
    } catch (err) {
      setError(`Error al agregar tela: ${err.message}`);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validate required fields
    if (!workOrderData.workOrderNo || !workOrderData.totalToProduce || !workOrderData.customerId) {
      setError("Por favor complete todos los campos requeridos");
      return;
    }

    if (!workOrderData.commitmentDate) {
      setError("Por favor seleccione la fecha compromiso de entrega");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const token = localStorage.getItem("token");
      const url = isEditMode 
        ? `http://localhost:5001/api/work-orders/${workOrderData.id}`
        : "http://localhost:5001/api/work-orders";
      
      const method = isEditMode ? "PUT" : "POST";
      
      const requestBody = {
        workOrderNo: workOrderData.workOrderNo,
        totalQuantity: parseFloat(workOrderData.totalQuantity) || 0,
        warehouseStock: parseFloat(workOrderData.warehouseStock) || 0,
        extraQuantity: parseFloat(workOrderData.extraQuantity) || 0,
        totalToProduce: parseFloat(workOrderData.totalToProduce),
        commitmentDate: workOrderData.commitmentDate,
        customerId: parseInt(workOrderData.customerId),
        styleDescription: workOrderData.styleDescription,
        styleCode: workOrderData.styleCode,
        color: workOrderData.color,
        fabrics: selectedFabrics,
        lineNo: workOrderData.lineNo || null,
        runDate: workOrderData.runDate || null,
      };
      
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error);
      }

      setSuccess(isEditMode ? "✅ Orden actualizada exitosamente!" : "✅ Orden creada exitosamente!");
      
      if (!isEditMode) {
        setTimeout(() => {
          // Reset form
          onChange("workOrderNo", "");
          onChange("totalQuantity", "");
          onChange("warehouseStock", "");
          onChange("extraQuantity", "");
          onChange("totalToProduce", "");
          onChange("commitmentDate", "");
          onChange("customerId", "");
          onChange("styleDescription", "");
          onChange("styleCode", "");
          onChange("color", "");
          setSelectedFabrics([]);
          onChange("fabrics", []);
          onChange("lineNo", "");
          onChange("runDate", "");
          
          if (onSuccess) {
            onSuccess(data.workOrder);
          }
        }, 1500);
      } else {
        setTimeout(() => {
          if (onSuccess) {
            onSuccess(data.workOrder);
          }
        }, 1500);
      }
      
    } catch (err) {
      setError(`❌ Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    onChange(name, value);
    
    // Auto-calculate total to produce when totalQuantity, warehouseStock, or extraQuantity changes
    if (name === "totalQuantity" || name === "warehouseStock" || name === "extraQuantity") {
      const totalQty = parseFloat(name === "totalQuantity" ? value : workOrderData.totalQuantity) || 0;
      const warehouse = parseFloat(name === "warehouseStock" ? value : workOrderData.warehouseStock) || 0;
      const extra = parseFloat(name === "extraQuantity" ? value : workOrderData.extraQuantity) || 0;
      const totalToProduce = totalQty - warehouse + extra;
      onChange("totalToProduce", totalToProduce);
    }
  };

  const handleFabricToggle = (fabricName) => {
    let newSelected;
    if (selectedFabrics.includes(fabricName)) {
      newSelected = selectedFabrics.filter(f => f !== fabricName);
    } else {
      if (selectedFabrics.length >= 3) {
        setError("Solo se pueden seleccionar hasta 3 telas");
        setTimeout(() => setError(""), 3000);
        return;
      }
      newSelected = [...selectedFabrics, fabricName];
    }
    setSelectedFabrics(newSelected);
    onChange("fabrics", newSelected);
  };

  const handleStyleSelect = (styleData) => {
    onChange("styleDescription", styleData.style);
    onChange("styleCode", styleData.style);
    onChange("lineNo", styleData.line_no);
    onChange("runDate", styleData.run_date);
    
    setSuccess(`✅ Estilo "${styleData.style}" seleccionado. Meta diaria: ${Math.round(styleData.target_pcs).toLocaleString()} pzas/día`);
    setTimeout(() => setSuccess(""), 3000);
  };

  // Auto-calculate total to produce
  useEffect(() => {
    const totalQty = parseFloat(workOrderData.totalQuantity) || 0;
    const warehouse = parseFloat(workOrderData.warehouseStock) || 0;
    const extra = parseFloat(workOrderData.extraQuantity) || 0;
    const totalToProduce = totalQty - warehouse + extra;
    if (totalToProduce !== parseFloat(workOrderData.totalToProduce)) {
      onChange("totalToProduce", totalToProduce);
    }
  }, [workOrderData.totalQuantity, workOrderData.warehouseStock, workOrderData.extraQuantity]);

  const getSelectedCustomer = () => {
    return customers.find(c => c.id === parseInt(workOrderData.customerId));
  };

  return (
    <>
      <StyleSelectorModal
        isOpen={showStyleModal}
        onClose={() => setShowStyleModal(false)}
        onSelectStyle={handleStyleSelect}
      />

      <form onSubmit={handleSubmit} className="rounded-2xl border bg-white shadow-sm">
        <div className="px-5 py-4 border-b bg-gradient-to-r from-gray-50 to-white">
          <h2 className="font-semibold text-gray-900 text-lg">
            {isEditMode ? "Editar Orden de Trabajo" : "Crear Nueva Orden de Trabajo"}
          </h2>
          <p className="text-sm text-gray-600">
            {isEditMode 
              ? "Actualice la información de la orden" 
              : "Complete la información para crear una nueva orden de trabajo"}
          </p>
        </div>

        <div className="p-5 max-h-[70vh] overflow-y-auto">
          {/* Style Selection Section */}
          {workOrderData.styleDescription && (
            <div className="mb-4 p-3 bg-blue-50 rounded-xl border border-blue-200">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-blue-600 mb-1">Estilo seleccionado</div>
                  <div className="text-sm font-medium text-blue-900">
                    {workOrderData.styleDescription}
                  </div>
                  {workOrderData.lineNo && (
                    <div className="text-xs text-blue-600 mt-1">
                      Línea sugerida: {workOrderData.lineNo} | 
                      Fecha sugerida: {workOrderData.runDate ? new Date(workOrderData.runDate).toLocaleDateString() : 'No especificada'}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowStyleModal(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                >
                  Cambiar
                </button>
              </div>
            </div>
          )}

          {/* Style Selection Button */}
          {!workOrderData.styleDescription && !isEditMode && (
            <div className="mb-4">
              <button
                type="button"
                onClick={() => setShowStyleModal(true)}
                className="w-full py-3 bg-gradient-to-r from-blue-50 to-blue-100 border border-blue-200 rounded-xl text-blue-700 font-medium hover:from-blue-100 hover:to-blue-200 transition flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Buscar estilo existente
              </button>
            </div>
          )}

          <div className="space-y-4">
            {/* Order Number */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Número de Orden <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="workOrderNo"
                value={workOrderData.workOrderNo || ""}
                onChange={handleChange}
                className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                placeholder="Ej: WO-2024-001"
                required
              />
            </div>

            {/* Customer Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cliente <span className="text-red-500">*</span>
              </label>
              
              {!showNewCustomerForm ? (
                <div className="flex gap-2">
                  <select
                    name="customerId"
                    value={workOrderData.customerId || ""}
                    onChange={handleChange}
                    className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                    required
                  >
                    <option value="">Seleccionar cliente...</option>
                    {customers.map(customer => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name} - {customer.market_type === 'export' ? '🌎 Export' : '🇲🇽 Doméstico'}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowNewCustomerForm(true)}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200 whitespace-nowrap"
                  >
                    + Nuevo Cliente
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCustomer}
                      onChange={(e) => setNewCustomer(e.target.value)}
                      placeholder="Nombre del cliente"
                      className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                    />
                    <select
                      value={newCustomerMarket}
                      onChange={(e) => setNewCustomerMarket(e.target.value)}
                      className="rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                    >
                      <option value="domestico">🇲🇽 Doméstico</option>
                      <option value="export">🌎 Export</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={addNewCustomer}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm hover:bg-blue-700"
                    >
                      Guardar Cliente
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewCustomerForm(false);
                        setNewCustomer("");
                      }}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
              
              {getSelectedCustomer() && (
                <div className="mt-1 text-xs flex items-center gap-2">
                  <span className="text-gray-500">Tipo de mercado:</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    getSelectedCustomer().market_type === 'export' 
                      ? 'bg-blue-100 text-blue-700' 
                      : 'bg-green-100 text-green-700'
                  }`}>
                    {getSelectedCustomer().market_type === 'export' ? '🌎 Exportación' : '🇲🇽 Doméstico'}
                  </span>
                </div>
              )}
            </div>

            {/* Style Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Descripción del Estilo
              </label>
              <textarea
                name="styleDescription"
                value={workOrderData.styleDescription || ""}
                onChange={handleChange}
                rows="2"
                className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                placeholder="Descripción del estilo (Ej: Short Selve, Long Selve, Body MC)"
              />
            </div>

            {/* Color */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Color
              </label>
              <input
                type="text"
                name="color"
                value={workOrderData.color || ""}
                onChange={handleChange}
                className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                placeholder="Ej: Rojo, Azul, Negro"
              />
            </div>

            {/* Quantity Section */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">Cantidades</h3>
              
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Cantidad Total (Pedido Cliente) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  name="totalQuantity"
                  value={workOrderData.totalQuantity || ""}
                  onChange={handleChange}
                  min="0"
                  step="1"
                  className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                  placeholder="Ej: 3000"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Cantidad Almacén (Sobrantes)
                </label>
                <input
                  type="number"
                  name="warehouseStock"
                  value={workOrderData.warehouseStock || ""}
                  onChange={handleChange}
                  min="0"
                  step="1"
                  className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                  placeholder="Ej: 500"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Stock disponible en almacén que puede ser utilizado
                </p>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Cantidad Extras (Merma, Muestras, PP samples)
                </label>
                <input
                  type="number"
                  name="extraQuantity"
                  value={workOrderData.extraQuantity || ""}
                  onChange={handleChange}
                  min="0"
                  step="1"
                  className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                  placeholder="Ej: 10"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Producción adicional para muestras, merma, etc.
                </p>
              </div>

              <div className="pt-2 border-t border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Total a Producir <span className="text-red-500">*</span>
                </label>
                <div className="bg-blue-50 rounded-xl p-3">
                  <p className="text-2xl font-bold text-blue-700">
                    {workOrderData.totalToProduce ? Math.round(workOrderData.totalToProduce).toLocaleString() : "0"} pzas
                  </p>
                  <p className="text-xs text-blue-600 mt-1">
                    Fórmula: Cantidad Total - Almacén + Extras = {Math.round(workOrderData.totalQuantity || 0).toLocaleString()} - {Math.round(workOrderData.warehouseStock || 0).toLocaleString()} + {Math.round(workOrderData.extraQuantity || 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            {/* Commitment Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fecha Compromiso de Entrega <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                name="commitmentDate"
                value={workOrderData.commitmentDate || ""}
                onChange={handleChange}
                className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                required
              />
            </div>

            {/* Fabrics Section - 3 Fabrics */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">Telas (Máximo 3)</h3>
              <p className="text-xs text-gray-500">Seleccione hasta 3 telas para esta orden</p>
              
              <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
                {fabrics.map(fabric => (
                  <label key={fabric.id} className="flex items-center gap-2 p-2 rounded-lg border border-gray-200 hover:bg-gray-100 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedFabrics.includes(fabric.name)}
                      onChange={() => handleFabricToggle(fabric.name)}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                    <span className="text-sm text-gray-700">{fabric.name}</span>
                  </label>
                ))}
              </div>

              {/* Add new fabric */}
              <div className="mt-3 pt-3 border-t border-gray-200">
                <label className="block text-xs text-gray-500 mb-1">
                  Agregar nueva tela
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newFabric}
                    onChange={(e) => setNewFabric(e.target.value)}
                    placeholder="Nombre de la tela"
                    className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                  />
                  <button
                    type="button"
                    onClick={addNewFabric}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200"
                  >
                    Agregar
                  </button>
                </div>
              </div>
              
              {selectedFabrics.length > 0 && (
                <div className="mt-2 p-2 bg-green-50 rounded-lg">
                  <p className="text-xs text-green-700">
                    Telas seleccionadas: {selectedFabrics.join(', ')}
                  </p>
                </div>
              )}
            </div>

            {/* Line and Run Date (Optional) */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Línea Sugerida
                </label>
                <input
                  type="text"
                  name="lineNo"
                  value={workOrderData.lineNo || ""}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                  placeholder="Ej: 1, 2, 3..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha de Producción Sugerida
                </label>
                <input
                  type="date"
                  name="runDate"
                  value={workOrderData.runDate || ""}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                />
              </div>
            </div>

            {/* Error/Message Display */}
            {error && (
              <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-green-50 text-green-700 p-3 rounded-xl text-sm">
                {success}
              </div>
            )}

            {/* Helper Text */}
            <div className="pt-4 text-xs text-gray-500 border-t">
              <p>Los campos marcados con <span className="text-red-500">*</span> son obligatorios</p>
              <p className="mt-1">La orden se creará con estado "Pendiente" y podrá ser asignada a líneas después.</p>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Guardando..." : (isEditMode ? "Actualizar Orden" : "Crear Orden de Trabajo")}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}