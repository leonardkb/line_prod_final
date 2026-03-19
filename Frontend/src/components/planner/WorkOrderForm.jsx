// [file name]: WorkOrderForm.jsx
export default function WorkOrderForm({ workOrderData, onChange, selectedRun }) {
  const handleChange = (e) => {
    const { name, value } = e.target;
    onChange(name, value);
  };

  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="px-5 py-4 border-b">
        <h2 className="font-semibold text-gray-900">Detalles de la Orden de Trabajo</h2>
        <p className="text-sm text-gray-600">
          Complete la información para la nueva orden
        </p>
      </div>

      <div className="p-5">
        <div className="mb-4 p-3 bg-blue-50 rounded-xl">
          <div className="text-xs text-blue-600 mb-1">Estilo seleccionado</div>
          <div className="text-sm font-medium text-blue-900">
            {selectedRun.style} - Línea {selectedRun.line_no}
          </div>
        </div>

        <div className="space-y-4">
          {/* Work Order Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Número de Orden <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="workOrderNo"
              value={workOrderData.workOrderNo}
              onChange={handleChange}
              className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              placeholder="Ej: WO-2024-001"
              required
            />
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cantidad a Producir <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              name="quantity"
              value={workOrderData.quantity}
              onChange={handleChange}
              min="1"
              step="1"
              className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              placeholder="Ej: 5000"
              required
            />
            {workOrderData.quantity && selectedRun && (
              <p className="mt-1 text-xs text-gray-500">
                Esto requerirá aproximadamente{' '}
                {(parseFloat(workOrderData.quantity) / selectedRun.target_pcs).toFixed(1)} días de producción
              </p>
            )}
          </div>

          {/* Customer Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cliente <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="customerName"
              value={workOrderData.customerName}
              onChange={handleChange}
              className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              placeholder="Nombre del cliente"
              required
            />
          </div>

          {/* Style Description (auto-filled but editable) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Descripción del Estilo
            </label>
            <textarea
              name="styleDescription"
              value={workOrderData.styleDescription}
              onChange={handleChange}
              rows="2"
              className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              placeholder="Descripción del estilo"
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
              value={workOrderData.color}
              onChange={handleChange}
              className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              placeholder="Ej: Rojo, Azul, Negro"
            />
          </div>

          {/* Fabric Supplier */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Proveedor de Tela
            </label>
            <input
              type="text"
              name="fabricSupplier"
              value={workOrderData.fabricSupplier}
              onChange={handleChange}
              className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              placeholder="Nombre del proveedor"
            />
          </div>

          {/* Helper Text */}
          <div className="pt-4 text-xs text-gray-500 border-t">
            <p>Los campos marcados con <span className="text-red-500">*</span> son obligatorios</p>
          </div>
        </div>
      </div>
    </div>
  );
}