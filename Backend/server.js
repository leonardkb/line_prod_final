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
  connectionTimeoutMillis: 5000
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
        CONSTRAINT chk_role CHECK (role IN ('engineer', 'line_leader', 'supervisor')),
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
        username: 'engineer',
        password: 'engineer',
        role: 'engineer',
        full_name: 'System Engineer'
      }
    ];
    
    // Add line leaders 1-26
    for (let i = 1; i <= 26; i++) {
      defaultUsers.push({
        username: `line${i}`,
        password: `line${i}`,
        role: 'line_leader',
        line_number: i,
        full_name: `Line ${i} Leader`
      });
    }
    
    // Add a supervisor
    defaultUsers.push({
      username: 'supervisor',
      password: 'supervisor123',
      role: 'supervisor',
      full_name: 'Production Supervisor'
    });
    
    let createdCount = 0;
    let updatedCount = 0;
    
    for (const user of defaultUsers) {
      // Check if user exists
      const existingUser = await client.query(
        'SELECT id FROM users WHERE username = $1',
        [user.username]
      );
      
      if (existingUser.rows.length === 0) {
        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(user.password, saltRounds);
        
        // Insert new user
        await client.query(`
          INSERT INTO users (username, password_hash, role, line_number, full_name, is_active)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          user.username,
          passwordHash,
          user.role,
          user.line_number || null,
          user.full_name || user.username,
          true
        ]);
        createdCount++;
        console.log(`✅ Created user: ${user.username} (${user.role})`);
      } else {
        // Update existing user's password if needed
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(user.password, saltRounds);
        
        await client.query(`
          UPDATE users 
          SET password_hash = $1, updated_at = NOW()
          WHERE username = $2
        `, [passwordHash, user.username]);
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
        error: "Username and password are required"
      });
    }
    
    // Find user
    const userResult = await client.query(`
      SELECT id, username, password_hash, role, line_number, full_name, is_active
      FROM users 
      WHERE username = $1 AND is_active = TRUE
    `, [username]);
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: "Invalid username or password"
      });
    }
    
    const user = userResult.rows[0];
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: "Invalid username or password"
      });
    }
    
    // Remove password hash from response
    delete user.password_hash;
    
    // Generate a simple token (in production, use JWT)
    const token = Buffer.from(`${user.id}:${Date.now()}`).toString('base64');
    
    res.json({
      success: true,
      message: "Login successful",
      user: user,
      token: token
    });
    
  } catch (err) {
    console.error("❌ Login error:", err.message);
    res.status(500).json({
      success: false,
      error: "Internal server error"
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
    
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }
    
    // Simple token validation
    const decoded = Buffer.from(token, 'base64').toString('ascii');
    const [userId, timestamp] = decoded.split(':');
    
    // Check if token is not too old (24 hours)
    const tokenAge = Date.now() - parseInt(timestamp);
    const MAX_TOKEN_AGE = 24 * 60 * 60 * 1000; // 24 hours
    
    if (tokenAge > MAX_TOKEN_AGE) {
      return res.status(401).json({
        success: false,
        error: "Session expired"
      });
    }
    
    // Verify user exists and is active
    const userResult = await client.query(`
      SELECT id, username, role, line_number, full_name
      FROM users 
      WHERE id = $1 AND is_active = TRUE
    `, [parseInt(userId)]);
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: "User not found or inactive"
      });
    }
    
    req.user = userResult.rows[0];
    next();
  } catch (err) {
    console.error("❌ Authentication error:", err.message);
    res.status(401).json({
      success: false,
      error: "Invalid authentication token"
    });
  } finally {
    client.release();
  }
};

// ✅ Get current user info
app.get("/api/me", authenticateToken, async (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// ✅ Logout endpoint
app.post("/api/logout", (req, res) => {
  res.json({
    success: true,
    message: "Logged out successfully"
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
        error: "Missing required fields" 
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
      parseFloat(targetPerHour) || 0
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
          parseFloat(slot.hours) || 0
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
      slotIds
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error saving production data:", err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message 
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
    
    const { 
      runId, 
      operations, 
      slotTargets, 
      cumulativeTargets 
    } = req.body;

    if (!runId || !operations || !Array.isArray(operations)) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required data" 
      });
    }

    // Verify run exists
    const runCheck = await client.query(
      "SELECT id FROM line_runs WHERE id = $1",
      [runId]
    );
    
    if (runCheck.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: "Line run not found" 
      });
    }

    // Get slot IDs for this run
    const slotsResult = await client.query(
      "SELECT id, slot_label FROM shift_slots WHERE run_id = $1 ORDER BY slot_order",
      [runId]
    );
    
    const slotMap = {};
    slotsResult.rows.forEach(slot => {
      slotMap[slot.slot_label] = slot.id;
    });

    // Process each operation row
    const operatorMap = {};
    let savedOperations = 0;
    
    for (const operation of operations) {
      const { 
        operatorNo, 
        operatorName, 
        operation: operationName, 
        t1, t2, t3, t4, t5, 
        capacityPerHour
      } = operation;

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
          
          const operatorResult = await client.query(operatorQuery, [
            runId,
            opNo,
            operatorName || null
          ]);
          
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
          operationName || 'Unnamed Operation',
          t1 ? parseFloat(t1) : null,
          t2 ? parseFloat(t2) : null,
          t3 ? parseFloat(t3) : null,
          t4 ? parseFloat(t4) : null,
          t5 ? parseFloat(t5) : null,
          capacityPerHour || 0
        ]);
        
        savedOperations++;
        console.log(`✅ Operation "${operationName || 'Unnamed'}" saved for operator ${opNo}: ID ${opResult.rows[0].id}`);
        
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
        
        await client.query(slotTargetQuery, [
          runId,
          slot.id,
          parseFloat(slotTarget),
          parseFloat(cumulativeTarget)
        ]);
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
      operatorCount: Object.keys(operatorMap).length
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error saving operations data:", err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  } finally {
    client.release();
  }
});

// ✅ User management endpoints (for engineers/supervisors only)
const requireEngineerOrSupervisor = (req, res, next) => {
  if (req.user.role !== 'engineer' && req.user.role !== 'supervisor') {
    return res.status(403).json({
      success: false,
      error: "Access denied. Engineer or supervisor role required."
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
          ELSE 4
        END,
        line_number NULLS FIRST,
        username
    `);
    
    res.json({
      success: true,
      users: result.rows
    });
  } catch (err) {
    console.error("❌ Error fetching users:", err.message);
    res.status(500).json({
      success: false,
      error: err.message
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
        error: "Username, password, and role are required"
      });
    }
    
    // Validate role
    const validRoles = ['engineer', 'line_leader', 'supervisor'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: "Invalid role. Must be 'engineer', 'line_leader', or 'supervisor'"
      });
    }
    
    // Validate line_number for line leaders
    if (role === 'line_leader') {
      if (!line_number || line_number < 1 || line_number > 26) {
        return res.status(400).json({
          success: false,
          error: "Line leaders must have a line number between 1 and 26"
        });
      }
      
      // Check if line number is already assigned
      const existingLineUser = await client.query(`
        SELECT username FROM users 
        WHERE role = 'line_leader' AND line_number = $1 AND is_active = TRUE
      `, [line_number]);
      
      if (existingLineUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Line ${line_number} is already assigned to user: ${existingLineUser.rows[0].username}`
        });
      }
    }
    
    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    const result = await client.query(`
      INSERT INTO users (username, password_hash, role, line_number, full_name, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, username, role, line_number, full_name, is_active, created_at
    `, [
      username,
      passwordHash,
      role,
      line_number || null,
      full_name || username,
      true
    ]);
    
    res.json({
      success: true,
      message: "User created successfully",
      user: result.rows[0]
    });
    
  } catch (err) {
    console.error("❌ Error creating user:", err.message);
    
    if (err.code === '23505') { // Unique violation
      res.status(400).json({
        success: false,
        error: "Username already exists"
      });
    } else {
      res.status(500).json({
        success: false,
        error: err.message
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
    
    if (updates.length === 1) { // Only updated_at was added
      return res.status(400).json({
        success: false,
        error: "No fields to update"
      });
    }
    
    values.push(id);
    
    const query = `
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = $${valueIndex}
      RETURNING id, username, role, line_number, full_name, is_active, created_at, updated_at
    `;
    
    const result = await client.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }
    
    res.json({
      success: true,
      message: "User updated successfully",
      user: result.rows[0]
    });
    
  } catch (err) {
    console.error("❌ Error updating user:", err.message);
    res.status(500).json({
      success: false,
      error: err.message
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
        error: "Cannot delete your own account"
      });
    }
    
    const result = await client.query(`
      UPDATE users 
      SET is_active = FALSE, updated_at = NOW()
      WHERE id = $1 AND is_active = TRUE
      RETURNING id, username
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found or already inactive"
      });
    }
    
    res.json({
      success: true,
      message: "User deactivated successfully"
    });
    
  } catch (err) {
    console.error("❌ Error deleting user:", err.message);
    res.status(500).json({
      success: false,
      error: err.message
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
        error: "Missing hourly data entries" 
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
        const opResult = await client.query(`
          SELECT o.id as op_id, ro.id as operator_id
          FROM operator_operations o
          JOIN run_operators ro ON o.run_operator_id = ro.id
          WHERE o.run_id = $1 
            AND ro.operator_no = $2 
            AND o.operation_name = $3
          LIMIT 1
        `, [runId, parseInt(operatorNo), operationName]);
        
        if (opResult.rows.length === 0) {
          console.warn(`⚠️ Operation not found: ${operatorNo} - ${operationName}. Creating it now...`);
          
          // Try to create the operation if it doesn't exist
          const createOpResult = await client.query(`
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
          `, [runId, parseInt(operatorNo), `Operator ${operatorNo}`, operationName]);
          
          if (createOpResult.rows.length === 0) {
            console.warn(`❌ Failed to create operation: ${operatorNo} - ${operationName}`);
            skippedCount++;
            continue;
          }
          
          var operationId = createOpResult.rows[0].id;
          console.log(`✅ Created missing operation: ${operatorNo} - ${operationName} (ID: ${operationId})`);
        } else {
          var operationId = opResult.rows[0].op_id;
        }
        
        // Get slot ID
        const slotResult = await client.query(
          "SELECT id FROM shift_slots WHERE run_id = $1 AND slot_label = $2",
          [runId, slotLabel]
        );
        
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
        
        await client.query(hourlyQuery, [
          runId,
          operationId,
          slotId,
          parseFloat(stitchedQty) || 0
        ]);
        
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
      skippedCount
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error saving hourly data:", err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message 
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
        error: "Missing entries array"
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
      const slotResult = await client.query(
        `SELECT id FROM shift_slots WHERE run_id = $1 AND slot_label = $2 LIMIT 1`,
        [runId, slotLabel]
      );

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
    const runResult = await client.query(
      "SELECT * FROM line_runs WHERE id = $1",
      [runId]
    );

    if (runResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Run not found"
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
        operations: operationsResult.rows
      });
    }

    return res.json({
      success: true,
      run: runData,
      slots: slotsResult.rows,
      operators: operatorsResult.rows,
      operations: operationsData,
      slotTargets: slotTargetsResult.rows
    });

  } catch (err) {
    console.error("❌ Error fetching run data:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message
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
      runs: result.rows
    });
  } catch (err) {
    console.error("❌ Error fetching line runs:", err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message 
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
      WHERE line_no = $1
      ORDER BY run_date DESC
    `, [lineNo]);
    
    res.json({
      success: true,
      runs: result.rows
    });
  } catch (err) {
    console.error("❌ Error fetching line runs by line:", err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message 
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
    const runResult = await client.query(
      "SELECT * FROM line_runs WHERE id = $1",
      [runId]
    );
    
    if (runResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: "Run not found" 
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
        operations: operationsResult.rows
      });
    }
    
    res.json({
      success: true,
      run: runData,
      slots: slotsResult.rows,
      operators: operatorsResult.rows,
      operations: operationsData,
      slotTargets: slotTargetsResult.rows
    });
    
  } catch (err) {
    console.error("❌ Error fetching run data:", err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message 
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
        error: "Missing hourly data entries" 
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
      const opResult = await client.query(`
        SELECT o.id as op_id
        FROM operator_operations o
        JOIN run_operators ro ON o.run_operator_id = ro.id
        WHERE o.run_id = $1 
          AND ro.operator_no = $2 
          AND o.operation_name = $3
        LIMIT 1
      `, [runId, parseInt(operatorNo), operationName]);
      
      if (opResult.rows.length === 0) {
        console.warn(`⚠️ Operation not found: ${operatorNo} - ${operationName}`);
        continue;
      }
      
      const operationId = opResult.rows[0].op_id;
      
      // Get slot ID
      const slotResult = await client.query(
        "SELECT id FROM shift_slots WHERE run_id = $1 AND slot_label = $2",
        [runId, slotLabel]
      );
      
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
      const hourlyQuery = existingResult.rows.length > 0 ? `
        UPDATE operation_hourly_entries 
        SET stitched_qty = $1, updated_at = NOW()
        WHERE operation_id = $2 AND slot_id = $3
        RETURNING id
      ` : `
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
      
      const params = existingResult.rows.length > 0 
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
      updatedCount
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error updating hourly data:", err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message 
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
        error: "Missing operator number or operation name" 
      });
    }
    
    // Get or create operator
    const operatorResult = await client.query(`
      INSERT INTO run_operators (run_id, operator_no, operator_name, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (run_id, operator_no) 
      DO UPDATE SET operator_name = EXCLUDED.operator_name
      RETURNING id
    `, [runId, parseInt(operatorNo), operatorName || null]);
    
    const operatorId = operatorResult.rows[0].id;
    
    // Add operation
    const operationResult = await client.query(`
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
    `, [
      runId,
      operatorId,
      operationName,
      t1 ? parseFloat(t1) : null,
      t2 ? parseFloat(t2) : null,
      t3 ? parseFloat(t3) : null,
      t4 ? parseFloat(t4) : null,
      t5 ? parseFloat(t5) : null,
      capacityPerHour || 0
    ]);
    
    await client.query("COMMIT");
    
    res.json({ 
      success: true, 
      message: "Operation added successfully",
      operationId: operationResult.rows[0].id
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error adding operation:", err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
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
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: "Database connection failed" 
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
      message: "Database cleared successfully in prod_db_schema" 
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error resetting database:", err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message 
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
  console.log(`🗄️ Database: ${process.env.PG_DB || 'prod_db'}`);
});

setInterval(() => {
  console.log("🟢 Server running, DB pool alive");
}, 30000);