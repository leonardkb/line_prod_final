require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const bcrypt = require("bcrypt");

const app = express();
app.use(cors());
app.use(express.json());

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

// Create all tables with correct constraints in prod_db_schema
const createAllTables = async () => {
  const client = await pool.connect();
  try {
    console.log("🔄 Creating/verifying database tables in prod_db_schema...");

    await setSchema(client);

    // 0. Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users(
        id BIGSERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'line_leader',
        line_number INT NULL,
        full_name VARCHAR(100) NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_role CHECK (role IN ('engineer', 'line_leader', 'supervisor', 'soporte_it','skyrina')),
        CONSTRAINT chk_line_number CHECK (line_number IS NULL OR (line_number >= 1 AND line_number <= 26))
      );
    `);
    console.log("✅ users table ready in prod_db_schema");

    // 1. Create line_runs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS line_runs(
        id BIGSERIAL PRIMARY KEY,
        line_no TEXT NOT NULL,
        run_date DATE NOT NULL,
        style TEXT NOT NULL,
        operators_count INT NOT NULL DEFAULT 0,
        working_hours NUMERIC(6,2) NOT NULL,
        sam_minutes NUMERIC(10,2) NOT NULL,
        efficiency NUMERIC(4,3) NOT NULL,
        target_pcs NUMERIC(12,2) NOT NULL DEFAULT 0,
        target_per_hour NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_line_run UNIQUE (line_no, run_date, style),
        CONSTRAINT chk_efficiency_range CHECK (efficiency > 0 AND efficiency <= 1),
        CONSTRAINT chk_working_hours_positive CHECK (working_hours > 0),
        CONSTRAINT chk_sam_positive CHECK (sam_minutes > 0)
      );
    `);
    console.log("✅ line_runs table ready in prod_db_schema");

    // 2. Create shift_slots table
    await client.query(`
      CREATE TABLE IF NOT EXISTS shift_slots(
        id BIGSERIAL PRIMARY KEY,
        run_id BIGINT NOT NULL REFERENCES line_runs(id) ON DELETE CASCADE,
        slot_order INT NOT NULL,
        slot_label TEXT NOT NULL,
        slot_start TIME NULL,
        slot_end TIME NULL,
        planned_hours NUMERIC(6,3) NOT NULL,
        UNIQUE (run_id, slot_order),
        UNIQUE (run_id, slot_label),
        CONSTRAINT chk_planned_hours_nonnegative CHECK (planned_hours >= 0)
      );
    `);
    console.log("✅ shift_slots table ready in prod_db_schema");

    // 3. Create run_operators table
    await client.query(`
      CREATE TABLE IF NOT EXISTS run_operators(
        id BIGSERIAL PRIMARY KEY,
        run_id BIGINT NOT NULL REFERENCES line_runs(id) ON DELETE CASCADE,
        operator_no INT NOT NULL,
        operator_name TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (run_id, operator_no),
        CONSTRAINT chk_operator_no_positive CHECK (operator_no > 0)
      );
    `);
    console.log("✅ run_operators table ready in prod_db_schema");

    // 4. Create operator_operations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS operator_operations(
        id BIGSERIAL PRIMARY KEY,
        run_id BIGINT NOT NULL REFERENCES line_runs(id) ON DELETE CASCADE,
        run_operator_id BIGINT NOT NULL REFERENCES run_operators(id) ON DELETE CASCADE,
        operation_name TEXT NOT NULL,
        t1_sec NUMERIC(10,2) NULL,
        t2_sec NUMERIC(10,2) NULL,
        t3_sec NUMERIC(10,2) NULL,
        t4_sec NUMERIC(10,2) NULL,
        t5_sec NUMERIC(10,2) NULL,
        capacity_per_hour NUMERIC(12,3) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (run_operator_id, operation_name)
      );
    `);
    console.log("✅ operator_operations table ready in prod_db_schema");

    // 5. Create operation_hourly_entries table
    await client.query(`
      CREATE TABLE IF NOT EXISTS operation_hourly_entries(
        id BIGSERIAL PRIMARY KEY,
        run_id BIGINT NOT NULL REFERENCES line_runs(id) ON DELETE CASCADE,
        operation_id BIGINT NOT NULL REFERENCES operator_operations(id) ON DELETE CASCADE,
        slot_id BIGINT NOT NULL REFERENCES shift_slots(id) ON DELETE CASCADE,
        stitched_qty NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (operation_id, slot_id),
        CONSTRAINT chk_stitched_qty_nonnegative CHECK (stitched_qty >= 0)
      );
    `);
    console.log("✅ operation_hourly_entries table ready in prod_db_schema");

    // 5.5 Create operation_sewed_entries table (Line Leader actuals)
    await client.query(`
      CREATE TABLE IF NOT EXISTS operation_sewed_entries(
        id BIGSERIAL PRIMARY KEY,
        run_id BIGINT NOT NULL REFERENCES line_runs(id) ON DELETE CASCADE,
        operation_id BIGINT NOT NULL REFERENCES operator_operations(id) ON DELETE CASCADE,
        slot_id BIGINT NOT NULL REFERENCES shift_slots(id) ON DELETE CASCADE,
        sewed_qty NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (operation_id, slot_id),
        CONSTRAINT chk_sewed_qty_nonnegative CHECK (sewed_qty >= 0)
      );
    `);
    console.log("✅ operation_sewed_entries table ready in prod_db_schema");
// 7 Create line_balancing_assignments table
await client.query(`
  CREATE TABLE IF NOT EXISTS line_balancing_assignments (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES line_runs(id) ON DELETE CASCADE,
    source_operator_id BIGINT NOT NULL REFERENCES run_operators(id) ON DELETE CASCADE,
    target_operator_id BIGINT NOT NULL REFERENCES run_operators(id) ON DELETE CASCADE,
    operation_id BIGINT NOT NULL REFERENCES operator_operations(id) ON DELETE CASCADE,
    assigned_quantity_per_hour NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, source_operator_id, target_operator_id, operation_id)
  );
`);
console.log("✅ line_balancing_assignments table ready in prod_db_schema");
    // 6. Create slot_targets table
    await client.query(`
      CREATE TABLE IF NOT EXISTS slot_targets(
        id BIGSERIAL PRIMARY KEY,
        run_id BIGINT NOT NULL REFERENCES line_runs(id) ON DELETE CASCADE,
        slot_id BIGINT NOT NULL REFERENCES shift_slots(id) ON DELETE CASCADE,
        slot_target NUMERIC(12,2) NOT NULL DEFAULT 0,
        cumulative_target NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (run_id, slot_id)
      );
      
    `);
    console.log("✅ slot_targets table ready in prod_db_schema");

    // 7. Add to createAllTables function after other table creations
await client.query(`
  CREATE TABLE IF NOT EXISTS operator_capacity_history (
    id BIGSERIAL PRIMARY KEY,
    operation_id BIGINT NOT NULL REFERENCES operator_operations(id) ON DELETE CASCADE,
    old_capacity NUMERIC(12,3) NOT NULL,
    new_capacity NUMERIC(12,3) NOT NULL,
    changed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_capacity_positive CHECK (new_capacity >= 0)
  );
`);
console.log("✅ operator_capacity_history table ready in prod_db_schema");


// Update the work_orders table schema to include new fields
await client.query(`
  CREATE TABLE IF NOT EXISTS work_orders(
    id BIGSERIAL PRIMARY KEY,
    work_order_no VARCHAR(50) UNIQUE NOT NULL,
    quantity NUMERIC(12,2) NOT NULL,
    customer_name VARCHAR(100) NOT NULL,
    style_description TEXT NOT NULL,
    color VARCHAR(50),
    fabric_supplier VARCHAR(100),
    style_code VARCHAR(50),
    line_no VARCHAR(20),
    run_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    CONSTRAINT chk_quantity_positive CHECK (quantity > 0),
    CONSTRAINT chk_status CHECK (status IN ('pending', 'assigned', 'in_progress', 'completed'))
  );
`);console.log("✅ work_orders table ready in prod_db_schema");

// 9. Create line_assignments table (junction between work_orders and line_runs)
await client.query(`
  CREATE TABLE IF NOT EXISTS line_assignments(
    id BIGSERIAL PRIMARY KEY,
    work_order_id BIGINT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    line_run_id BIGINT REFERENCES line_runs(id) ON DELETE SET NULL,
    line_no TEXT NOT NULL,
    assigned_date DATE NOT NULL,
    assigned_quantity NUMERIC(12,2) NOT NULL,
    available_minutes NUMERIC(12,2) NOT NULL,
    required_production_rate NUMERIC(12,2) NOT NULL,
    planned_start_date DATE,
    planned_end_date DATE,
    priority INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status VARCHAR(20) NOT NULL DEFAULT 'planned',
    CONSTRAINT chk_assigned_quantity_positive CHECK (assigned_quantity > 0),
    CONSTRAINT chk_assignment_status CHECK (status IN ('planned', 'released', 'completed', 'cancelled'))
  );
`);
console.log("✅ line_assignments table ready in prod_db_schema");

// Create indexes for faster queries
await client.query("CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);");
await client.query("CREATE INDEX IF NOT EXISTS idx_work_orders_wo_no ON work_orders(work_order_no);");
await client.query("CREATE INDEX IF NOT EXISTS idx_line_assignments_line ON line_assignments(line_no, assigned_date);");
await client.query("CREATE INDEX IF NOT EXISTS idx_line_assignments_work_order ON line_assignments(work_order_id);");



    // Create index for faster queries
    await client.query("CREATE INDEX IF NOT EXISTS idx_capacity_history_operation ON operator_capacity_history(operation_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_capacity_history_changed_at ON operator_capacity_history(changed_at);");
    // Create indexes
    await client.query("CREATE INDEX IF NOT EXISTS idx_sewed_run ON operation_sewed_entries(run_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_sewed_slot ON operation_sewed_entries(slot_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE is_active = TRUE;");
    await client.query("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role, line_number);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_line_runs_line_date ON line_runs (line_no, run_date);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_shift_slots_run ON shift_slots(run_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_run_operators_run ON run_operators(run_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_operator_ops_run ON operator_operations(run_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_operator_ops_operator ON operator_operations(run_operator_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_hourly_entries_run ON operation_hourly_entries(run_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_hourly_entries_operation ON operation_hourly_entries(operation_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_hourly_entries_slot ON operation_hourly_entries(slot_id);");

    console.log("✅ All tables and indexes created successfully in prod_db_schema");

    // Create default users if they don't exist
    await createDefaultUsers(client);
  } catch (err) {
    console.error("❌ Error creating tables:", err.message);
    throw err;
  } finally {
    client.release();
  }
};

// Function to create default users
const createDefaultUsers = async (client) => {
  try {
    console.log("🔄 Creating default users in prod_db_schema...");

    const defaultUsers = [
      {
        username: "engineer",
        password: "engineer",
        role: "engineer",
        full_name: "System Engineer",
      },
    ];

    // Add line leaders 1-26
    for (let i = 1; i <= 26; i++) {
      defaultUsers.push({
        username: `line${i}`,
        password: `line${i}`,
        role: "line_leader",
        line_number: i,
        full_name: `Line ${i} Leader`,
      });
    }

    // Add soporte_it user
defaultUsers.push({
  username: "soporte_it",
  password: "soporte123",
  role: "soporte_it",
  full_name: "Soporte IT",
});

// Add skyrina user with password skyrina26
    defaultUsers.push({
      username: "skyrina",
      password: "skyrina26",
      role: "skyrina",
      full_name: "Skyrina Dashboard User",
    });

    // Add a supervisor
    defaultUsers.push({
      username: "supervisor",
      password: "supervisor123",
      role: "supervisor",
      full_name: "Production Supervisor",
    });

    let createdCount = 0;
    let updatedCount = 0;

    for (const user of defaultUsers) {
      // Check if user exists
      const existingUser = await client.query("SELECT id FROM users WHERE username = $1", [user.username]);

      if (existingUser.rows.length === 0) {
        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(user.password, saltRounds);

        // Insert new user
        await client.query(
          `
          INSERT INTO users (username, password_hash, role, line_number, full_name, is_active)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
          [user.username, passwordHash, user.role, user.line_number || null, user.full_name || user.username, true]
        );
        createdCount++;
        console.log(`✅ Created user: ${user.username} (${user.role})`);
      } else {
        // Update existing user's password if needed
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(user.password, saltRounds);

        await client.query(
          `
          UPDATE users 
          SET password_hash = $1, updated_at = NOW()
          WHERE username = $2
        `,
          [passwordHash, user.username]
        );
        updatedCount++;
        console.log(`✅ Updated user: ${user.username}`);
      }
    }

    console.log(`✅ Users ready: ${createdCount} created, ${updatedCount} updated`);
  } catch (err) {
    console.error("❌ Error creating default users:", err.message);
  }
};

// ✅ Login endpoint
app.post("/api/login", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Username and password are required",
      });
    }

    // Find user
    const userResult = await client.query(
      `
      SELECT id, username, password_hash, role, line_number, full_name, is_active
      FROM users 
      WHERE username = $1 AND is_active = TRUE
    `,
      [username]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: "Invalid username or password",
      });
    }

    const user = userResult.rows[0];

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: "Invalid username or password",
      });
    }

    // Remove password hash from response
    delete user.password_hash;

    // Generate a simple token (in production, use JWT)
    const token = Buffer.from(`${user.id}:${Date.now()}`).toString("base64");

    res.json({
      success: true,
      message: "Login successful",
      user: user,
      token: token,
    });
  } catch (err) {
    console.error("❌ Login error:", err.message);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  } finally {
    client.release();
  }
});

// ✅ Middleware to verify authentication
const authenticateToken = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    // Simple token validation
    const decoded = Buffer.from(token, "base64").toString("ascii");
    const [userId, timestamp] = decoded.split(":");

    // Check if token is not too old (24 hours)
    const tokenAge = Date.now() - parseInt(timestamp);
    const MAX_TOKEN_AGE = 24 * 60 * 60 * 1000; // 24 hours

    if (tokenAge > MAX_TOKEN_AGE) {
      return res.status(401).json({
        success: false,
        error: "Session expired",
      });
    }

    // Verify user exists and is active
    const userResult = await client.query(
      `
      SELECT id, username, role, line_number, full_name
      FROM users 
      WHERE id = $1 AND is_active = TRUE
    `,
      [parseInt(userId)]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: "User not found or inactive",
      });
    }

    req.user = userResult.rows[0];
    next();
  } catch (err) {
    console.error("❌ Authentication error:", err.message);
    res.status(401).json({
      success: false,
      error: "Invalid authentication token",
    });
  } finally {
    client.release();
  }
};

// ✅ Get current user info
app.get("/api/me", authenticateToken, async (req, res) => {
  res.json({
    success: true,
    user: req.user,
  });
});

// ✅ Logout endpoint
app.post("/api/logout", (req, res) => {
  res.json({
    success: true,
    message: "Logged out successfully",
  });
});

// ✅ Save line inputs and shift slots together (Step 1)
app.post("/api/save-production", async (req, res) => {
  const client = await pool.connect();

  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { line, date, style, operators, workingHours, sam, efficiency, target, targetPerHour, slots } = req.body;

    // Validate required fields
    if (!line || !date || !style || !operators || !workingHours || !sam) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    // Insert into line_runs table
    const lineRunQuery = `
      INSERT INTO line_runs (
        line_no, 
        run_date, 
        style, 
        operators_count, 
        working_hours, 
        sam_minutes, 
        efficiency, 
        target_pcs,
        target_per_hour,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING id;
    `;

    const lineRunResult = await client.query(lineRunQuery, [
      line,
      date,
      style,
      parseInt(operators) || 0,
      parseFloat(workingHours),
      parseFloat(sam),
      parseFloat(efficiency) || 0.7,
      parseFloat(target) || 0,
      parseFloat(targetPerHour) || 0,
    ]);

    const runId = lineRunResult.rows[0].id;
    console.log(`✅ Line run saved with ID: ${runId} in prod_db_schema`);

    // Insert shift slots
    const slotIds = {};
    if (slots && slots.length > 0) {
      const slotQuery = `
        INSERT INTO shift_slots (
          run_id,
          slot_order,
          slot_label,
          slot_start,
          slot_end,
          planned_hours
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, slot_label;
      `;

      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const slotResult = await client.query(slotQuery, [
          runId,
          i + 1,
          slot.label,
          slot.startTime || null,
          slot.endTime || null,
          parseFloat(slot.hours) || 0,
        ]);

        slotIds[slot.label] = slotResult.rows[0].id;
      }
      console.log(`✅ ${slots.length} shift slots saved for line run ${runId}`);
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Production data saved successfully in prod_db_schema",
      lineRunId: runId,
      slotIds,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error saving production data:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Save operators and operations (Step 2)
app.post("/api/save-operations", async (req, res) => {
  const client = await pool.connect();

  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId, operations, slotTargets, cumulativeTargets } = req.body;

    if (!runId || !operations || !Array.isArray(operations)) {
      return res.status(400).json({
        success: false,
        error: "Missing required data",
      });
    }

    // Verify run exists
    const runCheck = await client.query("SELECT id FROM line_runs WHERE id = $1", [runId]);

    if (runCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Line run not found",
      });
    }

    // Get slot IDs for this run
    const slotsResult = await client.query(
      "SELECT id, slot_label FROM shift_slots WHERE run_id = $1 ORDER BY slot_order",
      [runId]
    );

    const slotMap = {};
    slotsResult.rows.forEach((slot) => {
      slotMap[slot.slot_label] = slot.id;
    });

    // Process each operation row
    const operatorMap = {};
    let savedOperations = 0;

    for (const operation of operations) {
      const { operatorNo, operatorName, operation: operationName, t1, t2, t3, t4, t5, capacityPerHour } = operation;

      // Skip if no operator number
      if (!operatorNo) {
        console.log("⚠️ Skipping operation without operator number");
        continue;
      }

      const opNo = parseInt(operatorNo);

      try {
        // Insert or get existing operator
        if (!operatorMap[opNo]) {
          const operatorQuery = `
            INSERT INTO run_operators (run_id, operator_no, operator_name, created_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (run_id, operator_no) 
            DO UPDATE SET operator_name = EXCLUDED.operator_name
            RETURNING id;
          `;

          const operatorResult = await client.query(operatorQuery, [runId, opNo, operatorName || null]);

          operatorMap[opNo] = operatorResult.rows[0].id;
          console.log(`✅ Operator ${opNo} saved/updated: ID ${operatorMap[opNo]}`);
        }

        // Insert operation
        const operationQuery = `
          INSERT INTO operator_operations (
            run_id,
            run_operator_id,
            operation_name,
            t1_sec,
            t2_sec,
            t3_sec,
            t4_sec,
            t5_sec,
            capacity_per_hour,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
          ON CONFLICT (run_operator_id, operation_name)
          DO UPDATE SET 
            t1_sec = EXCLUDED.t1_sec,
            t2_sec = EXCLUDED.t2_sec,
            t3_sec = EXCLUDED.t3_sec,
            t4_sec = EXCLUDED.t4_sec,
            t5_sec = EXCLUDED.t5_sec,
            capacity_per_hour = EXCLUDED.capacity_per_hour
          RETURNING id;
        `;

        const opResult = await client.query(operationQuery, [
          runId,
          operatorMap[opNo],
          operationName || "Unnamed Operation",
          t1 ? parseFloat(t1) : null,
          t2 ? parseFloat(t2) : null,
          t3 ? parseFloat(t3) : null,
          t4 ? parseFloat(t4) : null,
          t5 ? parseFloat(t5) : null,
          capacityPerHour || 0,
        ]);

        savedOperations++;
        console.log(`✅ Operation "${operationName || "Unnamed"}" saved for operator ${opNo}: ID ${opResult.rows[0].id}`);
      } catch (opErr) {
        console.error(`❌ Error saving operation for operator ${opNo}:`, opErr.message);
        continue;
      }
    }

    // Save slot targets (hourly plan targets)
    if (slotTargets && cumulativeTargets && slotsResult.rows.length > 0) {
      let savedTargets = 0;
      for (let i = 0; i < slotsResult.rows.length; i++) {
        const slot = slotsResult.rows[i];
        const slotTarget = slotTargets[i] || 0;
        const cumulativeTarget = cumulativeTargets[i] || 0;

        const slotTargetQuery = `
          INSERT INTO slot_targets (run_id, slot_id, slot_target, cumulative_target, created_at, updated_at)
          VALUES ($1, $2, $3, $4, NOW(), NOW())
          ON CONFLICT (run_id, slot_id)
          DO UPDATE SET 
            slot_target = EXCLUDED.slot_target,
            cumulative_target = EXCLUDED.cumulative_target,
            updated_at = NOW();
        `;

        await client.query(slotTargetQuery, [runId, slot.id, parseFloat(slotTarget), parseFloat(cumulativeTarget)]);
        savedTargets++;
      }
      console.log(`✅ ${savedTargets} slot targets saved for run ${runId}`);
    }

    await client.query("COMMIT");

    console.log(`✅ Operations saved for run ${runId}: ${savedOperations} operations`);

    res.json({
      success: true,
      message: "Operations data saved successfully",
      operationsCount: savedOperations,
      operatorCount: Object.keys(operatorMap).length,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error saving operations data:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ User management endpoints (for engineers/supervisors only)
const requireEngineerOrSupervisor = (req, res, next) => {
  if (req.user.role !== "engineer" && req.user.role !== "supervisor" 
    && req.user.role !== "soporte_it" && req.user.role !== "skyrina") {
    return res.status(403).json({
      success: false,
      error: "Access denied. Engineer or supervisor role required.",
    });
  }
  next();
};

// Get all users
app.get("/api/users", authenticateToken, requireEngineerOrSupervisor, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const result = await client.query(`
      SELECT id, username, role, line_number, full_name, is_active, created_at, updated_at
      FROM users
      ORDER BY 
        CASE role 
          WHEN 'engineer' THEN 1
          WHEN 'supervisor' THEN 2
          WHEN 'line_leader' THEN 3
          WHEN 'soporte_it' THEN 4
          WHEN 'skyrina' THEN 5
          ELSE 6
        END,
        line_number NULLS FIRST,
        username
    `);

    res.json({
      success: true,
      users: result.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching users:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// Create new users
app.post("/api/users", authenticateToken, requireEngineerOrSupervisor, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { username, password, role, line_number, full_name } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({
        success: false,
        error: "Username, password, and role are required",
      });
    }

    // Validate role
    const validRoles = ["engineer", "line_leader", "supervisor", "soporte_it", "skyrina"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: "Invalid role. Must be 'engineer', 'line_leader', 'supervisor', 'soporte_it', or 'skyrina'",
      });
    }

    // Validate line_number for line leaders
    if (role === "line_leader") {
      if (!line_number || line_number < 1 || line_number > 26) {
        return res.status(400).json({
          success: false,
          error: "Line leaders must have a line number between 1 and 26",
        });
      }

      // Check if line number is already assigned
      const existingLineUser = await client.query(
        `
        SELECT username FROM users 
        WHERE role = 'line_leader' AND line_number = $1 AND is_active = TRUE
      `,
        [line_number]
      );

      if (existingLineUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Line ${line_number} is already assigned to user: ${existingLineUser.rows[0].username}`,
        });
      }
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const result = await client.query(
      `
      INSERT INTO users (username, password_hash, role, line_number, full_name, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, username, role, line_number, full_name, is_active, created_at
    `,
      [username, passwordHash, role, line_number || null, full_name || username, true]
    );

    res.json({
      success: true,
      message: "User created successfully",
      user: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Error creating user:", err.message);

    if (err.code === "23505") {
      // Unique violation
      res.status(400).json({
        success: false,
        error: "Username already exists",
      });
    } else {
      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  } finally {
    client.release();
  }
});

// Update user
app.put("/api/users/:id", authenticateToken, requireEngineerOrSupervisor, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { id } = req.params;
    const { username, password, role, line_number, full_name, is_active } = req.body;

    // Build update query dynamically
    const updates = [];
    const values = [];
    let valueIndex = 1;

    if (username !== undefined) {
      updates.push(`username = $${valueIndex++}`);
      values.push(username);
    }

    if (password !== undefined) {
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);
      updates.push(`password_hash = $${valueIndex++}`);
      values.push(passwordHash);
    }

    if (role !== undefined) {
      updates.push(`role = $${valueIndex++}`);
      values.push(role);
    }

    if (line_number !== undefined) {
      updates.push(`line_number = $${valueIndex++}`);
      values.push(line_number);
    }

    if (full_name !== undefined) {
      updates.push(`full_name = $${valueIndex++}`);
      values.push(full_name);
    }

    if (is_active !== undefined) {
      updates.push(`is_active = $${valueIndex++}`);
      values.push(is_active);
    }

    updates.push(`updated_at = NOW()`);

    if (updates.length === 1) {
      // Only updated_at was added
      return res.status(400).json({
        success: false,
        error: "No fields to update",
      });
    }

    values.push(id);

    const query = `
      UPDATE users 
      SET ${updates.join(", ")}
      WHERE id = $${valueIndex}
      RETURNING id, username, role, line_number, full_name, is_active, created_at, updated_at
    `;

    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.json({
      success: true,
      message: "User updated successfully",
      user: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Error updating user:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// Delete user (soft delete)
app.delete("/api/users/:id", authenticateToken, requireEngineerOrSupervisor, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { id } = req.params;

    // Prevent deleting yourself
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        error: "Cannot delete your own account",
      });
    }

    const result = await client.query(
      `
      UPDATE users 
      SET is_active = FALSE, updated_at = NOW()
      WHERE id = $1 AND is_active = TRUE
      RETURNING id, username
    `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found or already inactive",
      });
    }

    res.json({
      success: true,
      message: "User deactivated successfully",
    });
  } catch (err) {
    console.error("❌ Error deleting user:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Save hourly stitched data separately
app.post("/api/save-hourly-data", async (req, res) => {
  const client = await pool.connect();

  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { entries } = req.body;

    if (!entries || !Array.isArray(entries)) {
      return res.status(400).json({
        success: false,
        error: "Missing hourly data entries",
      });
    }

    let savedCount = 0;
    let skippedCount = 0;

    for (const entry of entries) {
      const { runId, operatorNo, operationName, slotLabel, stitchedQty } = entry;

      if (!runId || !operatorNo || !operationName || !slotLabel) {
        skippedCount++;
        continue;
      }

      try {
        // Get operator and operation IDs
        const opResult = await client.query(
          `
          SELECT o.id as op_id, ro.id as operator_id
          FROM operator_operations o
          JOIN run_operators ro ON o.run_operator_id = ro.id
          WHERE o.run_id = $1 
            AND ro.operator_no = $2 
            AND o.operation_name = $3
          LIMIT 1
        `,
          [runId, parseInt(operatorNo), operationName]
        );

        let operationId;

        if (opResult.rows.length === 0) {
          console.warn(`⚠️ Operation not found: ${operatorNo} - ${operationName}. Creating it now...`);

          // Try to create the operation if it doesn't exist
          const createOpResult = await client.query(
            `
            WITH new_operator AS (
              INSERT INTO run_operators (run_id, operator_no, operator_name, created_at)
              VALUES ($1, $2, $3, NOW())
              ON CONFLICT (run_id, operator_no) 
              DO UPDATE SET operator_name = EXCLUDED.operator_name
              RETURNING id
            )
            INSERT INTO operator_operations (
              run_id,
              run_operator_id,
              operation_name,
              capacity_per_hour,
              created_at
            )
            SELECT $1, id, $4, 0, NOW()
            FROM new_operator
            RETURNING id;
          `,
            [runId, parseInt(operatorNo), `Operator ${operatorNo}`, operationName]
          );

          if (createOpResult.rows.length === 0) {
            console.warn(`❌ Failed to create operation: ${operatorNo} - ${operationName}`);
            skippedCount++;
            continue;
          }

          operationId = createOpResult.rows[0].id;
          console.log(`✅ Created missing operation: ${operatorNo} - ${operationName} (ID: ${operationId})`);
        } else {
          operationId = opResult.rows[0].op_id;
        }

        // Get slot ID
        const slotResult = await client.query("SELECT id FROM shift_slots WHERE run_id = $1 AND slot_label = $2", [
          runId,
          slotLabel,
        ]);

        if (slotResult.rows.length === 0) {
          console.warn(`⚠️ Slot not found: ${slotLabel} for run ${runId}`);
          skippedCount++;
          continue;
        }

        const slotId = slotResult.rows[0].id;

        // Save hourly entry
        const hourlyQuery = `
          INSERT INTO operation_hourly_entries (
            run_id,
            operation_id,
            slot_id,
            stitched_qty,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, NOW(), NOW())
          ON CONFLICT (operation_id, slot_id)
          DO UPDATE SET 
            stitched_qty = EXCLUDED.stitched_qty,
            updated_at = NOW();
        `;

        await client.query(hourlyQuery, [runId, operationId, slotId, parseFloat(stitchedQty) || 0]);

        savedCount++;
      } catch (entryErr) {
        console.error(`❌ Error saving hourly entry for ${operatorNo}-${operationName}:`, entryErr.message);
        skippedCount++;
      }
    }

    await client.query("COMMIT");

    console.log(`✅ Hourly data saved: ${savedCount} entries, ${skippedCount} skipped`);

    res.json({
      success: true,
      message: "Hourly data saved",
      savedCount,
      skippedCount,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error saving hourly data:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Line leader update sewed entries
app.post("/api/lineleader/update-sewed/:runId", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { entries } = req.body;

    if (!entries || !Array.isArray(entries)) {
      return res.status(400).json({
        success: false,
        error: "Missing entries array",
      });
    }

    let updatedCount = 0;

    for (const entry of entries) {
      const { operatorNo, operationName, slotLabel, sewedQty } = entry;

      if (!operatorNo || !operationName || !slotLabel) continue;

      // 1) find operation id
      const opResult = await client.query(
        `
        SELECT o.id as op_id
        FROM operator_operations o
        JOIN run_operators ro ON o.run_operator_id = ro.id
        WHERE o.run_id = $1
          AND ro.operator_no = $2
          AND o.operation_name = $3
        LIMIT 1
        `,
        [runId, parseInt(operatorNo), operationName]
      );

      if (opResult.rows.length === 0) continue;
      const operationId = opResult.rows[0].op_id;

      // 2) find slot id
      const slotResult = await client.query(`SELECT id FROM shift_slots WHERE run_id = $1 AND slot_label = $2 LIMIT 1`, [
        runId,
        slotLabel,
      ]);

      if (slotResult.rows.length === 0) continue;
      const slotId = slotResult.rows[0].id;

      // 3) upsert into operation_sewed_entries
      await client.query(
        `
        INSERT INTO operation_sewed_entries (run_id, operation_id, slot_id, sewed_qty, created_at, updated_at)
        VALUES ($1, $2, $3, $4, now(), now())
        ON CONFLICT (operation_id, slot_id)
        DO UPDATE SET sewed_qty = EXCLUDED.sewed_qty, updated_at = now()
        `,
        [runId, operationId, slotId, Number(sewedQty || 0)]
      );

      updatedCount++;
    }

    await client.query("COMMIT");
    return res.json({ success: true, updatedCount });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("❌ update-sewed error:", e);
    return res.status(500).json({ success: false, error: e.message });
  } finally {
    client.release();
  }
});

// ✅ Get saved data for a run
app.get("/api/get-run-data/:runId", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { runId } = req.params;

    // 1) Get line run data
    const runResult = await client.query("SELECT * FROM line_runs WHERE id = $1", [runId]);

    if (runResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Run not found",
      });
    }

    const runData = runResult.rows[0];

    // 2) Get shift slots
    const slotsResult = await client.query(
      `SELECT id, slot_order, slot_label, slot_start, slot_end, planned_hours
       FROM shift_slots
       WHERE run_id = $1
       ORDER BY slot_order`,
      [runId]
    );

    // 3) Get operators
    const operatorsResult = await client.query(
      `SELECT id, operator_no, operator_name
       FROM run_operators
       WHERE run_id = $1
       ORDER BY operator_no`,
      [runId]
    );

    // 4) Get slot targets
    const slotTargetsResult = await client.query(
      `SELECT s.slot_label, t.slot_target, t.cumulative_target
       FROM slot_targets t
       JOIN shift_slots s ON t.slot_id = s.id
       WHERE t.run_id = $1
       ORDER BY s.slot_order`,
      [runId]
    );

    // 5) Get operations with stitched_data + sewed_data
    const operationsData = [];

    for (const operator of operatorsResult.rows) {
      const operationsResult = await client.query(
        `SELECT 
          o.id,
          o.operation_name,
          o.t1_sec,
          o.t2_sec,
          o.t3_sec,
          o.t4_sec,
          o.t5_sec,
          o.capacity_per_hour,

          json_object_agg(
            COALESCE(s.slot_label, ''),
            COALESCE(h.stitched_qty, 0)
          ) FILTER (WHERE s.slot_label IS NOT NULL) as stitched_data,

          json_object_agg(
            COALESCE(s2.slot_label, ''),
            COALESCE(se.sewed_qty, 0)
          ) FILTER (WHERE s2.slot_label IS NOT NULL) as sewed_data

         FROM operator_operations o

         LEFT JOIN operation_hourly_entries h ON o.id = h.operation_id
         LEFT JOIN shift_slots s ON h.slot_id = s.id

         LEFT JOIN operation_sewed_entries se ON o.id = se.operation_id
         LEFT JOIN shift_slots s2 ON se.slot_id = s2.id

         WHERE o.run_operator_id = $1 AND o.run_id = $2
         GROUP BY o.id
         ORDER BY o.id`,
        [operator.id, runId]
      );

      operationsData.push({
        operator,
        operations: operationsResult.rows,
      });
    }

    return res.json({
      success: true,
      run: runData,
      slots: slotsResult.rows,
      operators: operatorsResult.rows,
      operations: operationsData,
      slotTargets: slotTargetsResult.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching run data:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Get all saved line runs (for dropdown)
app.get("/api/line-runs", async (req, res) => {
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
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Get line runs by line number
app.get("/api/line-runs/:lineNo", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { lineNo } = req.params;

    const result = await client.query(
      `
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
      WHERE line_no = $1
      ORDER BY run_date DESC
    `,
      [lineNo]
    );

    res.json({
      success: true,
      runs: result.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching line runs by line:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Get line leader latest run
app.get("/api/lineleader/latest-run", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const line = String(req.query.line || "").trim();
    if (!line) return res.json({ success: false, error: "line is required" });

    // ✅ latest run for that line
    const runQ = await client.query(
      `
      SELECT *
      FROM line_runs
      WHERE line_no = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [line]
    );

    if (runQ.rowCount === 0) {
      return res.json({ success: false, error: `No runs found for line ${line}` });
    }

    const run = runQ.rows[0];

    // ✅ slots for that run
    const slotsQ = await client.query(
      `
      SELECT *
      FROM shift_slots
      WHERE run_id = $1
      ORDER BY slot_order ASC
      `,
      [run.id]
    );

    return res.json({
      success: true,
      run,
      slots: slotsQ.rows,
    });
  } catch (e) {
    console.error("❌ /api/lineleader/latest-run error:", e);
    return res.status(500).json({ success: false, error: e.message });
  } finally {
    client.release();
  }
});

// ✅ Get complete run data for editing
app.get("/api/run/:runId", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { runId } = req.params;

    // Get line run data
    const runResult = await client.query("SELECT * FROM line_runs WHERE id = $1", [runId]);

    if (runResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Run not found",
      });
    }

    const runData = runResult.rows[0];

    // Get shift slots
    const slotsResult = await client.query(
      `SELECT id, slot_order, slot_label, slot_start, slot_end, planned_hours 
       FROM shift_slots 
       WHERE run_id = $1 
       ORDER BY slot_order`,
      [runId]
    );

    // Get operators
    const operatorsResult = await client.query(
      `SELECT id, operator_no, operator_name 
       FROM run_operators 
       WHERE run_id = $1 
       ORDER BY operator_no`,
      [runId]
    );

    // Get slot targets
    const slotTargetsResult = await client.query(
      `SELECT s.slot_label, t.slot_target, t.cumulative_target
       FROM slot_targets t
       JOIN shift_slots s ON t.slot_id = s.id
       WHERE t.run_id = $1
       ORDER BY s.slot_order`,
      [runId]
    );

    // Get operations with their hourly data
    const operationsData = [];

    for (const operator of operatorsResult.rows) {
      const operationsResult = await client.query(
        `SELECT 
          o.id,
          o.operation_name,
          o.t1_sec,
          o.t2_sec,
          o.t3_sec,
          o.t4_sec,
          o.t5_sec,
          o.capacity_per_hour,
          json_object_agg(
            COALESCE(s.slot_label, ''),
            COALESCE(h.stitched_qty, 0)
          ) as stitched_data
         FROM operator_operations o
         LEFT JOIN operation_hourly_entries h ON o.id = h.operation_id
         LEFT JOIN shift_slots s ON h.slot_id = s.id
         WHERE o.run_operator_id = $1 AND o.run_id = $2
         GROUP BY o.id
         ORDER BY o.created_at`,
        [operator.id, runId]
      );

      operationsData.push({
        operator,
        operations: operationsResult.rows,
      });
    }

    res.json({
      success: true,
      run: runData,
      slots: slotsResult.rows,
      operators: operatorsResult.rows,
      operations: operationsData,
      slotTargets: slotTargetsResult.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching run data:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Update hourly stitched data for a specific run
app.post("/api/update-hourly-data/:runId", async (req, res) => {
  const client = await pool.connect();

  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { entries } = req.body;

    if (!entries || !Array.isArray(entries)) {
      return res.status(400).json({
        success: false,
        error: "Missing hourly data entries",
      });
    }

    let savedCount = 0;
    let updatedCount = 0;

    for (const entry of entries) {
      const { operatorNo, operationName, slotLabel, stitchedQty } = entry;

      if (!operatorNo || !operationName || !slotLabel) {
        continue;
      }

      // Get operation ID
      const opResult = await client.query(
        `
        SELECT o.id as op_id
        FROM operator_operations o
        JOIN run_operators ro ON o.run_operator_id = ro.id
        WHERE o.run_id = $1 
          AND ro.operator_no = $2 
          AND o.operation_name = $3
        LIMIT 1
      `,
        [runId, parseInt(operatorNo), operationName]
      );

      if (opResult.rows.length === 0) {
        console.warn(`⚠️ Operation not found: ${operatorNo} - ${operationName}`);
        continue;
      }

      const operationId = opResult.rows[0].op_id;

      // Get slot ID
      const slotResult = await client.query("SELECT id FROM shift_slots WHERE run_id = $1 AND slot_label = $2", [
        runId,
        slotLabel,
      ]);

      if (slotResult.rows.length === 0) {
        console.warn(`⚠️ Slot not found: ${slotLabel}`);
        continue;
      }

      const slotId = slotResult.rows[0].id;

      // Check if entry already exists
      const existingResult = await client.query(
        "SELECT id FROM operation_hourly_entries WHERE operation_id = $1 AND slot_id = $2",
        [operationId, slotId]
      );

      // Save/update hourly entry
      const hourlyQuery =
        existingResult.rows.length > 0
          ? `
        UPDATE operation_hourly_entries 
        SET stitched_qty = $1, updated_at = NOW()
        WHERE operation_id = $2 AND slot_id = $3
        RETURNING id
      `
          : `
        INSERT INTO operation_hourly_entries (
          run_id,
          operation_id,
          slot_id,
          stitched_qty,
          created_at,
          updated_at
        )
        VALUES ($4, $2, $3, $1, NOW(), NOW())
        RETURNING id
      `;

      const params =
        existingResult.rows.length > 0
          ? [parseFloat(stitchedQty) || 0, operationId, slotId]
          : [parseFloat(stitchedQty) || 0, operationId, slotId, runId];

      await client.query(hourlyQuery, params);

      if (existingResult.rows.length > 0) {
        updatedCount++;
      } else {
        savedCount++;
      }
    }

    await client.query("COMMIT");

    console.log(`✅ Hourly data updated for run ${runId}: ${savedCount} new, ${updatedCount} updated`);

    res.json({
      success: true,
      message: "Hourly data updated",
      savedCount,
      updatedCount,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error updating hourly data:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Add operation to existing run
app.post("/api/add-operation/:runId", async (req, res) => {
  const client = await pool.connect();

  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { operatorNo, operatorName, operationName, t1, t2, t3, t4, t5, capacityPerHour } = req.body;

    if (!operatorNo || !operationName) {
      return res.status(400).json({
        success: false,
        error: "Missing operator number or operation name",
      });
    }

    // Get or create operator
    const operatorResult = await client.query(
      `
      INSERT INTO run_operators (run_id, operator_no, operator_name, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (run_id, operator_no) 
      DO UPDATE SET operator_name = EXCLUDED.operator_name
      RETURNING id
    `,
      [runId, parseInt(operatorNo), operatorName || null]
    );

    const operatorId = operatorResult.rows[0].id;

    // Add operation
    const operationResult = await client.query(
      `
      INSERT INTO operator_operations (
        run_id,
        run_operator_id,
        operation_name,
        t1_sec,
        t2_sec,
        t3_sec,
        t4_sec,
        t5_sec,
        capacity_per_hour,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (run_operator_id, operation_name)
      DO UPDATE SET 
        t1_sec = EXCLUDED.t1_sec,
        t2_sec = EXCLUDED.t2_sec,
        t3_sec = EXCLUDED.t3_sec,
        t4_sec = EXCLUDED.t4_sec,
        t5_sec = EXCLUDED.t5_sec,
        capacity_per_hour = EXCLUDED.capacity_per_hour
      RETURNING id
    `,
      [
        runId,
        operatorId,
        operationName,
        t1 ? parseFloat(t1) : null,
        t2 ? parseFloat(t2) : null,
        t3 ? parseFloat(t3) : null,
        t4 ? parseFloat(t4) : null,
        t5 ? parseFloat(t5) : null,
        capacityPerHour || 0,
      ]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Operation added successfully",
      operationId: operationResult.rows[0].id,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error adding operation:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Duplicate an existing run to a new date
app.post("/api/duplicate-run/:runId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { newDate } = req.body;            // required: YYYY-MM-DD
    const newLineNo = req.body.newLineNo;    // optional – if omitted, same line_no is used

    if (!newDate) {
      return res.status(400).json({ success: false, error: "newDate is required" });
    }

    // 1. Get source run
    const sourceRunRes = await client.query(
      `SELECT line_no, style, operators_count, working_hours,
              sam_minutes, efficiency, target_pcs, target_per_hour
       FROM line_runs WHERE id = $1`,
      [runId]
    );
    if (sourceRunRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Source run not found" });
    }
    const src = sourceRunRes.rows[0];

    // 2. Insert new line_run
    const newRunRes = await client.query(
      `INSERT INTO line_runs
         (line_no, run_date, style, operators_count, working_hours,
          sam_minutes, efficiency, target_pcs, target_per_hour, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       RETURNING id`,
      [
        newLineNo || src.line_no,
        newDate,
        src.style,
        src.operators_count,
        src.working_hours,
        src.sam_minutes,
        src.efficiency,
        src.target_pcs,
        src.target_per_hour,
      ]
    );
    const newRunId = newRunRes.rows[0].id;

    // 3. Copy shift_slots – store mapping old slot_id -> new slot_id
    const slotMap = new Map(); // old slot_id -> new slot_id
    const slotsRes = await client.query(
      `SELECT id, slot_order, slot_label, slot_start, slot_end, planned_hours
       FROM shift_slots WHERE run_id = $1 ORDER BY slot_order`,
      [runId]
    );
    for (const slot of slotsRes.rows) {
      const newSlotRes = await client.query(
        `INSERT INTO shift_slots
           (run_id, slot_order, slot_label, slot_start, slot_end, planned_hours)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [newRunId, slot.slot_order, slot.slot_label, slot.slot_start, slot.slot_end, slot.planned_hours]
      );
      slotMap.set(slot.id, newSlotRes.rows[0].id);
    }

    // 4. Copy run_operators – store mapping old operator_id -> new operator_id
    const operatorMap = new Map();
    const operatorsRes = await client.query(
      `SELECT id, operator_no, operator_name FROM run_operators WHERE run_id = $1`,
      [runId]
    );
    for (const op of operatorsRes.rows) {
      const newOpRes = await client.query(
        `INSERT INTO run_operators (run_id, operator_no, operator_name, created_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id`,
        [newRunId, op.operator_no, op.operator_name]
      );
      operatorMap.set(op.id, newOpRes.rows[0].id);
    }

    // 5. Copy operator_operations (using operatorMap)
    for (const [oldOpId, newOpId] of operatorMap.entries()) {
      const opsRes = await client.query(
        `SELECT operation_name, t1_sec, t2_sec, t3_sec, t4_sec, t5_sec, capacity_per_hour
         FROM operator_operations WHERE run_operator_id = $1`,
        [oldOpId]
      );
      for (const opData of opsRes.rows) {
        await client.query(
          `INSERT INTO operator_operations
             (run_id, run_operator_id, operation_name, t1_sec, t2_sec, t3_sec, t4_sec, t5_sec,
              capacity_per_hour, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
          [
            newRunId,
            newOpId,
            opData.operation_name,
            opData.t1_sec,
            opData.t2_sec,
            opData.t3_sec,
            opData.t4_sec,
            opData.t5_sec,
            opData.capacity_per_hour,
          ]
        );
      }
    }

    // 6. Copy slot_targets (using slotMap)
    const targetsRes = await client.query(
      `SELECT slot_id, slot_target, cumulative_target
       FROM slot_targets WHERE run_id = $1`,
      [runId]
    );
    for (const tgt of targetsRes.rows) {
      const newSlotId = slotMap.get(tgt.slot_id);
      if (newSlotId) {
        await client.query(
          `INSERT INTO slot_targets (run_id, slot_id, slot_target, cumulative_target, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          [newRunId, newSlotId, tgt.slot_target, tgt.cumulative_target]
        );
      }
    }

    await client.query("COMMIT");
    res.json({ success: true, newRunId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error duplicating run:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// --------------------------------------------------------------
// update the operator capacity ENDPOINTS
// --------------------------------------------------------------

// ✅ Update efficiency for a run and recalculate target
app.put("/api/update-efficiency/:runId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { efficiency } = req.body;

    if (!efficiency || efficiency <= 0 || efficiency > 1) {
      return res.status(400).json({
        success: false,
        error: "Valid efficiency between 0 and 1 is required",
      });
    }

    // Get current run data
    const runResult = await client.query(
      `SELECT operators_count, working_hours, sam_minutes, target_pcs, target_per_hour
       FROM line_runs WHERE id = $1`,
      [runId]
    );

    if (runResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Run not found",
      });
    }

    const run = runResult.rows[0];
    
    // Recalculate target based on new efficiency
    const operators = parseFloat(run.operators_count) || 0;
    const sam = parseFloat(run.sam_minutes) || 0;
    const wh = parseFloat(run.working_hours) || 0;
    const eff = parseFloat(efficiency);

    // Calculate new target
    const totalMinutes = operators * wh * 60;
    const piecesAt100 = sam > 0 ? totalMinutes / sam : 0;
    const newTarget = piecesAt100 * eff;
    
    // Calculate new target per hour
    const newTargetPerHour = wh > 0 ? newTarget / wh : 0;

    // Update the run with new efficiency and recalculated targets
    await client.query(
      `UPDATE line_runs 
       SET efficiency = $1, 
           target_pcs = $2,
           target_per_hour = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [eff, newTarget, newTargetPerHour, runId]
    );

    // Also update slot targets (redistribute target across slots proportionally)
    const slotsResult = await client.query(
      `SELECT id, planned_hours FROM shift_slots WHERE run_id = $1 ORDER BY slot_order`,
      [runId]
    );

    if (slotsResult.rows.length > 0) {
      const totalPlannedHours = slotsResult.rows.reduce((sum, slot) => sum + parseFloat(slot.planned_hours), 0);
      
      let cumulativeTarget = 0;
      for (const slot of slotsResult.rows) {
        const slotHours = parseFloat(slot.planned_hours);
        const slotTarget = totalPlannedHours > 0 ? (slotHours / totalPlannedHours) * newTarget : 0;
        cumulativeTarget += slotTarget;

        await client.query(
          `UPDATE slot_targets 
           SET slot_target = $1, cumulative_target = $2, updated_at = NOW()
           WHERE run_id = $3 AND slot_id = $4`,
          [slotTarget, cumulativeTarget, runId, slot.id]
        );
      }
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Efficiency updated successfully",
      newTarget,
      newTargetPerHour,
      efficiency: eff
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error updating efficiency:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// --------------------------------------------------------------
// update the operator capacity ENDPOINTS
// --------------------------------------------------------------

app.put("/api/update-operation/:runId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { operatorNo, operationName, t1, t2, t3, t4, t5, capacityPerHour } = req.body;

    if (!operatorNo || !operationName) {
      return res.status(400).json({
        success: false,
        error: "Operator number and operation name are required",
      });
    }

    // Find the operation ID and get current capacity
    const opResult = await client.query(
      `
      SELECT o.id as op_id, o.capacity_per_hour as old_capacity
      FROM operator_operations o
      JOIN run_operators ro ON o.run_operator_id = ro.id
      WHERE o.run_id = $1 
        AND ro.operator_no = $2 
        AND o.operation_name = $3
      LIMIT 1
      `,
      [runId, parseInt(operatorNo), operationName]
    );

    if (opResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Operation not found",
      });
    }

    const operationId = opResult.rows[0].op_id;
    const oldCapacity = parseFloat(opResult.rows[0].old_capacity) || 0;
    const newCapacity = capacityPerHour || 0;

    // Update the operation - REMOVED updated_at reference
    const updateResult = await client.query(
      `
      UPDATE operator_operations
      SET 
        t1_sec = $1,
        t2_sec = $2,
        t3_sec = $3,
        t4_sec = $4,
        t5_sec = $5,
        capacity_per_hour = $6
      WHERE id = $7
      RETURNING id
      `,
      [
        t1 || null,
        t2 || null,
        t3 || null,
        t4 || null,
        t5 || null,
        newCapacity,
        operationId,
      ]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Failed to update operation",
      });
    }

    // Save to history table if capacity changed
    if (Math.abs(oldCapacity - newCapacity) > 0.001) {
      await client.query(
        `
        INSERT INTO operator_capacity_history 
          (operation_id, old_capacity, new_capacity, changed_by, changed_at)
        VALUES ($1, $2, $3, $4, NOW())
        `,
        [operationId, oldCapacity, newCapacity, req.user.id]
      );
      console.log(`✅ Capacity history recorded for operation ${operationId}: ${oldCapacity} → ${newCapacity}`);
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Operation updated successfully",
      operationId: updateResult.rows[0].id,
      capacityChanged: Math.abs(oldCapacity - newCapacity) > 0.001
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error updating operation:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Get capacity history for an operation
app.get("/api/operation-capacity-history/:operationId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { operationId } = req.params;
    
    const result = await client.query(
      `
      SELECT 
        h.id,
        h.old_capacity,
        h.new_capacity,
        h.changed_at,
        u.username as changed_by_username,
        u.full_name as changed_by_name
      FROM operator_capacity_history h
      LEFT JOIN users u ON h.changed_by = u.id
      WHERE h.operation_id = $1
      ORDER BY h.changed_at DESC
      `,
      [operationId]
    );
    
    res.json({
      success: true,
      history: result.rows
    });
  } catch (err) {
    console.error("❌ Error fetching capacity history:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Get all capacity changes for a run
app.get("/api/run-capacity-history/:runId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { runId } = req.params;
    
    const result = await client.query(
      `
      SELECT 
        h.id,
        h.old_capacity,
        h.new_capacity,
        h.changed_at,
        u.username as changed_by_username,
        u.full_name as changed_by_name,
        ro.operator_no,
        ro.operator_name,
        oo.operation_name
      FROM operator_capacity_history h
      JOIN operator_operations oo ON h.operation_id = oo.id
      JOIN run_operators ro ON oo.run_operator_id = ro.id
      LEFT JOIN users u ON h.changed_by = u.id
      WHERE oo.run_id = $1
      ORDER BY h.changed_at DESC
      `,
      [runId]
    );
    
    res.json({
      success: true,
      history: result.rows
    });
  } catch (err) {
    console.error("❌ Error fetching run capacity history:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});




// --------------------------------------------------------------
// SUPERVISOR DASHBOARD ENDPOINTS (FIXED)
// --------------------------------------------------------------

const requireSupervisor = (req, res, next) => {
  if (req.user.role !== "supervisor" && req.user.role !== "skyrina") {
    return res.status(403).json({
      success: false,
      error: "Access denied. Supervisor role required.",
    });
  }
  next();
};

/**
 * GET /api/supervisor/summary?date=YYYY-MM-DD
 * Returns global totals for the selected date
 */

app.get("/api/supervisor/summary", authenticateToken, requireSupervisor, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, error: "date parameter required" });
    }

    // 1) Total target – direct sum
    const targetResult = await client.query(
      `SELECT COALESCE(SUM(target_pcs), 0) as total_target
       FROM line_runs
       WHERE run_date = $1`,
      [date]
    );
    const totalTarget = parseFloat(targetResult.rows[0].total_target) || 0;

    // 2) Total sewed – per operator per line: max of operation totals, then sum across lines
    // In /api/supervisor/summary, after totalTarget calculation:

// 2) Total sewed (finished garments) – sum of packing operation outputs
const sewedResult = await client.query(
  `SELECT COALESCE(SUM(se.sewed_qty), 0) AS total_sewed
   FROM line_runs lr
   JOIN run_operators ro ON lr.id = ro.run_id
   JOIN operator_operations oo ON ro.id = oo.run_operator_id
   JOIN operation_sewed_entries se ON oo.id = se.operation_id
   WHERE lr.run_date = $1
     AND (oo.operation_name ILIKE '%pack%' OR oo.operation_name ILIKE '%emp%')`,
  [date]
);
const totalSewed = parseFloat(sewedResult.rows[0].total_sewed) || 0;

    // 3) Total operators – distinct count
    const operatorsResult = await client.query(
      `SELECT COUNT(DISTINCT ro.operator_no) as total_operators
       FROM run_operators ro
       JOIN line_runs lr ON ro.run_id = lr.id
       WHERE lr.run_date = $1`,
      [date]
    );
    const totalOperators = parseInt(operatorsResult.rows[0].total_operators) || 0;

   // 4) Efficiency – using packing output (finished garments) to count total SAM produced
const efficiencyResult = await client.query(
  `
  WITH run_available_minutes AS (
    SELECT
      id AS run_id,
      (working_hours * operators_count * 60) AS available_minutes
    FROM line_runs
    WHERE run_date = $1
  ),
  run_packing_totals AS (
    SELECT
      lr.id AS run_id,
      lr.sam_minutes,
      COALESCE(SUM(se.sewed_qty), 0) AS packing_total
    FROM line_runs lr
    JOIN run_operators ro ON lr.id = ro.run_id
    JOIN operator_operations oo ON ro.id = oo.run_operator_id
    LEFT JOIN operation_sewed_entries se ON oo.id = se.operation_id
    WHERE lr.run_date = $1
      AND (oo.operation_name ILIKE '%pack%' OR oo.operation_name ILIKE '%emp%')
    GROUP BY lr.id, lr.sam_minutes
  )
  SELECT
    COALESCE(SUM(ram.available_minutes), 0) AS total_available_minutes,
    COALESCE(SUM(rpt.packing_total * rpt.sam_minutes), 0) AS total_sam_output
  FROM run_available_minutes ram
  LEFT JOIN run_packing_totals rpt ON ram.run_id = rpt.run_id;
`,
  [date]
);
    const row = efficiencyResult.rows[0];
    const totalSamOutput = parseFloat(row.total_sam_output) || 0;
    const totalAvailableMinutes = parseFloat(row.total_available_minutes) || 0;
    const overallEfficiency = totalAvailableMinutes > 0 ? (totalSamOutput / totalAvailableMinutes) * 100 : 0;

    // 5) Target achievement
    const targetAchievement = totalTarget > 0 ? (totalSewed / totalTarget) * 100 : 0;

    res.json({
      success: true,
      date,
      summary: {
        totalTarget: Math.round(totalTarget * 100) / 100,
        totalSewed: Math.round(totalSewed * 100) / 100,
        totalOperators,
        targetAchievement: Math.round(targetAchievement * 100) / 100,
        overallEfficiency: Math.round(overallEfficiency * 100) / 100,
      },
    });
  } catch (err) {
    console.error("❌ /api/supervisor/summary error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/supervisor/alert-count?date=YYYY-MM-DD
 * Returns count of operators with production alerts (variance > 10% or production zero)
 */
app.get("/api/supervisor/alert-count", authenticateToken, requireSupervisor, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, error: "date parameter required" });
    }

    const alertQuery = `
      WITH operator_planned AS (
        SELECT 
          ro.operator_no,
          COALESCE(SUM(h.stitched_qty), 0) AS planned_total
        FROM line_runs lr
        JOIN run_operators ro ON lr.id = ro.run_id
        JOIN operator_operations oo ON ro.id = oo.run_operator_id
        LEFT JOIN operation_hourly_entries h ON oo.id = h.operation_id
        WHERE lr.run_date = $1
        GROUP BY ro.operator_no
      ),
      operator_actual AS (
        SELECT 
          ro.operator_no,
          COALESCE(SUM(se.sewed_qty), 0) AS actual_total
        FROM line_runs lr
        JOIN run_operators ro ON lr.id = ro.run_id
        JOIN operator_operations oo ON ro.id = oo.run_operator_id
        LEFT JOIN operation_sewed_entries se ON oo.id = se.operation_id
        WHERE lr.run_date = $1
        GROUP BY ro.operator_no
      )
      SELECT COUNT(*) AS alert_count
      FROM operator_planned p
      JOIN operator_actual a ON p.operator_no = a.operator_no
      WHERE a.actual_total < p.planned_total * 0.9
         OR (p.planned_total > 0 AND a.actual_total = 0);
    `;

    const result = await client.query(alertQuery, [date]);
    const alertCount = parseInt(result.rows[0].alert_count) || 0;

    res.json({ success: true, date, alertCount });
  } catch (err) {
    console.error("❌ /api/supervisor/alert-count error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/supervisor/line-performance?date=YYYY-MM-DD
 * Returns per-line: line_no, totalTarget, totalSewed, achievement, operators
 */
// In server.js, replace the /api/supervisor/line-performance endpoint with this version

app.get("/api/supervisor/line-performance", authenticateToken, requireSupervisor, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, error: "date parameter required" });
    }

    // Current time in the server's timezone (you may want to use client time later)
    const now = new Date();
    const todayStr = date; // YYYY-MM-DD

    const query = `
      WITH line_targets AS (
        SELECT lr.id AS run_id, lr.line_no, lr.target_pcs AS total_target
        FROM line_runs lr
        WHERE lr.run_date = $1
      ),
      -- Get all slots with their targets for each line
      line_slots AS (
        SELECT
          lt.line_no,
          ss.slot_start,
          ss.slot_end,
          st.slot_target
        FROM line_targets lt
        JOIN shift_slots ss ON lt.run_id = ss.run_id
        LEFT JOIN slot_targets st ON ss.id = st.slot_id
        WHERE ss.slot_start IS NOT NULL AND ss.slot_end IS NOT NULL
      ),
      -- Compute real‑time cumulative for each line
      line_realtime AS (
        SELECT
          line_no,
          SUM(
            CASE
              WHEN $2::timestamp AT TIME ZONE 'UTC' >= (($1 || ' ' || slot_end)::timestamp) THEN slot_target
              WHEN $2::timestamp AT TIME ZONE 'UTC' >= (($1 || ' ' || slot_start)::timestamp)
                   AND $2::timestamp AT TIME ZONE 'UTC' < (($1 || ' ' || slot_end)::timestamp)
              THEN slot_target * (
                EXTRACT(EPOCH FROM ($2::timestamp AT TIME ZONE 'UTC' - ($1 || ' ' || slot_start)::timestamp)) /
                EXTRACT(EPOCH FROM (($1 || ' ' || slot_end)::timestamp - ($1 || ' ' || slot_start)::timestamp))
              )
              ELSE 0
            END
          ) AS realtime_target
        FROM line_slots
        GROUP BY line_no
      ),
      operator_production AS (
        SELECT 
          lr.line_no,
          ro.operator_no,
          COALESCE(SUM(se.sewed_qty), 0) AS operator_production
        FROM line_runs lr
        JOIN run_operators ro ON lr.id = ro.run_id
        JOIN operator_operations oo ON ro.id = oo.run_operator_id
        LEFT JOIN operation_sewed_entries se ON oo.id = se.operation_id
        WHERE lr.run_date = $1
          AND (oo.operation_name ILIKE '%pack%' OR oo.operation_name ILIKE '%emp%')
        GROUP BY lr.line_no, ro.operator_no
      ),
      line_sewed AS (
        SELECT line_no, SUM(operator_production) AS total_sewed
        FROM operator_production
        GROUP BY line_no
      ),
      line_operators AS (
        SELECT lr.line_no, COUNT(DISTINCT ro.operator_no) AS operators_count
        FROM line_runs lr
        JOIN run_operators ro ON lr.id = ro.run_id
        WHERE lr.run_date = $1
        GROUP BY lr.line_no
      )
      SELECT 
        lt.line_no,
        lt.total_target,
        COALESCE(ls.total_sewed, 0) AS total_sewed,
        COALESCE(lo.operators_count, 0) AS operators_count,
        COALESCE(lr.realtime_target, 0) AS realtime_target,
        CASE 
          WHEN lt.total_target > 0 
          THEN (COALESCE(ls.total_sewed, 0) / lt.total_target) * 100 
          ELSE 0 
        END AS achievement
      FROM line_targets lt
      LEFT JOIN line_sewed ls ON lt.line_no = ls.line_no
      LEFT JOIN line_operators lo ON lt.line_no = lo.line_no
      LEFT JOIN line_realtime lr ON lt.line_no = lr.line_no
      ORDER BY lt.line_no;
    `;

    const result = await client.query(query, [date, now]);

    const lines = result.rows.map((row) => ({
      lineNo: row.line_no,
      totalTarget: parseFloat(row.total_target) || 0,
      totalSewed: parseFloat(row.total_sewed) || 0,
      operators: parseInt(row.operators_count) || 0,
      realtimeTarget: Math.round(parseFloat(row.realtime_target) * 100) / 100, // two decimals
      achievement: Math.round((parseFloat(row.achievement) || 0) * 100) / 100,
    }));

    res.json({ success: true, date, lines });
  } catch (err) {
    console.error("❌ /api/supervisor/line-performance error:", err.message);
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
app.get("/api/work-orders", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { status, lineNo, startDate, endDate } = req.query;
    
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
app.get("/api/work-orders/:id", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { id } = req.params;
    
    const result = await client.query(
      `
      SELECT 
        wo.*,
        json_agg(
          json_build_object(
            'id', la.id,
            'line_no', la.line_no,
            'assigned_date', la.assigned_date,
            'assigned_quantity', la.assigned_quantity,
            'status', la.status,
            'planned_start_date', la.planned_start_date,
            'planned_end_date', la.planned_end_date
          )
        ) FILTER (WHERE la.id IS NOT NULL) as assignments
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
app.post("/api/work-orders", authenticateToken, async (req, res) => {
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
app.put("/api/work-orders/:id", authenticateToken, async (req, res) => {
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
app.put("/api/work-orders/:id/status", authenticateToken, async (req, res) => {
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
app.delete("/api/work-orders/:id", authenticateToken, async (req, res) => {
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

// ========== LINE ASSIGNMENTS ==========

/**
 * GET /api/line-assignments
 * Get all line assignments with optional filters
 */
app.get("/api/line-assignments", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    
    const { lineNo, date, status, workOrderId } = req.query;
    
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
app.get("/api/line-assignments/:id", authenticateToken, async (req, res) => {
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

/**
 * POST /api/line-assignments
 * Create a new line assignment
 */
app.post("/api/line-assignments", authenticateToken, async (req, res) => {
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
    const calculatedEndDate = plannedEndDate || new Date(new Date(plannedStartDate || new Date()).setDate(
      new Date(plannedStartDate || new Date()).getDate() + Math.ceil(daysNeeded)
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
    
    // Update work order status to 'assigned' if it was pending
    if (workOrder.status === 'pending') {
      await client.query(
        `
        UPDATE work_orders
        SET status = 'assigned', updated_at = NOW()
        WHERE id = $1
        `,
        [workOrderId]
      );
    }
    
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
app.put("/api/line-assignments/:id", authenticateToken, async (req, res) => {
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
      SELECT la.*, wo.total_quantity, wo.work_order_no
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
    
    // If status is being updated to 'completed', check if all assignments for this work order are completed
    if (status === 'completed') {
      const remainingAssignments = await client.query(
        `
        SELECT COUNT(*) as incomplete
        FROM line_assignments
        WHERE work_order_id = $1 
          AND status NOT IN ('completed', 'cancelled')
          AND id != $2
        `,
        [assignment.work_order_id, id]
      );
      
      if (parseInt(remainingAssignments.rows[0].incomplete) === 0) {
        await client.query(
          `
          UPDATE work_orders
          SET status = 'completed', updated_at = NOW()
          WHERE id = $1
          `,
          [assignment.work_order_id]
        );
      }
    }
    
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
app.put("/api/line-assignments/:id/status", authenticateToken, async (req, res) => {
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
    
    // If completed, check if all assignments for this work order are completed
    if (status === 'completed') {
      const remainingAssignments = await client.query(
        `
        SELECT COUNT(*) as incomplete
        FROM line_assignments
        WHERE work_order_id = $1 AND status NOT IN ('completed', 'cancelled')
        `,
        [workOrderId]
      );
      
      if (parseInt(remainingAssignments.rows[0].incomplete) === 0) {
        await client.query(
          `
          UPDATE work_orders
          SET status = 'completed', updated_at = NOW()
          WHERE id = $1
          `,
          [workOrderId]
        );
      }
    }
    
    // If cancelled, check if we need to update work order status
    if (status === 'cancelled') {
      const activeAssignments = await client.query(
        `
        SELECT COUNT(*) as active
        FROM line_assignments
        WHERE work_order_id = $1 AND status IN ('planned', 'released', 'in_progress')
        `,
        [workOrderId]
      );
      
      if (parseInt(activeAssignments.rows[0].active) === 0) {
        await client.query(
          `
          UPDATE work_orders
          SET status = 'pending', updated_at = NOW()
          WHERE id = $1
          `,
          [workOrderId]
        );
      }
    }
    
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
app.delete("/api/line-assignments/:id", authenticateToken, async (req, res) => {
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
    
    // Check if work order has any active assignments left
    const activeAssignments = await client.query(
      `
      SELECT COUNT(*) as active
      FROM line_assignments
      WHERE work_order_id = $1 AND status IN ('planned', 'released', 'in_progress')
      `,
      [work_order_id]
    );
    
    if (parseInt(activeAssignments.rows[0].active) === 0) {
      await client.query(
        `
        UPDATE work_orders
        SET status = 'pending', updated_at = NOW()
        WHERE id = $1
        `,
        [work_order_id]
      );
    }
    
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

// ========== PLANNING DASHBOARD ENDPOINTS ==========

/**
 * GET /api/planning/dashboard
 * Get planning dashboard summary
 */
app.get("/api/planning/dashboard", authenticateToken, async (req, res) => {
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
        wo.customer_name
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

/**
 * GET /api/planning/available-lines
 * Get available lines for a specific date with their capacity
 */
app.get("/api/planning/available-lines", authenticateToken, async (req, res) => {
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
 * GET /api/planning/work-order-progress/:id
 * Get detailed progress for a specific work order
 */
app.get("/api/planning/work-order-progress/:id", authenticateToken, async (req, res) => {
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
      LEFT JOIN line_assignments la ON wo.id = la.work_order_id
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
      remaining_quantity: parseFloat(wo.quantity) - parseFloat(wo.total_assigned),
      assignments_count: parseInt(wo.assignments_count),
      completed_assignments: parseInt(wo.completed_assignments),
      percentage_assigned: (parseFloat(wo.total_assigned) / parseFloat(wo.quantity)) * 100,
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
        COALESCE(
          (SELECT SUM(sewed_qty) 
           FROM operation_sewed_entries se 
           JOIN operator_operations oo ON se.operation_id = oo.id
           JOIN run_operators ro ON oo.run_operator_id = ro.id
           WHERE ro.run_id = la.line_run_id
          ), 0
        ) as actual_production
      FROM line_assignments la
      LEFT JOIN line_runs lr ON la.line_run_id = lr.id
      WHERE la.work_order_id = $1
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
app.post("/api/planning/bulk-assign", authenticateToken, async (req, res) => {
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
        
        // Create assignment
        const result = await client.query(
          `
          INSERT INTO line_assignments (
            work_order_id,
            line_no,
            assigned_date,
            assigned_quantity,
            priority,
            created_at,
            updated_at,
            status
          )
          VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), 'planned')
          RETURNING id
          `,
          [
            workOrderId,
            lineNo,
            assignedDate,
            parseFloat(quantity),
            priority,
          ]
        );
        
        // Update work order status if needed
        await client.query(
          `
          UPDATE work_orders
          SET status = CASE 
            WHEN status = 'pending' THEN 'assigned'
            ELSE status
          END,
          updated_at = NOW()
          WHERE id = $1
          `,
          [workOrderId]
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

/**
 * GET /api/planning/capacity-report
 * Generate capacity report for a date range
 */
app.get("/api/planning/capacity-report", authenticateToken, async (req, res) => {
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
          lr.working_hours
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
        COALESCE(da.assigned_quantity, 0) as assigned_quantity,
        COALESCE(da.work_orders_count, 0) as work_orders_count,
        CASE 
          WHEN lc.daily_capacity > 0 
          THEN (COALESCE(da.assigned_quantity, 0) / lc.daily_capacity) * 100 
          ELSE 0 
        END as utilization_percentage
      FROM dates d
      CROSS JOIN line_capacity lc
      LEFT JOIN daily_assignments da ON d.report_date = da.assigned_date AND lc.line_no = da.line_no
      ORDER BY d.report_date, lc.line_no
      `,
      [startDate, endDate]
    );
    
    // Calculate summary statistics
    const summary = {
      total_days: report.rows.length,
      average_utilization: report.rows.reduce((sum, row) => sum + row.utilization_percentage, 0) / report.rows.length,
      total_capacity: report.rows.reduce((sum, row) => sum + parseFloat(row.daily_capacity || 0), 0),
      total_assigned: report.rows.reduce((sum, row) => sum + parseFloat(row.assigned_quantity), 0),
    };
    
    res.json({
      success: true,
      startDate,
      endDate,
      summary,
      report: report.rows,
    });
  } catch (err) {
    console.error("❌ Error generating capacity report:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// --------------------------------------------------------------
// update-working-hours (FIXED)
// --------------------------------------------------------------

// ✅ Update working hours for a run and recalculate target
app.put("/api/update-working-hours/:runId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { workingHours } = req.body;

    if (!workingHours || workingHours <= 0) {
      return res.status(400).json({
        success: false,
        error: "Valid working hours are required",
      });
    }

    // Get current run data
    const runResult = await client.query(
      `SELECT operators_count, sam_minutes, efficiency, target_pcs, target_per_hour
       FROM line_runs WHERE id = $1`,
      [runId]
    );

    if (runResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Run not found",
      });
    }

    const run = runResult.rows[0];
    
    // Recalculate target based on new working hours
    const operators = parseFloat(run.operators_count) || 0;
    const sam = parseFloat(run.sam_minutes) || 0;
    const efficiency = parseFloat(run.efficiency) || 0.7;
    const wh = parseFloat(workingHours);

    // Calculate new target
    const totalMinutes = operators * wh * 60;
    const piecesAt100 = sam > 0 ? totalMinutes / sam : 0;
    const newTarget = piecesAt100 * efficiency;
    
    // Calculate new target per hour
    const newTargetPerHour = wh > 0 ? newTarget / wh : 0;

    // Update the run with new working hours and recalculated targets
    await client.query(
      `UPDATE line_runs 
       SET working_hours = $1, 
           target_pcs = $2,
           target_per_hour = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [wh, newTarget, newTargetPerHour, runId]
    );

    // Also update slot targets (redistribute target across slots proportionally)
    const slotsResult = await client.query(
      `SELECT id, planned_hours FROM shift_slots WHERE run_id = $1 ORDER BY slot_order`,
      [runId]
    );

    if (slotsResult.rows.length > 0) {
      const totalPlannedHours = slotsResult.rows.reduce((sum, slot) => sum + parseFloat(slot.planned_hours), 0);
      
      let cumulativeTarget = 0;
      for (const slot of slotsResult.rows) {
        const slotHours = parseFloat(slot.planned_hours);
        const slotTarget = totalPlannedHours > 0 ? (slotHours / totalPlannedHours) * newTarget : 0;
        cumulativeTarget += slotTarget;

        await client.query(
          `UPDATE slot_targets 
           SET slot_target = $1, cumulative_target = $2, updated_at = NOW()
           WHERE run_id = $3 AND slot_id = $4`,
          [slotTarget, cumulativeTarget, runId, slot.id]
        );
      }
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Working hours updated successfully",
      newTarget,
      newTargetPerHour,
      workingHours: wh
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error updating working hours:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ========== add / delete operator ==========

app.post("/api/run/:runId/operators", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId } = req.params;
    const { operatorNo, operatorName } = req.body;

    if (!operatorNo) {
      return res.status(400).json({
        success: false,
        error: "Operator number is required",
      });
    }

    // Check if operator already exists in this run
    const existingOp = await client.query(
      `SELECT id FROM run_operators 
       WHERE run_id = $1 AND operator_no = $2`,
      [runId, parseInt(operatorNo)]
    );

    if (existingOp.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Operator ${operatorNo} already exists in this run`,
      });
    }

    // Insert new operator
    const result = await client.query(
      `INSERT INTO run_operators (run_id, operator_no, operator_name, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, operator_no, operator_name`,
      [runId, parseInt(operatorNo), operatorName || null]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Operator ${operatorNo} added successfully`,
      operator: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error adding operator:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Delete an operator from an existing run
app.delete("/api/run/:runId/operators/:operatorId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    const { runId, operatorId } = req.params;

    // Check if operator exists and belongs to this run
    const operatorCheck = await client.query(
      `SELECT id, operator_no FROM run_operators 
       WHERE id = $1 AND run_id = $2`,
      [operatorId, runId]
    );

    if (operatorCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Operator not found in this run",
      });
    }

    const operatorNo = operatorCheck.rows[0].operator_no;

    // Delete operator (cascades to operations and hourly entries due to foreign keys)
    await client.query(
      `DELETE FROM run_operators WHERE id = $1`,
      [operatorId]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Operator ${operatorNo} deleted successfully`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error deleting operator:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ✅ Get all operators for a run (with their operations count)
app.get("/api/run/:runId/operators", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);

    const { runId } = req.params;

    const result = await client.query(
      `SELECT 
        ro.id,
        ro.operator_no,
        ro.operator_name,
        ro.created_at,
        COUNT(oo.id) as operations_count
       FROM run_operators ro
       LEFT JOIN operator_operations oo ON ro.id = oo.run_operator_id
       WHERE ro.run_id = $1
       GROUP BY ro.id
       ORDER BY ro.operator_no`,
      [runId]
    );

    res.json({
      success: true,
      operators: result.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching operators:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ========== ENGINEER LINE BALANCING ==========

const requireEngineer = (req, res, next) => {
  if (req.user.role !== "engineer") {
    return res.status(403).json({
      success: false,
      error: "Access denied. Engineer role required.",
    });
  }
  next();
};

// ========== ENGINEER LINE BALANCING ==========

/**
 * GET /api/engineer/line-balancing/:runId
 * Returns line run details and operator capacities for balancing
 */
app.get("/api/engineer/line-balancing/:runId", authenticateToken, requireEngineer, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    const { runId } = req.params;

    // 1. Run details (including target_per_hour)
    const runRes = await client.query(
      `SELECT id, line_no, target_per_hour, working_hours, operators_count
       FROM line_runs WHERE id = $1`,
      [runId]
    );
    if (runRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Run not found" });
    }
    const run = runRes.rows[0];

    // 2. Operators with their operations and capacities
    const opsRes = await client.query(
      `SELECT
          ro.id AS operator_id,
          ro.operator_no,
          ro.operator_name,
          oo.id AS operation_id,
          oo.operation_name,
          oo.capacity_per_hour,
          -- average cycle time in seconds from t1..t5
          (COALESCE(oo.t1_sec,0) + COALESCE(oo.t2_sec,0) + COALESCE(oo.t3_sec,0) + COALESCE(oo.t4_sec,0) + COALESCE(oo.t5_sec,0))
          / NULLIF(
            (CASE WHEN oo.t1_sec IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN oo.t2_sec IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN oo.t3_sec IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN oo.t4_sec IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN oo.t5_sec IS NOT NULL THEN 1 ELSE 0 END), 0
          ) AS avg_cycle_sec
       FROM run_operators ro
       JOIN operator_operations oo ON ro.id = oo.run_operator_id
       WHERE ro.run_id = $1
       ORDER BY ro.operator_no, oo.id`,
      [runId]
    );

    // 3. Group by operator
    const operators = [];
    const operatorMap = new Map();
    for (const row of opsRes.rows) {
      if (!operatorMap.has(row.operator_id)) {
        operatorMap.set(row.operator_id, {
          operator_id: row.operator_id,
          operator_no: row.operator_no,
          operator_name: row.operator_name,
          operations: []
        });
        operators.push(operatorMap.get(row.operator_id));
      }
      operatorMap.get(row.operator_id).operations.push({
        operation_id: row.operation_id,
        operation_name: row.operation_name,
        capacity_per_hour: Number(row.capacity_per_hour),
        avg_cycle_sec: Number(row.avg_cycle_sec)
      });
    }

    res.json({
      success: true,
      run,
      operators
    });
  } catch (err) {
    console.error("❌ /api/engineer/line-balancing error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/engineer/line-balancing/:runId/assign
 * Save balancing assignments (fast operators helping slow ones)
 */
app.post("/api/engineer/line-balancing/:runId/assign", authenticateToken, requireEngineer, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");
    const { runId } = req.params;
    const { assignments } = req.body; // array of { sourceOperatorId, targetOperatorId, operationId, assignedQtyPerHour }

    for (const a of assignments) {
      await client.query(
        `INSERT INTO line_balancing_assignments
           (run_id, source_operator_id, target_operator_id, operation_id, assigned_quantity_per_hour)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (run_id, source_operator_id, target_operator_id, operation_id)
         DO UPDATE SET assigned_quantity_per_hour = EXCLUDED.assigned_quantity_per_hour,
                       updated_at = NOW()`,
        [runId, a.sourceOperatorId, a.targetOperatorId, a.operationId, a.assignedQtyPerHour]
      );
    }

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ /api/engineer/line-balancing/assign error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});
// ========== LINE LEADER ASSIGNMENTS ==========

/**
 * GET /api/lineleader/assignments/:runId
 * Returns balancing assignments for a specific run (for line leader view)
 */
app.get("/api/lineleader/assignments/:runId", authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    const { runId } = req.params;

    const query = `
      SELECT 
        lba.id,
        lba.source_operator_id,
        lba.target_operator_id,
        lba.operation_id,
        lba.assigned_quantity_per_hour,
        source.operator_no AS source_operator_no,
        source.operator_name AS source_operator_name,
        target.operator_no AS target_operator_no,
        target.operator_name AS target_operator_name,
        oo.operation_name
      FROM line_balancing_assignments lba
      JOIN run_operators source ON lba.source_operator_id = source.id
      JOIN run_operators target ON lba.target_operator_id = target.id
      JOIN operator_operations oo ON lba.operation_id = oo.id
      WHERE lba.run_id = $1
      ORDER BY source.operator_no, target.operator_no;
    `;
    const result = await client.query(query, [runId]);
    res.json({ success: true, assignments: result.rows });
  } catch (err) {
    console.error("❌ Error fetching lineleader assignments:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});


// ========== SUPERVISOR ASSIGNMENTS ==========

/**
 * GET /api/supervisor/assignments?date=YYYY-MM-DD
 * Returns aggregated assignments for a given date (total pieces helped = assigned_qty_per_hour * working_hours)
 */
app.get("/api/supervisor/assignments", authenticateToken, requireSupervisor, async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, error: "date parameter required" });
    }

    const query = `
      SELECT 
        lr.line_no,
        lba.source_operator_id,
        lba.target_operator_id,
        lba.assigned_quantity_per_hour,
        lr.working_hours,
        (lba.assigned_quantity_per_hour * lr.working_hours) AS total_helped_pieces,
        source.operator_no AS source_operator_no,
        source.operator_name AS source_operator_name,
        target.operator_no AS target_operator_no,
        target.operator_name AS target_operator_name
      FROM line_balancing_assignments lba
      JOIN line_runs lr ON lba.run_id = lr.id
      JOIN run_operators source ON lba.source_operator_id = source.id
      JOIN run_operators target ON lba.target_operator_id = target.id
      WHERE lr.run_date = $1
      ORDER BY lr.line_no, source.operator_no, target.operator_no;
    `;
    const result = await client.query(query, [date]);
    res.json({ success: true, assignments: result.rows });
  } catch (err) {
    console.error("❌ Error fetching supervisor assignments:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// ✅ Health check
app.get("/api/health", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("SELECT 1");
    res.json({
      success: true,
      message: "Server and database are running",
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

// ✅ Reset/clear all data (for testing)
app.post("/api/reset-database", async (req, res) => {
  const client = await pool.connect();
  try {
    await setSchema(client);
    await client.query("BEGIN");

    // Delete in correct order (respecting foreign keys)
    await client.query("DELETE FROM operation_sewed_entries");
    await client.query("DELETE FROM operation_hourly_entries");
    await client.query("DELETE FROM slot_targets");
    await client.query("DELETE FROM operator_operations");
    await client.query("DELETE FROM run_operators");
    await client.query("DELETE FROM shift_slots");
    await client.query("DELETE FROM line_runs");

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Database cleared successfully in prod_db_schema",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error resetting database:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// Initialize database connection
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log("✅ Connected to PostgreSQL successfully");

    await setSchema(client);

    const res = await client.query("SELECT current_schema(), current_database()");
    console.log("📋 Schema:", res.rows[0].current_schema);
    console.log("📋 Database:", res.rows[0].current_database);
    console.log("🕒 Server time:", new Date());

    // Create all tables after connection
    await createAllTables();

    client.release();
  } catch (err) {
    console.error("❌ Database connection failed");
    console.error(err.message);
  }
}

testConnection();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📁 Using schema: prod_db_schema`);
  console.log(`🗄️ Database: ${process.env.PG_DB || "prod_db"}`);
});

setInterval(() => {
  console.log("🟢 Server running, DB pool alive");
}, 30000);