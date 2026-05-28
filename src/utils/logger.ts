import winston from 'winston';

const { combine, timestamp, printf, colorize } = winston.format;

const customFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `[${timestamp}] ${level}: ${message}`;
  if (Object.keys(metadata).length > 0) {
    msg += ` | ${JSON.stringify(metadata)}`;
  }
  return msg;
});

export const logger = winston.createLogger({
  level: 'info', // Set to 'debug' when we want highly verbose output
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    colorize(),
    customFormat
  ),
  transports: [
    new winston.transports.Console()
  ],
});
