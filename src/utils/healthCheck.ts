/**
 * Health check utilities for monitoring system status
 */

import { pool } from '../database/connection';
import { log } from './logger';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  checks: {
    database: HealthStatus;
    memory: HealthStatus;
    bot?: HealthStatus;
    discord?: HealthStatus;
  };
}

export interface HealthStatus {
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  responseTime?: number;
  details?: any;
}

/**
 * Check database connectivity
 */
export async function checkDatabase(): Promise<HealthStatus> {
  const startTime = Date.now();
  try {
    const result = await pool.query('SELECT 1 AS health');
    const responseTime = Date.now() - startTime;

    if (responseTime > 1000) {
      return {
        status: 'warn',
        message: 'Database response time is slow',
        responseTime,
      };
    }

    return {
      status: 'pass',
      responseTime,
      details: {
        totalConnections: pool.totalCount,
        idleConnections: pool.idleCount,
        waitingClients: pool.waitingCount,
      },
    };
  } catch (error) {
    return {
      status: 'fail',
      message: error instanceof Error ? error.message : 'Database connection failed',
      responseTime: Date.now() - startTime,
    };
  }
}

/**
 * Check memory usage
 */
export function checkMemory(): HealthStatus {
  const memoryUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
  const heapUsagePercent = (heapUsedMB / heapTotalMB) * 100;

  if (heapUsagePercent > 90) {
    return {
      status: 'fail',
      message: 'Memory usage critical',
      details: {
        heapUsedMB,
        heapTotalMB,
        heapUsagePercent: heapUsagePercent.toFixed(2),
      },
    };
  }

  if (heapUsagePercent > 75) {
    return {
      status: 'warn',
      message: 'Memory usage high',
      details: {
        heapUsedMB,
        heapTotalMB,
        heapUsagePercent: heapUsagePercent.toFixed(2),
      },
    };
  }

  return {
    status: 'pass',
    details: {
      heapUsedMB,
      heapTotalMB,
      heapUsagePercent: heapUsagePercent.toFixed(2),
      rssMB: Math.round(memoryUsage.rss / 1024 / 1024),
    },
  };
}

/**
 * Perform full health check
 */
export async function performHealthCheck(): Promise<HealthCheckResult> {
  const checks = {
    database: await checkDatabase(),
    memory: checkMemory(),
  };

  // Determine overall status
  const hasFailures = Object.values(checks).some((check) => check.status === 'fail');
  const hasWarnings = Object.values(checks).some((check) => check.status === 'warn');

  let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  if (hasFailures) {
    overallStatus = 'unhealthy';
  } else if (hasWarnings) {
    overallStatus = 'degraded';
  } else {
    overallStatus = 'healthy';
  }

  const result: HealthCheckResult = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks,
  };

  // Log health check results
  if (overallStatus !== 'healthy') {
    log.warn('Health check detected issues', result);
  }

  return result;
}

/**
 * Readiness check - is the service ready to accept traffic?
 */
export async function checkReadiness(): Promise<boolean> {
  try {
    const dbCheck = await checkDatabase();
    return dbCheck.status !== 'fail';
  } catch (error) {
    log.error('Readiness check failed', error);
    return false;
  }
}

/**
 * Liveness check - is the service alive?
 */
export function checkLiveness(): boolean {
  return true; // If this code executes, the process is alive
}
