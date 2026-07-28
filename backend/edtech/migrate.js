// One-off migration script. Run with: node migrate.js
// Adds any missing columns used by the dashboard's course-hierarchy and
// arrange/priority features, and ensures constraints required by quiz
// submission logic. Safe to run multiple times -- it checks before
// adding each column/constraint, so nothing breaks if some already exist.

import pool from "./config/database.js";

async function ensureColumnOn(tableName, columnName, columnDefinitionSql) {
  const check = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = $1 AND column_name = $2
  `, [tableName, columnName]);

  if (check.rows.length > 0) {
    console.log(`Column '${tableName}.${columnName}' already exists. Nothing to do.`);
  } else {
    console.log(`Column '${tableName}.${columnName}' not found. Adding it now...`);
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinitionSql}`);
    console.log(`Column '${tableName}.${columnName}' added successfully.`);
  }
}

// kept for backward compatibility with the courses-table calls below
async function ensureColumn(columnName, columnDefinitionSql) {
  await ensureColumnOn("courses", columnName, columnDefinitionSql);
}

// Ensures ON CONFLICT (attempt_id, question_id) works in the quiz submit/answer
// routes -- an answer resubmitted for the same question in the same attempt
// should update the existing row instead of erroring or duplicating.
async function ensureUniqueConstraint(tableName, constraintName, columns) {
  const check = await pool.query(`
    SELECT 1 FROM pg_constraint WHERE conname = $1
  `, [constraintName]);

  if (check.rows.length > 0) {
    console.log(`Constraint '${constraintName}' already exists. Nothing to do.`);
  } else {
    console.log(`Constraint '${constraintName}' not found. Adding it now...`);
    await pool.query(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} UNIQUE (${columns})`);
    console.log(`Constraint '${constraintName}' added successfully.`);
  }
}

async function migrate() {
  try {
    console.log("Checking required columns on the courses table...");
    console.log("");

    // Links a sub-course (e.g. "Mathematics") to its parent (e.g. "9th Class").
    await ensureColumn("parent_course_id", "parent_course_id UUID REFERENCES courses(id) DEFAULT NULL");

    // Stores the mentor's manual priority/order for arranging courses.
    await ensureColumn("display_order", "display_order INTEGER DEFAULT 0");

    const verify = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'courses'
      ORDER BY ordinal_position
    `);
    console.log("");
    console.log("Current courses table columns:");
    verify.rows.forEach(r => console.log(" - " + r.column_name + " (" + r.data_type + ")"));

    console.log("");
    console.log("Checking required columns on the quiz_attempts table...");
    console.log("");

    // The submit/answer routes stamp updated_at whenever an attempt changes.
    await ensureColumnOn("quiz_attempts", "updated_at", "updated_at TIMESTAMP DEFAULT NOW()");

    const verifyAttempts = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'quiz_attempts'
      ORDER BY ordinal_position
    `);
    console.log("");
    console.log("Current quiz_attempts table columns:");
    verifyAttempts.rows.forEach(r => console.log(" - " + r.column_name + " (" + r.data_type + ")"));

    console.log("");
    console.log("Checking required constraints on the quiz_answers table...");
    console.log("");

    await ensureUniqueConstraint(
      "quiz_answers",
      "quiz_answers_attempt_question_unique",
      "attempt_id, question_id"
    );

  } catch (err) {
    console.error("Migration failed:", err.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

migrate();