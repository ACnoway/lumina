import { validateEnvironment } from './environment';

const productionEnvironment = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(64),
  ADMIN_PASSWORD: 'A-secure-admin-password',
  OBJECT_STORAGE_CONFIG_ENCRYPTION_KEY: 'b'.repeat(64),
  PAYMENT_CONFIG_ENCRYPTION_KEY: 'c'.repeat(64),
  SMS_CONFIG_ENCRYPTION_KEY: 'd'.repeat(64),
  DATABASE_URL: 'postgresql://lumina:secure-database-password@postgres:5432/lumina',
};

describe('validateEnvironment', () => {
  it('allows non-production environments to use local development settings', () => {
    const environment = { NODE_ENV: 'development', JWT_SECRET: 'dev-secret' };
    expect(validateEnvironment(environment)).toBe(environment);
  });

  it('accepts production secrets meeting the configured requirements', () => {
    expect(validateEnvironment(productionEnvironment)).toBe(productionEnvironment);
  });

  it.each([
    ['JWT_SECRET', 'change_this_in_production'],
    ['ADMIN_PASSWORD', 'change_this_password'],
    ['PAYMENT_CONFIG_ENCRYPTION_KEY', 'change_this_payment_encryption_key'],
  ])('rejects an example value for %s', (name, value) => {
    expect(() => validateEnvironment({ ...productionEnvironment, [name]: value })).toThrow(name);
  });

  it('rejects the default database password embedded in DATABASE_URL', () => {
    expect(() => validateEnvironment({
      ...productionEnvironment,
      DATABASE_URL: 'postgresql://lumina:lumina_password@postgres:5432/lumina',
    })).toThrow('DATABASE_URL password');
  });
});
