import { PHOTON_SYMBOL, type ChatModelPricing, type ImageModelPricing } from '@lumina/shared';

export function formatModelPrice(value: number): string {
  return Number.isFinite(value)
    ? value.toFixed(4).replace(/\.?0+$/, '')
    : '—';
}

export function formatPhoton(value: number, fractionDigits = 4): string {
  return Number.isFinite(value)
    ? `${PHOTON_SYMBOL}${value.toFixed(fractionDigits).replace(/\.?0+$/, '')}`
    : `${PHOTON_SYMBOL}—`;
}

/**
 * Format a photon amount for billing without rounding beyond the displayed precision.
 * Wallet values are stored with up to six decimal places, so formatting them to six
 * places first avoids binary floating-point artifacts before truncating the display.
 */
export function formatPhotonTruncated(value: number, fractionDigits = 4): string {
  if (!Number.isFinite(value)) {
    return `${PHOTON_SYMBOL}—`;
  }

  const precision = Math.max(fractionDigits, 6);
  const [integerPart, fractionPart = ''] = Math.abs(value).toFixed(precision).split('.');
  const truncatedFraction = fractionPart.slice(0, fractionDigits).replace(/0+$/, '');
  const sign = value < 0 ? '-' : '';
  const decimalPart = truncatedFraction ? `.${truncatedFraction}` : '';

  return `${PHOTON_SYMBOL}${sign}${integerPart}${decimalPart}`;
}

export function formatChatModelPricing(pricing: ChatModelPricing): string {
  return `输入 ${formatPhoton(pricing.input)} / 千 token · 输出 ${formatPhoton(pricing.output)} / 千 token`;
}

export function formatImageModelPricing(
  pricing: ImageModelPricing,
  imageCount = 1,
): string {
  const unitPrice = formatModelPrice(pricing.perImage);
  const totalPrice = formatModelPrice(pricing.perImage * imageCount);

  if (imageCount > 1) {
    return `生成价格：每张 ${PHOTON_SYMBOL}${unitPrice} · 本次预计 ${PHOTON_SYMBOL}${totalPrice}`;
  }

  return `生成价格：每张 ${PHOTON_SYMBOL}${unitPrice}`;
}
