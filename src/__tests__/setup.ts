import * as dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Mock logger to reduce noise in tests
jest.mock('../utils/logger', () => ({
  log: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    http: jest.fn(),
    verbose: jest.fn(),
    debug: jest.fn(),
    silly: jest.fn(),
  },
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    http: jest.fn(),
    verbose: jest.fn(),
    debug: jest.fn(),
    silly: jest.fn(),
  },
}));

describe('Test Setup', () => {
  it('should load test environment', () => {
    expect(process.env.NODE_ENV).toBeDefined();
  });
});
