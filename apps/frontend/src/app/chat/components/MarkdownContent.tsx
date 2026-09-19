'use client';

import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

interface MarkdownContentProps {
  content: string;
}

/**
 * 已发送消息的 Markdown 展示层。
 *
 * 输入框不使用这个组件；消息仍以原始 Markdown 文本提交并保存，
 * 这里只负责在聊天记录中安全地渲染已经发送的内容。
 */
export default function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="chat-markdown text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeSanitize]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
