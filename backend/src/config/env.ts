import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET', 'dev-insecure-secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'qms-audit@example.com',
  },
  isProd: (process.env.NODE_ENV ?? 'development') === 'production',
};
