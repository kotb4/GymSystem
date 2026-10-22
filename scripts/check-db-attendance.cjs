const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");

const dbPath = path.join(process.env.LOCALAPPDATA, "GymGate", "Database", "gym.db");
const db = new DatabaseSync(dbPath);

const setting = db.prepare("SELECT value FROM settings WHERE key = 'attendance_auto_checkout_overdue'").get();
console.log("attendance_auto_checkout_overdue:", setting);

const duration = db.prepare("SELECT value FROM settings WHERE key = 'occupancy_duration_minutes'").get();
console.log("occupancy_duration_minutes:", duration);

const openAttendance = db.prepare("SELECT id, member_id, checkin_at, checkout_at FROM attendance WHERE deleted_at IS NULL AND checkout_at IS NULL").all();
console.log("Open attendance rows count:", openAttendance.length);
for (const row of openAttendance) {
  console.log(row);
}
