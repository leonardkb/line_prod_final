// planning-server.js
require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const bcrypt = require("bcrypt");

const app = express();
app.use(cors());
app.use(express.json());

// Same database configuration as main server
const pool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  database: process.env.PG_DB,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl: false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Helper function to set schema for a client connection
const setSchema = async (client) => {
  await client.query("SET search_path TO prod_db_schema");
};

// ========== AUTHENTICATION MIDDLEWARE ==========

// Helper function to get user from token
const getUserFromToken = async (client, token) => {
  if (!token) return null;
  
  const decoded = Buffer.from(token, "base64").toString("ascii");
  const [userId, timestamp] = decoded.split(":");
  
  const MAX_TOKEN_AGE = 24 * 60 * 60 * 1000;
  if (Date.now() - parseInt(timestamp) > MAX_TOKEN_AGE) {
    return null;
  }
  
  const userResult = await client.query(
    `SELECT id, username, role, line_number, full_name
     FROM users 
     WHERE id = $1 AND is_active = TRUE`,
    [parseInt(userId)]
  );
  
  return userResult.rows[0] || null;
};

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }
    
    const user = await getUserFromToken(client, token);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired token",
      });
    }
    
    req.user = user;
    req.client = client;
    next();
  } catch (err) {
    console.error("❌ Authentication error:", err.message);
    res.status(401).json({
      success: false,
      error: "Invalid authentication token",
    });
  } finally {
    if (req.client) {
      req.client.release();
    }
  }
};

// Role-based authorization middleware
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Access denied. Required roles: ${roles.join(", ")}`,
      });
    }
    next();
  };
};

// Planning roles: engineer, supervisor, skyrina
const planningRoles = ["engineer", "supervisor", "skyrina"];

// ========== PLANNING DASHBOARD ENDPOINTS ==========

/**
 * GET /api/planning/dashboard
 * Get planning dashboard summary
 */
app.get("/api/planning/dashboard", authenticateToken, requireRole(planningRoles), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];
    
    // Get summary statistics
    const summary = await client.query(
      `
      WITH work_order_stats AS (
        SELECT 
          COUNT(*) as total_work_orders,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders,
          COUNT(CASE WHEN status = 'assigned' THEN 1 END) as assigned_orders,
          COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_orders,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders,
          COALESCE(SUM(quantity), 0) as total_quantity
        FROM work_orders
      ),
      assignment_stats AS (
        SELECT 
          COUNT(*) as total_assignments,
          COALESCE(SUM(assigned_quantity), 0) as total_assigned_quantity,
          COUNT(DISTINCT line_no) as lines_utilized
        FROM line_assignments
        WHERE assigned_date = $1 AND status IN ('planned', 'released', 'in_progress')
      ),
      line_capacity AS (
        SELECT 
          COUNT(*) as active_lines,
          COALESCE(SUM(target_pcs), 0) as total_capacity
        FROM line_runs
        WHERE run_date = $1
      )
      SELECT 
        wos.*,
        ast.*,
        lc.active_lines,
        lc.total_capacity,
        CASE 
          WHEN lc.total_capacity > 0 
          THEN (ast.total_assigned_quantity / lc.total_capacity) * 100 
          ELSE 0 
        END as capacity_utilization
      FROM work_order_stats wos
      CROSS JOIN assignment_stats ast
      CROSS JOIN line_capacity lc
      `,
      [targetDate]
    );
    
    // Get upcoming deadlines (assignments ending in next 3 days)
    const upcomingDeadlines = await client.query(
      `
      SELECT 
        la.id,
        la.line_no,
        la.assigned_quantity,
        la.planned_end_date,
        wo.work_order_no,
        wo.customer_name,
        wo.style_description
      FROM line_assignments la
      JOIN work_orders wo ON la.work_order_id = wo.id
      WHERE la.planned_end_date BETWEEN $1 AND $2
        AND la.status IN ('planned', 'released', 'in_progress')
      ORDER BY la.planned_end_date
      LIMIT 10
      `,
      [targetDate, new Date(new Date(targetDate).setDate(new Date(targetDate).getDate() + 3)).toISOString().split('T')[0]]
    );
    
    // Get lines with highest load
    const lineLoad = await client.query(
      `
      SELECT 
        la.line_no,
        COUNT(DISTINCT la.work_order_id) as work_orders_count,
        COALESCE(SUM(la.assigned_quantity), 0) as total_assigned,
        COALESCE(lr.target_pcs, 0) as daily_capacity,
        CASE 
          WHEN COALESCE(lr.target_pcs, 0) > 0 
          THEN (COALESCE(SUM(la.assigned_quantity), 0) / lr.target_pcs) * 100 
          ELSE 0 
        END as load_percentage
      FROM line_assignments la
      LEFT JOIN line_runs lr ON la.line_no = lr.line_no AND lr.run_date = $1
      WHERE la.assigned_date = $1 AND la.status IN ('planned', 'released', 'in_progress')
      GROUP BY la.line_no, lr.target_pcs
      ORDER BY load_percentage DESC
      `,
      [targetDate]
    );
    
    res.json({
      success: true,
      date: targetDate,
      summary: summary.rows[0] || {
        total_work_orders: 0,
        pending_orders: 0,
        assigned_orders: 0,
        in_progress_orders: 0,
        completed_orders: 0,
        total_quantity: 0,
        total_assignments: 0,
        total_assigned_quantity: 0,
        lines_utilized: 0,
        active_lines: 0,
        total_capacity: 0,
        capacity_utilization: 0,
      },
      upcomingDeadlines: upcomingDeadlines.rows,
      lineLoad: lineLoad.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching planning dashboard:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ========== CUSTOMER MANAGEMENT ==========

/**
 * GET /api/customers
 * Get all customers
 */
app.get("/api/customers", authenticateToken, requireRole(planningRoles), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const result = await client.query(`
      SELECT id, name, market_type, is_active, created_at
      FROM customers
      WHERE is_active = true
      ORDER BY name
    `);
    
    res.json({
      success: true,
      customers: result.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching customers:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/customers
 * Create a new customer
 */
app.post("/api/customers", authenticateToken, requireRole(["engineer", "supervisor"]), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { name, market_type } = req.body;
    
    if (!name || !market_type) {
      return res.status(400).json({
        success: false,
        error: "Name and market_type are required"
      });
    }
    
    if (!['export', 'domestico'].includes(market_type)) {
      return res.status(400).json({
        success: false,
        error: "market_type must be 'export' or 'domestico'"
      });
    }
    
    const result = await client.query(
      `INSERT INTO customers (name, market_type) 
       VALUES ($1, $2) 
       RETURNING id, name, market_type`,
      [name, market_type]
    );
    
    res.json({
      success: true,
      customer: result.rows[0]
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({
        success: false,
        error: "Customer name already exists"
      });
    }
    console.error("❌ Error creating customer:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ========== FABRIC MANAGEMENT ==========

/**
 * GET /api/fabrics
 * Get all fabrics
 */
app.get("/api/fabrics", authenticateToken, requireRole(planningRoles), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const result = await client.query(`
      SELECT id, name, is_active, created_at
      FROM fabrics
      WHERE is_active = true
      ORDER BY name
    `);
    
    res.json({
      success: true,
      fabrics: result.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching fabrics:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/fabrics
 * Create a new fabric
 */
app.post("/api/fabrics", authenticateToken, requireRole(["engineer", "supervisor"]), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Fabric name is required"
      });
    }
    
    const result = await client.query(
      `INSERT INTO fabrics (name) 
       VALUES ($1) 
       RETURNING id, name`,
      [name]
    );
    
    res.json({
      success: true,
      fabric: result.rows[0]
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({
        success: false,
        error: "Fabric name already exists"
      });
    }
    console.error("❌ Error creating fabric:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ========== WORK ORDER MANAGEMENT ==========

/**
 * GET /api/work-orders
 * Get all work orders with optional filters
 */
app.get("/api/work-orders", authenticateToken, requireRole(planningRoles), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { status, lineNo, startDate, endDate, search } = req.query;
    
    let query = `
      SELECT 
        id,
        work_order_no,
        quantity,
        customer_name,
        style_description,
        color,
        fabric_supplier,
        style_code,
        line_no,
        run_date,
        created_at,
        updated_at,
        status
      FROM work_orders
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(status);
    }
    
    if (lineNo) {
      query += ` AND line_no = $${paramIndex++}`;
      params.push(lineNo);
    }
    
    if (startDate) {
      query += ` AND run_date >= $${paramIndex++}`;
      params.push(startDate);
    }
    
    if (endDate) {
      query += ` AND run_date <= $${paramIndex++}`;
      params.push(endDate);
    }
    
    if (search) {
      query += ` AND (work_order_no ILIKE $${paramIndex++} OR customer_name ILIKE $${paramIndex++} OR style_description ILIKE $${paramIndex++})`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    query += ` ORDER BY created_at DESC`;
    
    const result = await client.query(query, params);
    
    res.json({
      success: true,
      workOrders: result.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching work orders:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/work-orders/:id
 * Get a specific work order by ID
 */
app.get("/api/work-orders/:id", authenticateToken, requireRole(planningRoles), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { id } = req.params;
    
    const result = await client.query(
      `
      SELECT 
        wo.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', la.id,
              'line_no', la.line_no,
              'assigned_date', la.assigned_date,
              'assigned_quantity', la.assigned_quantity,
              'status', la.status,
              'planned_start_date', la.planned_start_date,
              'planned_end_date', la.planned_end_date,
              'priority', la.priority
            )
          ) FILTER (WHERE la.id IS NOT NULL),
          '[]'
        ) as assignments
      FROM work_orders wo
      LEFT JOIN line_assignments la ON wo.id = la.work_order_id
      WHERE wo.id = $1
      GROUP BY wo.id
      `,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Work order not found",
      });
    }
    
    res.json({
      success: true,
      workOrder: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Error fetching work order:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/work-orders
 * Create a new work order
 */
app.post("/api/work-orders", authenticateToken, requireRole(["engineer", "supervisor"]), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const {
      workOrderNo,
      quantity,
      customerName,
      styleDescription,
      color,
      fabricSupplier,
      styleCode,
      lineNo,
      runDate,
    } = req.body;
    
    // Validate required fields
    if (!workOrderNo || !quantity || !customerName || !styleDescription) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: workOrderNo, quantity, customerName, styleDescription",
      });
    }
    
    // Check if work order number already exists
    const existingCheck = await client.query(
      "SELECT id FROM work_orders WHERE work_order_no = $1",
      [workOrderNo]
    );
    
    if (existingCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Work order number already exists",
      });
    }
    
    const result = await client.query(
      `
      INSERT INTO work_orders (
        work_order_no,
        quantity,
        customer_name,
        style_description,
        color,
        fabric_supplier,
        style_code,
        line_no,
        run_date,
        created_at,
        updated_at,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(), 'pending')
      RETURNING id, work_order_no, quantity, customer_name, style_description, status, created_at
      `,
      [
        workOrderNo,
        parseFloat(quantity),
        customerName,
        styleDescription,
        color || null,
        fabricSupplier || null,
        styleCode || null,
        lineNo || null,
        runDate || null,
      ]
    );
    
    res.json({
      success: true,
      message: "Work order created successfully",
      workOrder: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Error creating work order:", err.message);
    
    if (err.code === "23505") {
      return res.status(400).json({
        success: false,
        error: "Work order number already exists",
      });
    }
    
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/work-orders/:id
 * Update an existing work order
 */
app.put("/api/work-orders/:id", authenticateToken, requireRole(["engineer", "supervisor"]), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { id } = req.params;
    const {
      workOrderNo,
      quantity,
      customerName,
      styleDescription,
      color,
      fabricSupplier,
      styleCode,
      lineNo,
      runDate,
      status,
    } = req.body;
    
    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (workOrderNo !== undefined) {
      updates.push(`work_order_no = $${paramIndex++}`);
      values.push(workOrderNo);
    }
    
    if (quantity !== undefined) {
      updates.push(`quantity = $${paramIndex++}`);
      values.push(parseFloat(quantity));
    }
    
    if (customerName !== undefined) {
      updates.push(`customer_name = $${paramIndex++}`);
      values.push(customerName);
    }
    
    if (styleDescription !== undefined) {
      updates.push(`style_description = $${paramIndex++}`);
      values.push(styleDescription);
    }
    
    if (color !== undefined) {
      updates.push(`color = $${paramIndex++}`);
      values.push(color || null);
    }
    
    if (fabricSupplier !== undefined) {
      updates.push(`fabric_supplier = $${paramIndex++}`);
      values.push(fabricSupplier || null);
    }
    
    if (styleCode !== undefined) {
      updates.push(`style_code = $${paramIndex++}`);
      values.push(styleCode || null);
    }
    
    if (lineNo !== undefined) {
      updates.push(`line_no = $${paramIndex++}`);
      values.push(lineNo || null);
    }
    
    if (runDate !== undefined) {
      updates.push(`run_date = $${paramIndex++}`);
      values.push(runDate || null);
    }
    
    if (status !== undefined) {
      const validStatuses = ['pending', 'assigned', 'in_progress', 'completed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: "Invalid status",
        });
      }
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    
    updates.push(`updated_at = NOW()`);
    
    if (updates.length === 1) {
      return res.status(400).json({
        success: false,
        error: "No fields to update",
      });
    }
    
    values.push(id);
    
    const query = `
      UPDATE work_orders 
      SET ${updates.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING id, work_order_no, quantity, customer_name, style_description, status, updated_at
    `;
    
    const result = await client.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Work order not found",
      });
    }
    
    res.json({
      success: true,
      message: "Work order updated successfully",
      workOrder: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Error updating work order:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/work-orders/:id/status
 * Update work order status
 */
app.put("/api/work-orders/:id/status", authenticateToken, requireRole(["engineer", "supervisor"]), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { id } = req.params;
    const { status } = req.body;
    
    const validStatuses = ['pending', 'assigned', 'in_progress', 'completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status. Must be one of: " + validStatuses.join(', '),
      });
    }
    
    const result = await client.query(
      `
      UPDATE work_orders
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, work_order_no, status
      `,
      [status, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Work order not found" });
    }
    
    res.json({
      success: true,
      message: "Work order status updated",
      workOrder: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Error updating work order status:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/work-orders/:id
 * Soft delete a work order
 */
app.delete("/api/work-orders/:id", authenticateToken, requireRole(["engineer", "supervisor"]), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");
    
    const { id } = req.params;
    
    // Check if work order has active assignments
    const assignmentsCheck = await client.query(
      `
      SELECT id FROM line_assignments 
      WHERE work_order_id = $1 AND status IN ('planned', 'released', 'in_progress')
      `,
      [id]
    );
    
    if (assignmentsCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Cannot delete work order with active assignments. Cancel assignments first.",
      });
    }
    
    // Soft delete by setting status to 'cancelled'
    const result = await client.query(
      `
      UPDATE work_orders
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1 AND status != 'completed'
      RETURNING id, work_order_no
      `,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Work order not found or already completed",
      });
    }
    
    await client.query("COMMIT");
    
    res.json({
      success: true,
      message: "Work order cancelled successfully",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error cancelling work order:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// Add this to planning-server.js if not already present
app.get("/api/line-runs", authenticateToken, requireRole(planningRoles), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const result = await client.query(`
      SELECT 
        id,
        line_no,
        run_date,
        style,
        operators_count,
        working_hours,
        sam_minutes,
        efficiency,
        target_pcs,
        target_per_hour,
        created_at
      FROM line_runs
      ORDER BY run_date DESC, line_no
    `);
    
    res.json({
      success: true,
      runs: result.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching line runs:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ========== LINE ASSIGNMENTS ==========

/**
 * GET /api/line-assignments
 * Get all line assignments with optional filters
 */
app.get("/api/line-assignments", authenticateToken, requireRole(planningRoles), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { lineNo, date, status, workOrderId, startDate, endDate } = req.query;
    
    let query = `
      SELECT 
        la.id,
        la.work_order_id,
        la.line_run_id,
        la.line_no,
        la.assigned_date,
        la.assigned_quantity,
        la.available_minutes,
        la.required_production_rate,
        la.planned_start_date,
        la.planned_end_date,
        la.priority,
        la.created_at,
        la.updated_at,
        la.status,
        wo.work_order_no,
        wo.customer_name,
        wo.style_description,
        wo.color,
        wo.style_code,
        wo.quantity as total_quantity,
        lr.operators_count,
        lr.working_hours,
        lr.target_pcs,
        lr.sam_minutes,
        lr.efficiency
      FROM line_assignments la
      JOIN work_orders wo ON la.work_order_id = wo.id
      LEFT JOIN line_runs lr ON la.line_run_id = lr.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (lineNo) {
      query += ` AND la.line_no = $${paramIndex++}`;
      params.push(lineNo);
    }
    
    if (date) {
      query += ` AND la.assigned_date = $${paramIndex++}`;
      params.push(date);
    }
    
    if (startDate) {
      query += ` AND la.assigned_date >= $${paramIndex++}`;
      params.push(startDate);
    }
    
    if (endDate) {
      query += ` AND la.assigned_date <= $${paramIndex++}`;
      params.push(endDate);
    }
    
    if (status) {
      query += ` AND la.status = $${paramIndex++}`;
      params.push(status);
    }
    
    if (workOrderId) {
      query += ` AND la.work_order_id = $${paramIndex++}`;
      params.push(workOrderId);
    }
    
    query += ` ORDER BY la.priority DESC, la.assigned_date, la.created_at DESC`;
    
    const result = await client.query(query, params);
    
    res.json({
      success: true,
      assignments: result.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching line assignments:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/line-assignments/:id
 * Get a specific line assignment by ID
 */
app.get("/api/line-assignments/:id", authenticateToken, requireRole(planningRoles), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { id } = req.params;
    
    const result = await client.query(
      `
      SELECT 
        la.*,
        wo.work_order_no,
        wo.customer_name,
        wo.style_description,
        wo.color,
        wo.fabric_supplier,
        wo.style_code,
        wo.quantity as total_quantity,
        lr.operators_count,
        lr.working_hours,
        lr.target_pcs,
        lr.sam_minutes,
        lr.efficiency,
        lr.target_per_hour
      FROM line_assignments la
      JOIN work_orders wo ON la.work_order_id = wo.id
      LEFT JOIN line_runs lr ON la.line_run_id = lr.id
      WHERE la.id = $1
      `,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Assignment not found",
      });
    }
    
    res.json({
      success: true,
      assignment: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Error fetching assignment:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// Helper function to update work order status based on assignments
const updateWorkOrderStatus = async (client, workOrderId) => {
  const workOrderResult = await client.query(
    `SELECT quantity FROM work_orders WHERE id = $1`,
    [workOrderId]
  );
  
  if (workOrderResult.rows.length === 0) return;
  
  const totalQuantity = parseFloat(workOrderResult.rows[0].quantity);
  
  const assignmentsResult = await client.query(
    `SELECT COALESCE(SUM(assigned_quantity), 0) as total_assigned
     FROM line_assignments
     WHERE work_order_id = $1 AND status NOT IN ('cancelled')`,
    [workOrderId]
  );
  
  const totalAssigned = parseFloat(assignmentsResult.rows[0].total_assigned);
  
  let newStatus = 'pending';
  if (totalAssigned >= totalQuantity) {
    newStatus = 'completed';
  } else if (totalAssigned > 0) {
    newStatus = 'assigned';
  }
  
  await client.query(
    `UPDATE work_orders SET status = $1, updated_at = NOW() WHERE id = $2`,
    [newStatus, workOrderId]
  );
  
  return { totalAssigned, totalQuantity, newStatus };
};

/**
 * POST /api/line-assignments
 * Create a new line assignment
 */
app.post("/api/line-assignments", authenticateToken, requireRole(["engineer", "supervisor"]), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");
    
    const {
      workOrderId,
      lineNo,
      assignedDate,
      quantity,
      plannedStartDate,
      plannedEndDate,
      priority = 0,
    } = req.body;
    
    // Validate required fields
    if (!workOrderId || !lineNo || !assignedDate || !quantity) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: workOrderId, lineNo, assignedDate, quantity",
      });
    }
    
    // Get work order details
    const workOrderResult = await client.query(
      "SELECT work_order_no, quantity as total_quantity, status FROM work_orders WHERE id = $1",
      [workOrderId]
    );
    
    if (workOrderResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Work order not found",
      });
    }
    
    const workOrder = workOrderResult.rows[0];
    
    // Check if work order is already completed
    if (workOrder.status === 'completed') {
      return res.status(400).json({
        success: false,
        error: "Cannot assign to a completed work order",
      });
    }
    
    // Get line run for the specified line and date
    const lineRunResult = await client.query(
      `
      SELECT id, working_hours, operators_count, target_pcs, target_per_hour, sam_minutes, efficiency
      FROM line_runs
      WHERE line_no = $1 AND run_date = $2
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [lineNo, assignedDate]
    );
    
    let lineRunId = null;
    let availableMinutes = 0;
    let requiredProductionRate = 0;
    let lineCapacity = 0;
    
    if (lineRunResult.rows.length > 0) {
      const lineRun = lineRunResult.rows[0];
      lineRunId = lineRun.id;
      availableMinutes = lineRun.operators_count * lineRun.working_hours * 60;
      requiredProductionRate = lineRun.target_per_hour || 0;
      lineCapacity = lineRun.target_pcs;
    } else {
      // If no line run exists for that date, get the most recent line run for capacity estimation
      const recentLineRun = await client.query(
        `
        SELECT working_hours, operators_count, target_pcs, target_per_hour
        FROM line_runs
        WHERE line_no = $1
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [lineNo]
      );
      
      if (recentLineRun.rows.length > 0) {
        const lineRun = recentLineRun.rows[0];
        availableMinutes = lineRun.operators_count * lineRun.working_hours * 60;
        requiredProductionRate = lineRun.target_per_hour || 0;
        lineCapacity = lineRun.target_pcs;
      } else {
        // Default values if no line run exists
        availableMinutes = 8 * 60; // 8 hours * 60 minutes
        requiredProductionRate = quantity / 8; // Rough estimate
        lineCapacity = quantity; // Assume capacity equals quantity
      }
    }
    
    // Check total assigned quantity for this work order
    const existingAssignmentsTotal = await client.query(
      `
      SELECT COALESCE(SUM(assigned_quantity), 0) as total_assigned
      FROM line_assignments
      WHERE work_order_id = $1 AND status != 'cancelled'
      `,
      [workOrderId]
    );
    
    const totalAssigned = parseFloat(existingAssignmentsTotal.rows[0].total_assigned);
    const remainingToAssign = workOrder.total_quantity - totalAssigned;
    
    if (parseFloat(quantity) > remainingToAssign) {
      return res.status(400).json({
        success: false,
        error: `Cannot assign ${quantity} pieces. Only ${remainingToAssign} pieces remaining for this work order.`,
      });
    }
    
    // Check if line has enough capacity for the date
    const existingLineAssignments = await client.query(
      `
      SELECT COALESCE(SUM(assigned_quantity), 0) as total_assigned
      FROM line_assignments
      WHERE line_no = $1 AND assigned_date = $2 AND status IN ('planned', 'released', 'in_progress')
      `,
      [lineNo, assignedDate]
    );
    
    const totalLineAssigned = parseFloat(existingLineAssignments.rows[0].total_assigned);
    const remainingLineCapacity = lineCapacity - totalLineAssigned;
    
    if (parseFloat(quantity) > remainingLineCapacity) {
      return res.status(400).json({
        success: false,
        error: `Insufficient capacity on Line ${lineNo} for ${assignedDate}. Available: ${remainingLineCapacity.toFixed(0)} pieces`,
      });
    }
    
    // Calculate production days based on quantity and line capacity
    const daysNeeded = quantity / lineCapacity;
    const calculatedEndDate = plannedEndDate || new Date(new Date(plannedStartDate || assignedDate).setDate(
      new Date(plannedStartDate || assignedDate).getDate() + Math.ceil(daysNeeded)
    )).toISOString().split('T')[0];
    
    // Create assignment
    const result = await client.query(
      `
      INSERT INTO line_assignments (
        work_order_id,
        line_run_id,
        line_no,
        assigned_date,
        assigned_quantity,
        available_minutes,
        required_production_rate,
        planned_start_date,
        planned_end_date,
        priority,
        created_at,
        updated_at,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), 'planned')
      RETURNING id
      `,
      [
        workOrderId,
        lineRunId,
        lineNo,
        assignedDate,
        parseFloat(quantity),
        availableMinutes,
        requiredProductionRate,
        plannedStartDate || null,
        calculatedEndDate,
        priority,
      ]
    );
    
    // Update work order status
    await updateWorkOrderStatus(client, workOrderId);
    
    await client.query("COMMIT");
    
    res.json({
      success: true,
      message: `Work order assigned to Line ${lineNo} successfully`,
      assignmentId: result.rows[0].id,
      daysNeeded: Math.ceil(daysNeeded * 10) / 10,
      endDate: calculatedEndDate,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error creating line assignment:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/line-assignments/:id
 * Update an existing line assignment
 */
app.put("/api/line-assignments/:id", authenticateToken, requireRole(["engineer", "supervisor"]), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");
    
    const { id } = req.params;
    const {
      assignedQuantity,
      plannedStartDate,
      plannedEndDate,
      priority,
      status,
    } = req.body;
    
    // Get current assignment
    const currentAssignment = await client.query(
      `
      SELECT la.*, wo.quantity as total_quantity, wo.work_order_no
      FROM line_assignments la
      JOIN work_orders wo ON la.work_order_id = wo.id
      WHERE la.id = $1
      `,
      [id]
    );
    
    if (currentAssignment.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Assignment not found",
      });
    }
    
    const assignment = currentAssignment.rows[0];
    
    // Build update query
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (assignedQuantity !== undefined && assignedQuantity !== assignment.assigned_quantity) {
      // Check if changing quantity affects capacity
      const quantityDiff = parseFloat(assignedQuantity) - assignment.assigned_quantity;
      
      if (quantityDiff > 0) {
        // Need to check if there's additional capacity
        const lineAssignments = await client.query(
          `
          SELECT COALESCE(SUM(assigned_quantity), 0) as total_assigned
          FROM line_assignments
          WHERE line_no = $1 AND assigned_date = $2 
            AND id != $3 AND status IN ('planned', 'released', 'in_progress')
          `,
          [assignment.line_no, assignment.assigned_date, id]
        );
        
        const totalLineAssigned = parseFloat(lineAssignments.rows[0].total_assigned);
        
        // Get line capacity
        const lineRun = await client.query(
          `
          SELECT target_pcs FROM line_runs 
          WHERE line_no = $1 AND run_date = $2
          LIMIT 1
          `,
          [assignment.line_no, assignment.assigned_date]
        );
        
        const lineCapacity = lineRun.rows.length > 0 ? lineRun.rows[0].target_pcs : assignment.assigned_quantity;
        const remainingCapacity = lineCapacity - totalLineAssigned;
        
        if (quantityDiff > remainingCapacity) {
          return res.status(400).json({
            success: false,
            error: `Insufficient capacity to increase quantity. Available: ${remainingCapacity.toFixed(0)} pieces`,
          });
        }
      }
      
      updates.push(`assigned_quantity = $${paramIndex++}`);
      values.push(parseFloat(assignedQuantity));
    }
    
    if (plannedStartDate !== undefined) {
      updates.push(`planned_start_date = $${paramIndex++}`);
      values.push(plannedStartDate || null);
    }
    
    if (plannedEndDate !== undefined) {
      updates.push(`planned_end_date = $${paramIndex++}`);
      values.push(plannedEndDate || null);
    }
    
    if (priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      values.push(priority);
    }
    
    if (status !== undefined) {
      const validStatuses = ['planned', 'released', 'in_progress', 'completed', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: "Invalid status",
        });
      }
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    
    updates.push(`updated_at = NOW()`);
    
    if (updates.length === 1) {
      return res.status(400).json({
        success: false,
        error: "No fields to update",
      });
    }
    
    values.push(id);
    
    const query = `
      UPDATE line_assignments 
      SET ${updates.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING id
    `;
    
    await client.query(query, values);
    
    // Update work order status
    await updateWorkOrderStatus(client, assignment.work_order_id);
    
    await client.query("COMMIT");
    
    res.json({
      success: true,
      message: "Assignment updated successfully",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error updating assignment:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/line-assignments/:id/status
 * Update assignment status
 */
app.put("/api/line-assignments/:id/status", authenticateToken, requireRole(["engineer", "supervisor"]), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");
    
    const { id } = req.params;
    const { status } = req.body;
    
    const validStatuses = ['planned', 'released', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status",
      });
    }
    
    // Get assignment details
    const assignmentResult = await client.query(
      `
      SELECT work_order_id
      FROM line_assignments
      WHERE id = $1
      `,
      [id]
    );
    
    if (assignmentResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Assignment not found" });
    }
    
    const workOrderId = assignmentResult.rows[0].work_order_id;
    
    // Update assignment status
    await client.query(
      `
      UPDATE line_assignments
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      `,
      [status, id]
    );
    
    // Update work order status
    await updateWorkOrderStatus(client, workOrderId);
    
    await client.query("COMMIT");
    
    res.json({
      success: true,
      message: `Assignment status updated to ${status}`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error updating assignment status:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/line-assignments/:id
 * Cancel/delete an assignment
 */
app.delete("/api/line-assignments/:id", authenticateToken, requireRole(["engineer", "supervisor"]), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");
    
    const { id } = req.params;
    
    // Get assignment details
    const assignmentResult = await client.query(
      `
      SELECT work_order_id, status
      FROM line_assignments
      WHERE id = $1
      `,
      [id]
    );
    
    if (assignmentResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Assignment not found" });
    }
    
    const { work_order_id, status } = assignmentResult.rows[0];
    
    // Soft delete by setting status to 'cancelled'
    await client.query(
      `
      UPDATE line_assignments
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1
      `,
      [id]
    );
    
    // Update work order status
    await updateWorkOrderStatus(client, work_order_id);
    
    await client.query("COMMIT");
    
    res.json({
      success: true,
      message: "Assignment cancelled successfully",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error cancelling assignment:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ========== CAPACITY PLANNING ENDPOINTS ==========

/**
 * GET /api/planning/available-lines
 * Get available lines for a specific date with their capacity
 */
app.get("/api/planning/available-lines", authenticateToken, requireRole(planningRoles), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json({
        success: false,
        error: "Date parameter is required",
      });
    }
    
    // Get all line runs for the date
    const lineRuns = await client.query(
      `
      SELECT 
        lr.id,
        lr.line_no,
        lr.operators_count,
        lr.working_hours,
        lr.target_pcs,
        lr.target_per_hour,
        lr.sam_minutes,
        lr.efficiency,
        lr.style
      FROM line_runs lr
      WHERE lr.run_date = $1
      ORDER BY lr.line_no
      `,
      [date]
    );
    
    // Get existing assignments for the date
    const assignments = await client.query(
      `
      SELECT 
        line_no,
        COALESCE(SUM(assigned_quantity), 0) as assigned_quantity
      FROM line_assignments
      WHERE assigned_date = $1 AND status IN ('planned', 'released', 'in_progress')
      GROUP BY line_no
      `,
      [date]
    );
    
    const assignedMap = {};
    assignments.rows.forEach(a => {
      assignedMap[a.line_no] = parseFloat(a.assigned_quantity);
    });
    
    // Calculate available capacity for each line
    const availableLines = lineRuns.rows.map(run => {
      const assigned = assignedMap[run.line_no] || 0;
      const available = run.target_pcs - assigned;
      
      return {
        ...run,
        assigned_quantity: assigned,
        available_capacity: Math.max(0, available),
        is_available: available > 0,
        utilization_percentage: run.target_pcs > 0 ? (assigned / run.target_pcs) * 100 : 0,
      };
    });
    
    res.json({
      success: true,
      date,
      lines: availableLines,
    });
  } catch (err) {
    console.error("❌ Error fetching available lines:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/planning/line-capacity
 * Get line capacity for a date range
 */
app.get("/api/planning/line-capacity", authenticateToken, requireRole(planningRoles), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { startDate, endDate, lineNo } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "startDate and endDate are required",
      });
    }
    
    let query = `
      SELECT 
        lr.run_date,
        lr.line_no,
        lr.target_pcs as daily_capacity,
        lr.operators_count,
        lr.working_hours,
        lr.sam_minutes,
        lr.efficiency,
        lr.style,
        COALESCE(la.assigned_quantity, 0) as assigned_quantity,
        COALESCE(la.work_orders_count, 0) as work_orders_count
      FROM line_runs lr
      LEFT JOIN (
        SELECT 
          assigned_date,
          line_no,
          COALESCE(SUM(assigned_quantity), 0) as assigned_quantity,
          COUNT(DISTINCT work_order_id) as work_orders_count
        FROM line_assignments
        WHERE assigned_date BETWEEN $1 AND $2
          AND status IN ('planned', 'released', 'in_progress', 'completed')
        GROUP BY assigned_date, line_no
      ) la ON lr.run_date = la.assigned_date AND lr.line_no = la.line_no
      WHERE lr.run_date BETWEEN $1 AND $2
    `;
    
    const params = [startDate, endDate];
    let paramIndex = 3;
    
    if (lineNo) {
      query += ` AND lr.line_no = $${paramIndex++}`;
      params.push(lineNo);
    }
    
    query += ` ORDER BY lr.run_date, lr.line_no`;
    
    const result = await client.query(query, params);
    
    // Calculate utilization percentage for each record
    const capacityData = result.rows.map(row => ({
      ...row,
      daily_capacity: parseFloat(row.daily_capacity) || 0,
      assigned_quantity: parseFloat(row.assigned_quantity) || 0,
      utilization_percentage: row.daily_capacity > 0 ? (parseFloat(row.assigned_quantity) / row.daily_capacity) * 100 : 0,
      available_capacity: Math.max(0, (parseFloat(row.daily_capacity) || 0) - (parseFloat(row.assigned_quantity) || 0)),
    }));
    
    res.json({
      success: true,
      startDate,
      endDate,
      capacityData,
    });
  } catch (err) {
    console.error("❌ Error fetching line capacity:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/planning/work-order-progress/:id
 * Get detailed progress for a specific work order
 */
app.get("/api/planning/work-order-progress/:id", authenticateToken, requireRole(planningRoles), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { id } = req.params;
    
    // Get work order details with assignments
    const workOrder = await client.query(
      `
      SELECT 
        wo.*,
        COALESCE(SUM(la.assigned_quantity), 0) as total_assigned,
        COUNT(la.id) as assignments_count,
        COUNT(CASE WHEN la.status = 'completed' THEN 1 END) as completed_assignments
      FROM work_orders wo
      LEFT JOIN line_assignments la ON wo.id = la.work_order_id AND la.status != 'cancelled'
      WHERE wo.id = $1
      GROUP BY wo.id
      `,
      [id]
    );
    
    if (workOrder.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Work order not found",
      });
    }
    
    const wo = workOrder.rows[0];
    
    // Calculate progress
    const progress = {
      total_quantity: parseFloat(wo.quantity),
      assigned_quantity: parseFloat(wo.total_assigned),
      remaining_quantity: Math.max(0, parseFloat(wo.quantity) - parseFloat(wo.total_assigned)),
      assignments_count: parseInt(wo.assignments_count) || 0,
      completed_assignments: parseInt(wo.completed_assignments) || 0,
      percentage_assigned: parseFloat(wo.quantity) > 0 ? (parseFloat(wo.total_assigned) / parseFloat(wo.quantity)) * 100 : 0,
      status: wo.status,
    };
    
    // Get detailed assignments with production data
    const assignments = await client.query(
      `
      SELECT 
        la.*,
        lr.operators_count,
        lr.working_hours,
        lr.target_per_hour,
        lr.target_pcs as line_capacity
      FROM line_assignments la
      LEFT JOIN line_runs lr ON la.line_run_id = lr.id
      WHERE la.work_order_id = $1 AND la.status != 'cancelled'
      ORDER BY la.assigned_date, la.priority DESC
      `,
      [id]
    );
    
    res.json({
      success: true,
      workOrder: wo,
      progress,
      assignments: assignments.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching work order progress:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ========== BULK OPERATIONS ==========

/**
 * POST /api/planning/bulk-assign
 * Bulk assign multiple work orders to lines
 */
app.post("/api/planning/bulk-assign", authenticateToken, requireRole(["engineer", "supervisor"]), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");
    
    const { assignments } = req.body;
    
    if (!assignments || !Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Assignments array is required",
      });
    }
    
    const results = [];
    const errors = [];
    
    for (const assign of assignments) {
      try {
        const {
          workOrderId,
          lineNo,
          assignedDate,
          quantity,
          priority = 0,
        } = assign;
        
        // Validate each assignment
        if (!workOrderId || !lineNo || !assignedDate || !quantity) {
          errors.push({
            ...assign,
            error: "Missing required fields",
          });
          continue;
        }
        
        // Check work order exists and has capacity
        const workOrderResult = await client.query(
          "SELECT quantity, status FROM work_orders WHERE id = $1",
          [workOrderId]
        );
        
        if (workOrderResult.rows.length === 0) {
          errors.push({
            ...assign,
            error: "Work order not found",
          });
          continue;
        }
        
        const workOrder = workOrderResult.rows[0];
        
        if (workOrder.status === 'completed') {
          errors.push({
            ...assign,
            error: "Work order already completed",
          });
          continue;
        }
        
        // Check line capacity
        const lineRun = await client.query(
          `
          SELECT target_pcs FROM line_runs 
          WHERE line_no = $1 AND run_date = $2
          LIMIT 1
          `,
          [lineNo, assignedDate]
        );
        
        const lineCapacity = lineRun.rows.length > 0 ? lineRun.rows[0].target_pcs : quantity;
        
        const existingAssignments = await client.query(
          `
          SELECT COALESCE(SUM(assigned_quantity), 0) as total_assigned
          FROM line_assignments
          WHERE line_no = $1 AND assigned_date = $2 AND status IN ('planned', 'released', 'in_progress')
          `,
          [lineNo, assignedDate]
        );
        
        const totalAssigned = parseFloat(existingAssignments.rows[0].total_assigned);
        const remainingCapacity = lineCapacity - totalAssigned;
        
        if (parseFloat(quantity) > remainingCapacity) {
          errors.push({
            ...assign,
            error: `Insufficient capacity. Available: ${remainingCapacity.toFixed(0)} pieces`,
          });
          continue;
        }
        
        // Get line run ID if available
        const lineRunIdResult = await client.query(
          `
          SELECT id FROM line_runs 
          WHERE line_no = $1 AND run_date = $2
          LIMIT 1
          `,
          [lineNo, assignedDate]
        );
        
        const lineRunId = lineRunIdResult.rows.length > 0 ? lineRunIdResult.rows[0].id : null;
        
        // Create assignment
        const result = await client.query(
          `
          INSERT INTO line_assignments (
            work_order_id,
            line_run_id,
            line_no,
            assigned_date,
            assigned_quantity,
            priority,
            created_at,
            updated_at,
            status
          )
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), 'planned')
          RETURNING id
          `,
          [
            workOrderId,
            lineRunId,
            lineNo,
            assignedDate,
            parseFloat(quantity),
            priority,
          ]
        );
        
        results.push({
          ...assign,
          assignmentId: result.rows[0].id,
          success: true,
        });
      } catch (err) {
        errors.push({
          ...assign,
          error: err.message,
        });
      }
    }
    
    // Update work order statuses for all affected work orders
    const affectedWorkOrders = new Set(assignments.map(a => a.workOrderId));
    for (const woId of affectedWorkOrders) {
      await updateWorkOrderStatus(client, woId);
    }
    
    await client.query("COMMIT");
    
    res.json({
      success: true,
      message: `Bulk assignment completed: ${results.length} successful, ${errors.length} failed`,
      results,
      errors,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error in bulk assignment:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ========== CAPACITY REPORT ==========

/**
 * GET /api/planning/capacity-report
 * Generate capacity report for a date range
 */
app.get("/api/planning/capacity-report", authenticateToken, requireRole(planningRoles), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "startDate and endDate are required",
      });
    }
    
    const report = await client.query(
      `
      WITH dates AS (
        SELECT generate_series(
          $1::date,
          $2::date,
          '1 day'::interval
        )::date as report_date
      ),
      line_capacity AS (
        SELECT 
          lr.run_date,
          lr.line_no,
          lr.target_pcs as daily_capacity,
          lr.operators_count,
          lr.working_hours,
          lr.sam_minutes,
          lr.efficiency,
          lr.style
        FROM line_runs lr
        WHERE lr.run_date BETWEEN $1 AND $2
      ),
      daily_assignments AS (
        SELECT 
          la.assigned_date,
          la.line_no,
          COALESCE(SUM(la.assigned_quantity), 0) as assigned_quantity,
          COUNT(DISTINCT la.work_order_id) as work_orders_count
        FROM line_assignments la
        WHERE la.assigned_date BETWEEN $1 AND $2
          AND la.status IN ('planned', 'released', 'in_progress', 'completed')
        GROUP BY la.assigned_date, la.line_no
      )
      SELECT 
        d.report_date,
        lc.line_no,
        lc.daily_capacity,
        lc.operators_count,
        lc.working_hours,
        lc.sam_minutes,
        lc.efficiency,
        lc.style,
        COALESCE(da.assigned_quantity, 0) as assigned_quantity,
        COALESCE(da.work_orders_count, 0) as work_orders_count,
        CASE 
          WHEN lc.daily_capacity > 0 
          THEN (COALESCE(da.assigned_quantity, 0) / lc.daily_capacity) * 100 
          ELSE 0 
        END as utilization_percentage,
        GREATEST(0, lc.daily_capacity - COALESCE(da.assigned_quantity, 0)) as available_capacity
      FROM dates d
      CROSS JOIN line_capacity lc
      LEFT JOIN daily_assignments da ON d.report_date = da.assigned_date AND lc.line_no = da.line_no
      ORDER BY d.report_date, lc.line_no
      `,
      [startDate, endDate]
    );
    
    // Calculate summary statistics
    const totalDays = new Set(report.rows.map(r => r.report_date)).size;
    const totalLines = new Set(report.rows.map(r => r.line_no)).size;
    const totalCapacity = report.rows.reduce((sum, row) => sum + (parseFloat(row.daily_capacity) || 0), 0);
    const totalAssigned = report.rows.reduce((sum, row) => sum + (parseFloat(row.assigned_quantity) || 0), 0);
    const totalUtilization = totalCapacity > 0 ? (totalAssigned / totalCapacity) * 100 : 0;
    
    const summary = {
      total_days: totalDays,
      total_lines: totalLines,
      total_capacity: Math.round(totalCapacity * 100) / 100,
      total_assigned: Math.round(totalAssigned * 100) / 100,
      total_available: Math.round((totalCapacity - totalAssigned) * 100) / 100,
      average_utilization: Math.round(totalUtilization * 100) / 100,
    };
    
    res.json({
      success: true,
      startDate,
      endDate,
      summary,
      report: report.rows.map(row => ({
        ...row,
        daily_capacity: parseFloat(row.daily_capacity) || 0,
        assigned_quantity: parseFloat(row.assigned_quantity) || 0,
        utilization_percentage: Math.round((parseFloat(row.utilization_percentage) || 0) * 100) / 100,
        available_capacity: Math.max(0, parseFloat(row.available_capacity) || 0),
      })),
    });
  } catch (err) {
    console.error("❌ Error generating capacity report:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ========== STATISTICS ENDPOINTS ==========

/**
 * GET /api/planning/statistics
 * Get overall planning statistics
 */
app.get("/api/planning/statistics", authenticateToken, requireRole(planningRoles), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const result = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM work_orders WHERE status != 'cancelled') as total_work_orders,
        (SELECT COUNT(*) FROM work_orders WHERE status = 'pending') as pending_work_orders,
        (SELECT COUNT(*) FROM work_orders WHERE status = 'assigned') as assigned_work_orders,
        (SELECT COUNT(*) FROM work_orders WHERE status = 'in_progress') as in_progress_work_orders,
        (SELECT COUNT(*) FROM work_orders WHERE status = 'completed') as completed_work_orders,
        (SELECT COUNT(*) FROM line_assignments WHERE status IN ('planned', 'released', 'in_progress')) as active_assignments,
        (SELECT COUNT(DISTINCT line_no) FROM line_runs WHERE run_date >= CURRENT_DATE) as active_lines_today,
        (SELECT COALESCE(SUM(assigned_quantity), 0) FROM line_assignments WHERE assigned_date >= CURRENT_DATE AND status IN ('planned', 'released', 'in_progress')) as total_assigned_today,
        (SELECT COALESCE(SUM(target_pcs), 0) FROM line_runs WHERE run_date = CURRENT_DATE) as total_capacity_today
    `);
    
    res.json({
      success: true,
      statistics: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Error fetching planning statistics:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/planning/recalculate-status
 * Recalculate all work order statuses based on assignments
 */
app.post("/api/planning/recalculate-status", authenticateToken, requireRole(["engineer", "supervisor"]), async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");
    
    // Get all work orders
    const workOrders = await client.query(
      `SELECT id, quantity FROM work_orders WHERE status != 'cancelled'`
    );
    
    let updated = 0;
    for (const wo of workOrders.rows) {
      const result = await updateWorkOrderStatus(client, wo.id);
      if (result && result.newStatus !== wo.status) {
        updated++;
      }
    }
    
    await client.query("COMMIT");
    
    res.json({
      success: true,
      message: `Recalculated ${workOrders.rows.length} work orders, updated ${updated}`,
      updated
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error recalculating statuses:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ========== HEALTH CHECK ==========

app.get("/api/health", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("SELECT 1");
    res.json({
      success: true,
      message: "Planning server is running",
      schema: "prod_db_schema",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Database connection failed",
    });
  } finally {
    client.release();
  }
});

// ========== SERVER STARTUP ==========

const PORT = process.env.PLANNING_PORT || 5001;

// Test database connection on startup
async function testConnection() {
  const client = await pool.connect();
  try {
    await setSchema(client);
    console.log("✅ Connected to PostgreSQL successfully");
    const res = await client.query("SELECT current_schema(), current_database()");
    console.log("📋 Schema:", res.rows[0].current_schema);
    console.log("📋 Database:", res.rows[0].current_database);
    console.log("🕒 Server time:", new Date());
    client.release();
  } catch (err) {
    console.error("❌ Database connection failed");
    console.error(err.message);
    process.exit(1);
  }
}

testConnection();

app.listen(PORT, () => {
  console.log(`🚀 Planning Server running on port ${PORT}`);
  console.log(`📁 Using schema: prod_db_schema`);
  console.log(`🗄️ Database: ${process.env.PG_DB || "prod_db"}`);
});