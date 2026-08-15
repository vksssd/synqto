// ─── Chat Message Bubble Component with Inline Spoilers & Code Highlighting ───

import React, { useState } from 'react';
import { Check, CheckCheck, CornerUpLeft, Copy, Eye, EyeOff } from 'lucide-react';
import { ChatMessageItem } from './chat.service';

interface ChatCardProps {
  message: ChatMessageItem;
  onReply?: (message: ChatMessageItem) => void;
}

export const ChatCard: React.FC<ChatCardProps> = ({ message, onReply }) => {
  const [copiedCode, setCopiedCode] = useState(false);
  const [revealedSpoilers, setRevealedSpoilers] = useState<Record<string, boolean>>({});

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const toggleSpoiler = (key: string) => {
    setRevealedSpoilers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderFormattedText = (text: string) => {
    const lines = text.split('\n');

    return lines.map((line, lIdx) => {
      // Code block detection
      if (line.startsWith('```') && line.endsWith('```') && line.length > 6) {
        const codeText = line.slice(3, -3);
        return (
          <div
            key={lIdx}
            style={{
              background: 'rgba(0, 0, 0, 0.45)',
              padding: '6px 8px',
              borderRadius: '6px',
              margin: '4px 0',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              position: 'relative',
            }}
          >
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{codeText}</pre>
            <button
              style={{
                position: 'absolute',
                top: '4px',
                right: '4px',
                background: 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                color: '#fff',
                borderRadius: '4px',
                padding: '2px 4px',
                cursor: 'pointer',
              }}
              onClick={() => {
                navigator.clipboard.writeText(codeText);
                setCopiedCode(true);
                setTimeout(() => setCopiedCode(false), 1500);
              }}
              title="Copy code"
            >
              {copiedCode ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
            </button>
          </div>
        );
      }

      // Check for inline spoilers ||spoiler text||
      if (line.includes('||')) {
        const parts = line.split(/(\|\|.*?\|\|)/g);
        return (
          <p key={lIdx} style={{ margin: '2px 0' }}>
            {parts.map((part, pIdx) => {
              if (part.startsWith('||') && part.endsWith('||') && part.length > 4) {
                const spoilerContent = part.slice(2, -2);
                const sKey = `${lIdx}-${pIdx}`;
                const isRevealed = Boolean(revealedSpoilers[sKey]);

                return (
                  <span
                    key={pIdx}
                    onClick={() => toggleSpoiler(sKey)}
                    style={{
                      display: 'inline-block',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      background: isRevealed ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.15)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      filter: isRevealed ? 'none' : 'blur(4px)',
                      cursor: 'pointer',
                      userSelect: isRevealed ? 'text' : 'none',
                      transition: 'all 0.2s ease',
                      color: isRevealed ? 'var(--text-primary)' : 'transparent',
                    }}
                    title={isRevealed ? 'Click to hide spoiler' : 'Click to reveal spoiler'}
                  >
                    {spoilerContent}
                  </span>
                );
              }
              return part;
            })}
          </p>
        );
      }

      return (
        <p key={lIdx} style={{ margin: '2px 0' }}>
          {line}
        </p>
      );
    });
  };

  return (
    <div className={`chat-bubble ${message.isSelf ? 'self' : 'other'}`}>
      {/* Reply quote preview */}
      {message.replyPreview && (
        <div
          style={{
            borderLeft: '2px solid var(--primary)',
            paddingLeft: '6px',
            marginBottom: '4px',
            fontSize: '10px',
            color: 'var(--text-muted)',
            fontStyle: 'italic',
          }}
        >
          {message.replyPreview}
        </div>
      )}

      <div className="chat-header">
        <div className="chat-author">
          <span>{message.from.avatar}</span>
          <span style={{ color: message.isSelf ? '#ffffff' : message.from.color || '#a5b4fc' }}>
            {message.isSelf ? 'You' : message.from.nickname}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span className="chat-timestamp">{formatTimestamp(message.timestamp)}</span>
          {onReply && (
            <button
              className="btn btn-ghost btn-icon"
              style={{ width: '18px', height: '18px', padding: 0 }}
              onClick={() => onReply(message)}
              title="Reply"
            >
              <CornerUpLeft size={10} />
            </button>
          )}
        </div>
      </div>

      <div className="chat-body">{renderFormattedText(message.text)}</div>

      {/* ACK status for sent messages */}
      {message.isSelf && (
        <div className="chat-footer">
          {message.status === 'pending' && <span className="ack-icon">⏳</span>}
          {message.status === 'sent' && <Check size={11} className="ack-icon" color="var(--text-dim)" />}
          {message.status === 'delivered' && (
            <CheckCheck size={11} className="ack-icon" color="var(--text-secondary)" />
          )}
          {message.status === 'read' && (
            <CheckCheck size={11} className="ack-icon ack-read" color="#06b6d4" />
          )}
        </div>
      )}
    </div>
  );
};
