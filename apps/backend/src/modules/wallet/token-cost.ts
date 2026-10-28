import { Decimal } from '@prisma/client/runtime/library';

/** Prices are photons per million tokens; report the same precision stored in the ledger. */
export function calculateTokenCost(inputTokens: number, outputTokens: number, inputPrice: number, outputPrice: number): number {
  return new Decimal(inputTokens).mul(inputPrice).plus(new Decimal(outputTokens).mul(outputPrice))
    .div(1_000_000).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toNumber();
}
