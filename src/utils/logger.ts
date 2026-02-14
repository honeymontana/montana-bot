import * as winston from 'winston';
import * as path from 'path';
import { config } from '../config';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6,
};

// Define colors for log levels
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  verbose: 'cyan',
  debug: 'white',
  silly: 'gray',
};

winston.addColors(colors);

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Define log transports
const transports: winston.transport[] = [];

// Console transport
if (config.logging.format === 'pretty') {
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.printf(
          (info) =>
            `${info.timestamp} ${info.level}: ${info.message}${info.stack ? `\n${info.stack}` : ''}`
        )
      ),
    })
  );
} else {
  transports.push(new winston.transports.Console());
}

// File transport for errors
transports.push(
  new winston.transports.File({
    filename: path.join('logs', 'error.log'),
    level: 'error',
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  })
);

// File transport for all logs
transports.push(
  new winston.transports.File({
    filename: path.join('logs', 'combined.log'),
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  })
);

// Create the logger
const logger = winston.createLogger({
  level: config.logging.level,
  levels,
  format,
  transports,
  exitOnError: false,
});

// Create a stream object for Morgan middleware
export const stream = {
  write: (message: string) => {
    logger.info(message.substring(0, message.lastIndexOf('\n')));
  },
};

// Export logger methods
export const log = {
  error: (message: string, meta?: any) => {
    logger.error(message, meta);
  },
  warn: (message: string, meta?: any) => {
    logger.warn(message, meta);
  },
  info: (message: string, meta?: any) => {
    logger.info(message, meta);
  },
  http: (message: string, meta?: any) => {
    logger.http(message, meta);
  },
  verbose: (message: string, meta?: any) => {
    logger.verbose(message, meta);
  },
  debug: (message: string, meta?: any) => {
    logger.debug(message, meta);
  },
  silly: (message: string, meta?: any) => {
    logger.silly(message, meta);
  },
};

export default logger;
