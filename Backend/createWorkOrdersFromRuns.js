// createWorkOrdersFromRuns.js - MODIFIED VERSION
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  database: process.env.PG_DB,
  user: process.env.PG_USER,
  password: String(process.env.PG_PASSWORD || ""),
  ssl: false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function createWorkOrdersFromExistingRuns() {
  const client = await pool.connect();
  try {
    await client.query("SET search_path TO prod_db_schema");
    console.log("🔄 Starting migration: Creating work orders from existing runs...");

    // First, delete all existing work orders and assignments to start fresh
    console.log("🗑️ Cleaning up existing work orders and assignments...");
    await client.query("DELETE FROM line_assignments");
    await client.query("DELETE FROM work_orders");
    await client.query("ALTER SEQUENCE work_orders_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE line_assignments_id_seq RESTART WITH 1");
    console.log("✅ Cleanup complete");

    // Get all distinct styles from line_runs
    const runsResult = await client.query(`
      SELECT 
        style,
        MIN(run_date) as first_run_date,
        MAX(run_date) as last_run_date,
        COUNT(*) as run_count,
        AVG(target_pcs) as avg_target,
        AVG(sam_minutes) as avg_sam,
        AVG(working_hours) as avg_hours,
        AVG(operators_count) as avg_operators,
        -- Get the most recent line run for this style
        (SELECT line_no FROM line_runs lr2 
         WHERE lr2.style = line_runs.style 
         ORDER BY lr2.run_date DESC LIMIT 1) as suggested_line_no
      FROM line_runs
      GROUP BY style
      ORDER BY style
    `);

    console.log(`📋 Found ${runsResult.rows.length} unique styles to process\n`);

    let createdCount = 0;

    for (const run of runsResult.rows) {
      const styleKey = run.style;
      console.log(`📦 Processing style: "${styleKey}"`);
      
      // Calculate total quantity based on historical runs
      // But leave as pending - don't auto-assign
      const totalQuantity = Math.round(run.avg_target * run.run_count);
      
      // Create a clean work order number
      const sanitizedStyle = styleKey.replace(/[^a-zA-Z0-9]/g, '-');
      const workOrderNo = `WO-${sanitizedStyle}-${new Date().getFullYear()}`;
      
      console.log(`   📝 Creating work order: ${workOrderNo}`);
      console.log(`   📊 Total Quantity: ${totalQuantity.toLocaleString()} pieces (based on ${run.run_count} historical runs)`);
      console.log(`   📍 Suggested Line: ${run.suggested_line_no || 'Not specified'}`);
      
      try {
        // Create work order with PENDING status (not completed)
        await client.query(
          `INSERT INTO work_orders (
            work_order_no,
            quantity,
            customer_name,
            style_description,
            style_code,
            line_no,
            created_at,
            updated_at,
            status
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), 'pending')`,
          [
            workOrderNo,
            totalQuantity,
            "Historical Production", // Default customer name
            styleKey,
            styleKey,
            run.suggested_line_no || null, // Suggest a line but don't assign
          ]
        );
        
        createdCount++;
        console.log(`   ✅ Created pending work order for ${totalQuantity.toLocaleString()} pieces`);
        
      } catch (err) {
        if (err.code === '23505') {
          // Duplicate key - try with timestamp
          console.log(`   ⚠️ Duplicate work order number, trying with timestamp...`);
          const fallbackWorkOrderNo = `WO-${sanitizedStyle}-${Date.now()}`;
          
          await client.query(
            `INSERT INTO work_orders (
              work_order_no,
              quantity,
              customer_name,
              style_description,
              style_code,
              line_no,
              created_at,
              updated_at,
              status
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), 'pending')`,
            [
              fallbackWorkOrderNo,
              totalQuantity,
              "Historical Production",
              styleKey,
              styleKey,
              run.suggested_line_no || null,
            ]
          );
          
          createdCount++;
          console.log(`   ✅ Created pending work order with timestamp: ${fallbackWorkOrderNo}`);
        } else {
          throw err;
        }
      }
    }

    console.log(`\n${"=".repeat(50)}`);
    console.log(`📊 MIGRATION SUMMARY`);
    console.log(`${"=".repeat(50)}`);
    console.log(`   ✅ Work orders created: ${createdCount}`);
    console.log(`   📍 Assignments created: 0 (all pending assignment)`);
    
    // Show final summary
    const summary = await client.query(`
      SELECT 
        COUNT(*) as total_work_orders,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'assigned' THEN 1 END) as assigned,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed
      FROM work_orders
    `);
    
    const assignmentsSummary = await client.query(`
      SELECT COUNT(*) as total_assignments FROM line_assignments
    `);
    
    console.log(`\n📈 CURRENT DATABASE STATUS:`);
    console.log(`   Work Orders:`);
    console.log(`      Total: ${summary.rows[0].total_work_orders}`);
    console.log(`      Pending: ${summary.rows[0].pending}`);
    console.log(`      Assigned: ${summary.rows[0].assigned}`);
    console.log(`      In Progress: ${summary.rows[0].in_progress}`);
    console.log(`      Completed: ${summary.rows[0].completed}`);
    console.log(`   Assignments:`);
    console.log(`      Total: ${assignmentsSummary.rows[0].total_assignments}`);
    
    // List all work orders created
    const allWorkOrders = await client.query(`
      SELECT work_order_no, style_description, quantity, status, line_no
      FROM work_orders 
      ORDER BY created_at DESC
      LIMIT 20
    `);
    
    console.log(`\n📋 CREATED WORK ORDERS (ALL PENDING):`);
    allWorkOrders.rows.forEach(wo => {
      const styleDisplay = wo.style_description ? wo.style_description.substring(0, 40) : 'N/A';
      console.log(`   ${wo.work_order_no} - ${styleDisplay}`);
      console.log(`      Quantity: ${Math.round(wo.quantity).toLocaleString()} pzas | Status: ${wo.status} | Suggested Line: ${wo.line_no || 'None'}`);
    });

    console.log(`\n💡 NEXT STEPS:`);
    console.log(`   1. Go to the Planning Dashboard`);
    console.log(`   2. Review pending work orders`);
    console.log(`   3. Assign quantities to specific lines based on capacity`);
    console.log(`   4. The system will calculate days needed automatically`);

  } catch (err) {
    console.error("❌ Migration error:", err.message);
    console.error("Stack trace:", err.stack);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the migration
createWorkOrdersFromExistingRuns()
  .then(() => console.log("\n✅ Migration completed successfully! All work orders are pending assignment."))
  .catch(err => {
    console.error("\n❌ Migration failed:", err.message);
    process.exit(1);
  });
