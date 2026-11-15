type Environment = Record<string, unknown>;

const PRODUCTION_SECRET_REQUIREMENTS: Array<{ name: string; minLength: number }> = [
  { name: 'JWT_SECRET', minLength: 32 },
  { name: 'ADMIN_PASSWORD', minLength: 12 },
  { name: 'OBJECT_STORAGE_CONFIG_ENCRYPTION_KEY', minLength: 32 },
  { name: 'PAYMENT_CONFIG_ENCRYPTION_KEY', minLength: 32 },
  { name: 'SMS_CONFIG_ENCRYPTION_KEY', minLength: 32 },
];

const KNOWN_EXAMPLE_SECRETS = new Set([
  'lumina_password',
  'password',
  'changeme',
]);

function isExampleSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return KNOWN_EXAMPLE_SECRETS.has(normalized)
    || normalized.includes('change_this')
    || normalized.includes('your_jwt_secret');
}

function assertProductionSecret(name: string, value: unknown, minLength: number): void {
  if (typeof value !== 'string' || value.trim().length < minLength || isExampleSecret(value)) {
    throw new Error(
      `Invalid production configuration: ${name} must be a non-example secret with at least ${minLength} characters`,
    );
  }
}

export function validateEnvironment(config: Environment): Environment {
  if (String(config.NODE_ENV ?? '').trim().toLowerCase() !== 'production') return config;

  for (const requirement of PRODUCTION_SECRET_REQUIREMENTS) {
    assertProductionSecret(requirement.name, config[requirement.name], requirement.minLength);
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(String(config.DATABASE_URL ?? ''));
  } catch {
    throw new Error('Invalid production configuration: DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (databaseUrl.protocol !== 'postgresql:' && databaseUrl.protocol !== 'postgres:') {
    throw new Error('Invalid production configuration: DATABASE_URL must use PostgreSQL');
  }
  assertProductionSecret('DATABASE_URL password', decodeURIComponent(databaseUrl.password), 16);

  return config;
}
