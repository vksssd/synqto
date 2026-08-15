// ─── Chat Input & Composer Component ───

import React, { useState } from 'react';
import { Send, X, EyeOff, Tag } from 'lucide-react';
import { ChatMessageItem } from './chat.service';

interface ChatInputProps {
  onSendMessage: (text: string, replyTo?: { id: string; preview: string }) => void;
  replyingTo: ChatMessageItem | null;
  onCancelReply: () => void;
}

const QUICK_STRATEGY_CHIPS = [
  '⚡ O(N) Time',
  '💾 O(1) Space',
  '👉 Two Pointers',
  '🔍 Binary Search',
  '🧠 DP / Memo',
  '💡 Sliding Window',
  '⏳ Anyone stuck?',
];

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  replyingTo,
  onCancelReply,
}) => {
  const [text, setText] = useState('');

  const handleSend = () => {
    if (!text.trim()) return;

    const replyData = replyingTo
      ? {
          id: replyingTo.id,
          preview: `${replyingTo.from.nickname}: ${replyingTo.text.slice(0, 40)}`,
        }
      : undefined;

    onSendMessage(text, replyData);
    setText('');
    onCancelReply();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const insertSpoiler = () => {
    setText((prev) => `${prev}||hint solution||`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {/* Quick Strategy Pills Row */}
      <div className="prompt-pills-row">
        {QUICK_STRATEGY_CHIPS.map((prompt, i) => (
          <button
            key={i}
            className="prompt-pill"
            onClick={() => onSendMessage(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Reply indicator banner */}
      {replyingTo && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(99, 102, 241, 0.15)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 8px',
            fontSize: '11px',
            color: 'var(--text-secondary)',
          }}
        >
          <span>Replying to <strong>{replyingTo.from.nickname}</strong>: {replyingTo.text.slice(0, 30)}...</span>
          <button className="btn btn-ghost btn-icon" style={{ width: '18px', height: '18px' }} onClick={onCancelReply}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* Input box & send */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={insertSpoiler}
          title="Insert Spoiler Blur ||text||"
          style={{ width: '32px', height: '32px', flexShrink: 0 }}
        >
          <EyeOff size={14} color="var(--text-muted)" />
        </button>

        <input
          type="text"
          className="input-glass"
          placeholder="Type a hint, code snippet, or ||spoiler||..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className="btn btn-primary btn-icon"
          onClick={handleSend}
          disabled={!text.trim()}
          style={{ flexShrink: 0, width: '32px', height: '32px' }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
};
