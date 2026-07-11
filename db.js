const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  connectTimeout: 20000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

pool.on("connection", (conn) => {
  conn.on("error", (err) => {
    console.error("MySQL connection error:", err.code);
  });
});

// Railway/Render can silently close an idle pooled connection. The next
// query then throws "Connection lost". Retry once with a fresh connection.
const originalQuery = pool.query.bind(pool);
pool.query = async (...args) => {
  try {
    return await originalQuery(...args);
  } catch (err) {
    const retryable =
      err.code === "PROTOCOL_CONNECTION_LOST" ||
      err.code === "ECONNRESET" ||
      err.code === "ETIMEDOUT" ||
      /connection lost/i.test(err.message || "");
    if (!retryable) throw err;
    console.warn("DB connection was stale, retrying query once:", err.code || err.message);
    return await originalQuery(...args);
  }
};

// Keep the MySQL session alive at the protocol level, not just TCP.
setInterval(() => {
  pool.query("SELECT 1").catch((e) => console.warn("Keep-alive ping failed:", e.message));
}, 4 * 60 * 1000);

module.exports = pool;
