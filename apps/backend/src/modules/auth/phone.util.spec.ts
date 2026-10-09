import { isValidPhone, maskPhone, normalizePhone } from './phone.util';

describe('phone utilities', () => {
  it('normalizes common mainland China phone formats', () => {
    expect(normalizePhone('138 0013 8000')).toBe('+8613800138000');
    expect(normalizePhone('8613800138000')).toBe('+8613800138000');
    expect(isValidPhone('+8613800138000')).toBe(true);
  });

  it('masks phone numbers for user-visible responses', () => {
    expect(maskPhone('+8613800138000')).toBe('138****8000');
    expect(maskPhone(null)).toBeNull();
  });

  it('rejects malformed phone numbers', () => {
    expect(isValidPhone('123')).toBe(false);
    expect(isValidPhone('13800138000')).toBe(true);
  });
});
