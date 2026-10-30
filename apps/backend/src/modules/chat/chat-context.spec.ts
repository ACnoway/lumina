import {
  estimateTextTokens,
  getMessagesToCompact,
  selectContextMessages,
} from './chat-context';

describe('chat context budgeting', () => {
  it('estimates CJK text without treating it as one token per UTF-16 code unit', () => {
    expect(estimateTextTokens('你好，世界')).toBeGreaterThan(0);
    expect(estimateTextTokens('你好，世界')).toBeLessThan(10);
  });

  it('keeps the newest complete turns when the context budget is reached', () => {
    const messages = [
      { id: 'u1', role: 'USER', content: 'a'.repeat(100) },
      { id: 'a1', role: 'ASSISTANT', content: 'b'.repeat(100) },
      { id: 'u2', role: 'USER', content: 'c'.repeat(100) },
      { id: 'a2', role: 'ASSISTANT', content: 'd'.repeat(100) },
      { id: 'u3', role: 'USER', content: 'e'.repeat(100) },
      { id: 'a3', role: 'ASSISTANT', content: 'f'.repeat(100) },
    ];

    const selection = selectContextMessages(null, messages, 180);

    expect(selection.fits).toBe(true);
    expect(selection.messages.map((message) => message.id)).toEqual(['u2', 'a2', 'u3', 'a3']);
    expect(selection.omittedMessageCount).toBe(2);
  });

  it('compacts older turns while retaining the two newest turns verbatim', () => {
    const messages = [
      { id: 'u1', role: 'USER', content: '1' },
      { id: 'a1', role: 'ASSISTANT', content: '1' },
      { id: 'u2', role: 'USER', content: '2' },
      { id: 'a2', role: 'ASSISTANT', content: '2' },
      { id: 'u3', role: 'USER', content: '3' },
      { id: 'a3', role: 'ASSISTANT', content: '3' },
    ];

    expect(getMessagesToCompact(messages).map((message) => message.id)).toEqual(['u1', 'a1']);
  });
});
