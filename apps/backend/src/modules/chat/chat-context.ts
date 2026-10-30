/** Conservative, tokenizer-free estimates used for context budgeting. */
export interface ContextMessageLike {
  id: string;
  role: string;
  content: string;
  attachments?: unknown[];
}

export interface ContextSelection<T extends ContextMessageLike> {
  messages: T[];
  estimatedTokens: number;
  omittedMessageCount: number;
  fits: boolean;
}

const CJK_CHARACTER = /[\u2e80-\u9fff\uf900-\ufaff\u{20000}-\u{3134f}]/u;
const IMAGE_TOKEN_ESTIMATE = 1000;
const MESSAGE_OVERHEAD_TOKENS = 8;

export function estimateTextTokens(text: string): number {
  let cjkCharacters = 0;
  let otherCharacters = 0;
  for (const character of text) {
    if (CJK_CHARACTER.test(character)) cjkCharacters += 1;
    else otherCharacters += 1;
  }
  return Math.ceil(cjkCharacters * 1.5 + otherCharacters / 3);
}

export function estimateContextMessageTokens(message: ContextMessageLike): number {
  return MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.content) +
    (message.attachments?.length ?? 0) * IMAGE_TOKEN_ESTIMATE;
}

export function estimateSummaryTokens(summary: string | null | undefined): number {
  return summary ? MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(summary) : 0;
}

/** Split the transcript into user turns so trimming never keeps half a turn. */
export function groupContextTurns<T extends ContextMessageLike>(messages: T[]): T[][] {
  const turns: T[][] = [];
  for (const message of messages) {
    if (message.role === 'USER' || turns.length === 0) turns.push([message]);
    else turns[turns.length - 1].push(message);
  }
  return turns;
}

export function selectContextMessages<T extends ContextMessageLike>(
  summary: string | null | undefined,
  messages: T[],
  inputBudgetTokens: number,
): ContextSelection<T> {
  const summaryTokens = estimateSummaryTokens(summary);
  const turns = groupContextTurns(messages);
  const selectedTurns: T[][] = [];
  let estimatedTokens = summaryTokens;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const turnTokens = turn.reduce((total, message) => total + estimateContextMessageTokens(message), 0);
    if (estimatedTokens + turnTokens > inputBudgetTokens) {
      if (selectedTurns.length === 0) {
        return {
          messages: [],
          estimatedTokens: estimatedTokens + turnTokens,
          omittedMessageCount: messages.length - turn.length,
          fits: false,
        };
      }
      break;
    }
    selectedTurns.unshift(turn);
    estimatedTokens += turnTokens;
  }

  const selectedMessages = selectedTurns.flat();
  return {
    messages: selectedMessages,
    estimatedTokens,
    omittedMessageCount: messages.length - selectedMessages.length,
    fits: estimatedTokens <= inputBudgetTokens,
  };
}

/** Keep the two newest turns verbatim and fold earlier turns into the summary. */
export function getMessagesToCompact<T extends ContextMessageLike>(messages: T[], keepTurns = 2): T[] {
  const turns = groupContextTurns(messages);
  return turns.slice(0, Math.max(0, turns.length - keepTurns)).flat();
}
