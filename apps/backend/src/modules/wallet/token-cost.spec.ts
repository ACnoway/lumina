import { calculateTokenCost } from './token-cost';

describe('token pricing', () => {
  it('preserves the cost of prices converted from per thousand to per million', () => {
    expect(calculateTokenCost(1000, 500, 1, 2)).toBe(0.002);
  });

  it('rounds once to the six decimal places stored in the ledger', () => {
    expect(calculateTokenCost(1, 0, 0.5, 0)).toBe(0.000001);
    expect(calculateTokenCost(1, 0, 0.4, 0)).toBe(0);
    expect(calculateTokenCost(100, 100, 0, 0)).toBe(0);
  });
});
