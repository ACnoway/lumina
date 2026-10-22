import { toAnthropicContent, toOpenAIContent } from './types';

describe('chat image payload conversion', () => {
  const content = [
    { type: 'text' as const, text: 'What is in this image?' },
    { type: 'image' as const, mimeType: 'image/png', data: 'cG5n' },
  ];

  it('converts text and images to OpenAI-compatible content blocks', () => {
    expect(toOpenAIContent(content)).toEqual([
      { type: 'text', text: 'What is in this image?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,cG5n' } },
    ]);
  });

  it('converts text and images to Anthropic content blocks', () => {
    expect(toAnthropicContent(content)).toEqual([
      { type: 'text', text: 'What is in this image?' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'cG5n' } },
    ]);
  });
});
