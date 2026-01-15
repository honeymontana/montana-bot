import { Pool, PoolClient } from 'pg';
import { config } from '../config';
import { log } from '../utils/logger';

// Create PostgreSQL connection pool
export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  max: config.database.max,
  idleTimeoutMillis: config.database.idleTimeoutMillis,
  connectionTimeoutMillis: config.database.connectionTimeoutMillis,
});

// Handle pool errors
pool.on('error', (err: Error) => {
  log.error('Unexpected error on idle database client', err);
});

// Test database connection
export async function testConnection(): Promise<boolean> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    log.info('Database connected successfully', {
      time: result.rows[0].now,
    });
    return true;
  } catch (error) {
    log.error('Failed to connect to database', error);
    return false;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Query helper function
export async function query(text: string, params?: any[]): Promise<any> {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    log.debug('Executed query', { text, duration, rows: result.rowCount });
    return result;
  } catch (error) {
    log.error('Database query error', { text, error });
    throw error;
  }
}

// Transaction helper function
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Graceful shutdown
export async function closeDatabase(): Promise<void> {
  try {
    await pool.end();
    log.info('Database connection pool closed');
  } catch (error) {
    log.error('Error closing database connection pool', error);
  }
}