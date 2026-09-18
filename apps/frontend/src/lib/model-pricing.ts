import type { ChatModelPricing, ImageModelPricing } from '@lumina/shared';

export function formatModelPrice(value: number): string {
  return Number.isFinite(value)
    ? value.toFixed(4).replace(/\.?0+$/, '')
    : '—';
}

export function formatChatModelPricing(pricing: ChatModelPricing): string {
  return `输入 ¥${formatModelPrice(pricing.input)} / 千 token · 输出 ¥${formatModelPrice(pricing.output)} / 千 token`;
}

export function formatImageModelPricing(
  pricing: ImageModelPricing,
  imageCount = 1,
): string {
  const unitPrice = formatModelPrice(pricing.perImage);
  const totalPrice = formatModelPrice(pricing.perImage * imageCount);

  if (imageCount > 1) {
    return `生成价格：每张 ¥${unitPrice} · 本次预计 ¥${totalPrice}`;
  }

  return `生成价格：每张 ¥${unitPrice}`;
}
