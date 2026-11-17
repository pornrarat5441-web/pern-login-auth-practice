import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.DATABASE_URL);

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false,
        },
      }
    : {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: isProduction ? { rejectUnauthorized: false } : false,
      }
);

pool.on("connect", () => {
  console.log("Connected to the database");
});

pool.on("error", (err) => {
  console.error("database error", err);
});

export default pool;