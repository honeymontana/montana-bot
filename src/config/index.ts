import * as dotenv from 'dotenv';
import * as Joi from 'joi';

// Load environment variables
dotenv.config();

// Define configuration schema
const configSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  BOT_TOKEN: Joi.string().required(),
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_NAME: Joi.string().default('montana_bot'),
  DB_USER: Joi.string().default('montana'),
  DB_PASSWORD: Joi.string().required(),
  MAIN_GROUP_ID: Joi.string().required(),
  CHECK_INTERVAL_MINUTES: Joi.number().min(1).default(5),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug')
    .default('info'),
  ADMIN_IDS: Joi.string().default(''),
  TEST_MODE: Joi.boolean().default(false),
  TELEGRAM_API_ID: Joi.number().optional(),
  TELEGRAM_API_HASH: Joi.string().optional(),
  TELEGRAM_PHONE_NUMBER: Joi.string().optional(),
  TELEGRAM_SESSION_STRING: Joi.string().optional().default(''),
});

// Validate environment variables
const { error, value: envVars } = configSchema.validate(process.env, {
  allowUnknown: true,
  abortEarly: false,
});

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export const config = {
  env: envVars.NODE_ENV as string,
  bot: {
    token: envVars.BOT_TOKEN as string,
    polling: {
      interval: 300,
      autoStart: true,
      params: {
        timeout: 10,
      },
    },
  },
  database: {
    host: envVars.DB_HOST as string,
    port: envVars.DB_PORT as number,
    database: envVars.DB_NAME as string,
    user: envVars.DB_USER as string,
    password: envVars.DB_PASSWORD as string,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
  telegram: {
    mainGroupId: envVars.MAIN_GROUP_ID as string,
    checkIntervalMinutes: envVars.CHECK_INTERVAL_MINUTES as number,
    adminIds: envVars.ADMIN_IDS
      ? envVars.ADMIN_IDS.split(',').map((id: string) => parseInt(id.trim()))
      : [],
    testMode: envVars.TEST_MODE as boolean,
    apiId: envVars.TELEGRAM_API_ID as number | undefined,
    apiHash: envVars.TELEGRAM_API_HASH as string | undefined,
    phoneNumber: envVars.TELEGRAM_PHONE_NUMBER as string | undefined,
    sessionString: envVars.TELEGRAM_SESSION_STRING as string,
  },
  logging: {
    level: envVars.LOG_LEVEL as string,
    format: envVars.NODE_ENV === 'production' ? 'json' : 'pretty',
  },
};

export default config;