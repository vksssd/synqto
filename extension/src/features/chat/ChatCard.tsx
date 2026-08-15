// ─── WhatsApp-style Rich Chat Card Component (Images, Code, Polls, Quizzes, Files, Reactions, Mentions) ───

import React, { useState } from 'react';
import {
  Check,
  CheckCheck,
  CornerUpLeft,
  Copy,
  Download,
  FileText,
  HelpCircle,
  BarChart2,
  Code,
  Sparkles,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Smile,
  Maximize2,
} from 'lucide-react';
import { ChatMessageItem } from './chat.service';
import { PeerIdentity } from '@/core/network/packet';

interface ChatCardProps {
  message: ChatMessageItem;
  myIdentity: PeerIdentity | null;
  onReply?: (message: ChatMessageItem) => void;
  onReact?: (messageId: string, emoji: string) => void;
  onVotePoll?: (messageId: string, pollId: string, optionId: string, isMultiChoice?: boolean) => void;
  onAnswerQuiz?: (messageId: string, quizId: string, selectedIndex: number) => void;
  onOpenImage?: (imageUrl: string, caption?: string) => void;
}

const DEFAULT_REACTIONS = ['👍', '❤️', '😂', '🚀', '💡', '🔥'];

export const ChatCard: React.FC<ChatCardProps> = ({
  message,
  myIdentity,
  onReply,
  onReact,
  onVotePoll,
  onAnswerQuiz,
  onOpenImage,
}) => {
  const [copiedCode, setCopiedCode] = useState(false);
  const [revealedSpoilers, setRevealedSpoilers] = useState<Record<string, boolean>>({});
  const [showReactionsBar, setShowReactionsBar] = useState(false);
  const [showQuizExplanation, setShowQuizExplanation] = useState(false);

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const toggleSpoiler = (key: string) => {
    setRevealedSpoilers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const myPeerId = myIdentity?.peerId || '';

  // Render text with @mentions and ||spoilers||
  const renderFormattedText = (text: string) => {
    const lines = text.split('\n');

    return lines.map((line, lIdx) => {
      // Inline Spoilers: ||hidden text||
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
              return renderMentionsInString(part, `${lIdx}-${pIdx}`);
            })}
          </p>
        );
      }

      return (
        <p key={lIdx} style={{ margin: '2px 0' }}>
          {renderMentionsInString(line, `${lIdx}`)}
        </p>
      );
    });
  };

  // Helper to highlight @everyone and @nickname
  const renderMentionsInString = (str: string, keyPrefix: string) => {
    if (!str.includes('@')) return str;

    const parts = str.split(/(@\S+)/g);
    return parts.map((part, idx) => {
      if (part === '@everyone' || part === '@all') {
        return (
          <span key={`${keyPrefix}-${idx}`} className="mention-badge mention-everyone">
            📣 {part}
          </span>
        );
      } else if (part.startsWith('@') && part.length > 1) {
        return (
          <span key={`${keyPrefix}-${idx}`} className="mention-badge mention-user">
            {part}
          </span>
        );
      }
      return part;
    });
  };

  // ─── Render Rich Content: Code Snippets ───
  const renderCodeSnippet = (codeData: NonNullable<typeof message.codeSnippet>) => {
    return (
      <div
        style={{
          background: 'rgba(0, 0, 0, 0.55)',
          borderRadius: '6px',
          border: '1px solid var(--border-subtle)',
          margin: '6px 0',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 8px',
            background: 'rgba(255, 255, 255, 0.05)',
            borderBottom: '1px solid var(--border-subtle)',
            fontSize: '10px',
            color: 'var(--text-muted)',
          }}
        >
          <span style={{ fontWeight: 700, textTransform: 'uppercase', color: 'var(--primary)' }}>
            {codeData.title || codeData.language}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              navigator.clipboard.writeText(codeData.code);
              setCopiedCode(true);
              setTimeout(() => setCopiedCode(false), 1500);
            }}
            style={{ padding: '2px 5px', fontSize: '9.5px', gap: '3px' }}
          >
            {copiedCode ? <Check size={11} color="var(--accent-emerald)" /> : <Copy size={11} />}
            <span>{copiedCode ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: '8px 10px',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            lineHeight: 1.5,
            color: '#f8fafc',
            overflowX: 'auto',
          }}
        >
          {codeData.code}
        </pre>
      </div>
    );
  };

  // ─── Render Rich Content: Images & Tab Screenshots ───
  const renderImage = (imgUrl: string, caption?: string) => {
    return (
      <div style={{ margin: '6px 0', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
        <div style={{ position: 'relative', cursor: 'pointer', maxHeight: '240px', overflow: 'hidden' }} onClick={() => onOpenImage?.(imgUrl, caption)}>
          <img
            src={imgUrl}
            alt={caption || 'Shared image'}
            style={{ width: '100%', objectFit: 'cover', display: 'block' }}
          />
          <div
            style={{
              position: 'absolute',
              top: '6px',
              right: '6px',
              background: 'rgba(0, 0, 0, 0.6)',
              borderRadius: '4px',
              padding: '3px 5px',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              fontSize: '9.5px',
              color: '#fff',
            }}
          >
            <Maximize2 size={10} />
            <span>Enlarge</span>
          </div>
        </div>
        {caption && (
          <div style={{ padding: '4px 8px', fontSize: '11px', background: 'rgba(0,0,0,0.3)', color: 'var(--text-secondary)' }}>
            {caption}
          </div>
        )}
      </div>
    );
  };

  // ─── Render Rich Content: Interactive Live Poll ───
  const renderPoll = (poll: NonNullable<typeof message.poll>) => {
    const totalVotes = poll.options.reduce((acc, opt) => acc + opt.votes.length, 0);

    return (
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.6)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          padding: '8px 10px',
          margin: '6px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
          <BarChart2 size={13} color="var(--primary)" />
          <span>{poll.question}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
          {poll.options.map((option) => {
            const hasVoted = option.votes.includes(myPeerId);
            const count = option.votes.length;
            const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onVotePoll?.(message.id, poll.id, option.id, poll.isMultiChoice)}
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: hasVoted ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                  background: 'rgba(0, 0, 0, 0.3)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                {/* Progress bar background fill */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    width: `${pct}%`,
                    background: hasVoted ? 'rgba(99, 102, 241, 0.28)' : 'rgba(255, 255, 255, 0.08)',
                    transition: 'width 0.3s ease',
                    zIndex: 0,
                  }}
                />

                <span style={{ position: 'relative', zIndex: 1, fontSize: '11px', fontWeight: hasVoted ? 700 : 500, color: 'var(--text-primary)' }}>
                  {hasVoted ? '✓ ' : ''}{option.text}
                </span>

                <span style={{ position: 'relative', zIndex: 1, fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)' }}>
                  {pct}% ({count})
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: '9px', color: 'var(--text-muted)', textAlign: 'right', marginTop: '2px' }}>
          {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'} • {poll.isMultiChoice ? 'Multi-choice' : 'Single-choice'}
        </div>
      </div>
    );
  };

  // ─── Render Rich Content: Interactive DSA Quiz ───
  const renderQuiz = (quiz: NonNullable<typeof message.quiz>) => {
    const myAnswer = quiz.answers?.[myPeerId];
    const hasAnswered = typeof myAnswer === 'number';
    const totalAnswers = Object.keys(quiz.answers || {}).length;

    return (
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.7)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: '8px',
          padding: '8px 10px',
          margin: '6px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 700, color: '#fbbf24' }}>
          <HelpCircle size={13} color="#f59e0b" />
          <span>🧠 DSA Challenge: {quiz.question}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {quiz.options.map((optText, oIdx) => {
            const isCorrect = oIdx === quiz.correctOptionIndex;
            const isMyPick = myAnswer === oIdx;

            let btnBg = 'rgba(0, 0, 0, 0.3)';
            let borderColor = 'var(--border-subtle)';
            let textColor = 'var(--text-primary)';

            if (hasAnswered) {
              if (isCorrect) {
                btnBg = 'rgba(16, 185, 129, 0.25)';
                borderColor = 'rgba(16, 185, 129, 0.6)';
                textColor = '#34d399';
              } else if (isMyPick && !isCorrect) {
                btnBg = 'rgba(244, 63, 94, 0.25)';
                borderColor = 'rgba(244, 63, 94, 0.6)';
                textColor = '#fb7185';
              }
            }

            return (
              <button
                key={oIdx}
                type="button"
                disabled={hasAnswered}
                onClick={() => onAnswerQuiz?.(message.id, quiz.id, oIdx)}
                style={{
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: `1px solid ${borderColor}`,
                  background: btnBg,
                  cursor: hasAnswered ? 'default' : 'pointer',
                  textAlign: 'left',
                  fontSize: '11px',
                  fontWeight: isMyPick || isCorrect ? 700 : 500,
                  color: textColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>
                  {String.fromCharCode(65 + oIdx)}. {optText}
                </span>
                {hasAnswered && (
                  <span style={{ fontSize: '10px' }}>
                    {isCorrect ? '✅ Correct' : isMyPick ? '❌ Wrong' : ''}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Explanation Toggle after answering */}
        {hasAnswered && quiz.explanation && (
          <div style={{ marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '4px' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowQuizExplanation(!showQuizExplanation)}
              style={{ fontSize: '10px', color: '#f59e0b', padding: '2px 4px', gap: '3px' }}
            >
              <Sparkles size={11} />
              <span>{showQuizExplanation ? 'Hide Explanation' : 'View Explanation'}</span>
              {showQuizExplanation ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>

            {showQuizExplanation && (
              <div
                style={{
                  marginTop: '4px',
                  padding: '6px 8px',
                  borderRadius: '4px',
                  background: 'rgba(245, 158, 11, 0.12)',
                  fontSize: '10.5px',
                  color: '#fef3c7',
                  lineHeight: 1.4,
                }}
              >
                {quiz.explanation}
              </div>
            )}
          </div>
        )}

        <div style={{ fontSize: '9px', color: 'var(--text-muted)', textAlign: 'right' }}>
          {totalAnswers} {totalAnswers === 1 ? 'participant' : 'participants'} answered
        </div>
      </div>
    );
  };

  // ─── Render Rich Content: Documents & Files ───
  const renderFile = (file: NonNullable<typeof message.fileAttachment>) => {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 8px',
          background: 'rgba(0, 0, 0, 0.4)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '6px',
          margin: '6px 0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
          <FileText size={16} color="var(--primary)" />
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>{file.name}</div>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{(file.size / 1024).toFixed(1)} KB</div>
          </div>
        </div>

        <a
          href={file.dataUrl}
          download={file.name}
          className="btn btn-secondary btn-sm"
          style={{ padding: '3px 6px', fontSize: '9.5px', gap: '3px', textDecoration: 'none' }}
        >
          <Download size={11} />
          <span>Download</span>
        </a>
      </div>
    );
  };

  return (
    <div
      className={`chat-bubble ${message.isSelf ? 'self' : 'other'}`}
      onMouseEnter={() => setShowReactionsBar(true)}
      onMouseLeave={() => setShowReactionsBar(false)}
      style={{ position: 'relative' }}
    >
      {/* ─── Floating WhatsApp-style Quick Reaction Bar on Hover ─── */}
      {showReactionsBar && onReact && (
        <div className="reaction-bar">
          {DEFAULT_REACTIONS.map((em) => (
            <button
              key={em}
              type="button"
              className="reaction-btn"
              onClick={() => onReact(message.id, em)}
              title={`React with ${em}`}
            >
              {em}
            </button>
          ))}
        </div>
      )}

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

      {/* ─── Body: Text, Images, Code, Polls, Quizzes, Files ─── */}
      <div className="chat-body">
        {/* Text Message */}
        {message.text && renderFormattedText(message.text)}

        {/* Image / Screenshot */}
        {message.imageUrl && renderImage(message.imageUrl, message.imageCaption)}

        {/* Code Snippet */}
        {message.codeSnippet && renderCodeSnippet(message.codeSnippet)}

        {/* Poll */}
        {message.poll && renderPoll(message.poll)}

        {/* DSA Quiz */}
        {message.quiz && renderQuiz(message.quiz)}

        {/* File Attachment */}
        {message.fileAttachment && renderFile(message.fileAttachment)}
      </div>

      {/* ─── Emoji Reactions List Badges ─── */}
      {message.reactions && Object.keys(message.reactions).length > 0 && (
        <div className="reactions-list">
          {Object.entries(message.reactions).map(([emoji, reactors]) => {
            const hasMyReaction = reactors.includes(myPeerId);
            return (
              <button
                key={emoji}
                type="button"
                className={`reaction-pill ${hasMyReaction ? 'active' : ''}`}
                onClick={() => onReact?.(message.id, emoji)}
                title={`${reactors.length} reactions`}
              >
                <span>{emoji}</span>
                <span>{reactors.length}</span>
              </button>
            );
          })}
        </div>
      )}

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
