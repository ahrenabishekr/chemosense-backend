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

module.exports = pool;
