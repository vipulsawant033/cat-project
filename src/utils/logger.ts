const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = (process.env.LOG_LEVEL as keyof typeof levels) || 'info';

function log(level: keyof typeof levels, message: string, meta?: Record<string, unknown>): void {
  if (levels[level] < levels[currentLevel]) return;
  const entry = { timestamp: new Date().toISOString(), level, message, ...meta };
  process.stderr.write(JSON.stringify(entry) + '\n');
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
};
