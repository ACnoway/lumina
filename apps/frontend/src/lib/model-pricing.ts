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
