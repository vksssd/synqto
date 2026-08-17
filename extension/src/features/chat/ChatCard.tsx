// ─── Synqto Rich Chat Card ───

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
  Sparkles,
  ChevronDown,
  ChevronUp,
  Maximize2,
} from 'lucide-react';

import { ChatMessageItem } from './chat.service';
import { PeerIdentity } from '@/core/network/packet';
import '../../app/synqtoDesign.css';

// interface ChatCardProps {
//   message: ChatMessageItem;
//   myIdentity: PeerIdentity | null;
//   onReply?: (message: ChatMessageItem) => void;
//   onReact?: (messageId: string, emoji: string) => void;
//   onVotePoll?: (
//     messageId: string,
//     pollId: string,
//     optionId: string,
//     isMultiChoice?: boolean
//   ) => void;
//   onAnswerQuiz?: (
//     messageId: string,
//     quizId: string,
//     selectedIndex: number
//   ) => void;
//   onOpenImage?: (imageUrl: string, caption?: string) => void;
// }

interface ChatCardProps {
  message: ChatMessageItem;
  messages: ChatMessageItem[];
  myIdentity: PeerIdentity | null;
  onReply?: (message: ChatMessageItem) => void;
  onReact?: (messageId: string, emoji: string) => void;
  onVotePoll?: (
    messageId: string,
    pollId: string,
    optionId: string,
    isMultiChoice?: boolean
  ) => void;
  onAnswerQuiz?: (
    messageId: string,
    quizId: string,
    selectedIndex: number
  ) => void;
  onOpenImage?: (imageUrl: string, caption?: string) => void;
}

const DEFAULT_REACTIONS = ['👍', '❤️', '😂', '🚀', '💡', '🔥'];

export const ChatCard: React.FC<ChatCardProps> = ({
  message,
  messages,
  myIdentity,
  onReply,
  onReact,
  onVotePoll,
  onAnswerQuiz,
  onOpenImage,
}) => {
  const [copiedCode, setCopiedCode] = useState(false);
  const [revealedSpoilers, setRevealedSpoilers] = useState<
    Record<string, boolean>
  >({});
  const [showQuizExplanation, setShowQuizExplanation] = useState(false);

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);

    return d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const toggleSpoiler = (key: string) => {
    setRevealedSpoilers((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const myPeerId = myIdentity?.peerId || '';

  // ─────────────────────────────────────────────────────────────
  // TEXT
  // ─────────────────────────────────────────────────────────────

  const renderMentionsInString = (
    str: string,
    keyPrefix: string
  ) => {
    if (!str.includes('@')) {
      return str;
    }

    const parts = str.split(/(@\S+)/g);

    return parts.map((part, idx) => {
      if (part === '@everyone' || part === '@all') {
        return (
          <span
            key={`${keyPrefix}-${idx}`}
            className="mention-badge mention-everyone"
          >
            📣 {part}
          </span>
        );
      }

      if (part.startsWith('@') && part.length > 1) {
        return (
          <span
            key={`${keyPrefix}-${idx}`}
            className="mention-badge mention-user"
          >
            {part}
          </span>
        );
      }

      return part;
    });
  };

  const renderFormattedText = (text: string) => {
    const lines = text.split('\n');

    return lines.map((line, lIdx) => {
      if (line.includes('||')) {
        const parts = line.split(/(\|\|.*?\|\|)/g);

        return (
          <p
            key={lIdx}
            className="chat-text-line"
          >
            {parts.map((part, pIdx) => {
              if (
                part.startsWith('||') &&
                part.endsWith('||') &&
                part.length > 4
              ) {
                const spoilerContent =
                  part.slice(2, -2);

                const sKey = `${lIdx}-${pIdx}`;

                const isRevealed =
                  Boolean(revealedSpoilers[sKey]);

                return (
                  <span
                    key={pIdx}
                    onClick={() =>
                      toggleSpoiler(sKey)
                    }
                    className={`chat-spoiler ${
                      isRevealed
                        ? 'chat-spoiler-revealed'
                        : ''
                    }`}
                    title={
                      isRevealed
                        ? 'Click to hide spoiler'
                        : 'Click to reveal spoiler'
                    }
                  >
                    {spoilerContent}
                  </span>
                );
              }

              return renderMentionsInString(
                part,
                `${lIdx}-${pIdx}`
              );
            })}
          </p>
        );
      }

      return (
        <p
          key={lIdx}
          className="chat-text-line"
        >
          {renderMentionsInString(
            line,
            `${lIdx}`
          )}
        </p>
      );
    });
  };

  // ─────────────────────────────────────────────────────────────
  // REPLY PREVIEW
  //
  // IMPORTANT:
  // Do NOT split replyPreview on ":".
  // ChatInput now stores only the quoted message text.
  // ─────────────────────────────────────────────────────────────

  // const renderReplyPreview = () => {
  //   if (!message.replyPreview?.trim()) {
  //     return null;
  //   }

  //   return (
  //     <div
  //       className="chat-reply-preview"
  //       title="Replied message"
  //     >
  //       <div className="chat-reply-accent" />

  //       <div className="chat-reply-content">
  //         <div className="chat-reply-author">
  //           Replied message
  //         </div>

  //         <div className="chat-reply-text">
  //           {message.replyPreview}
  //         </div>
  //       </div>
  //     </div>
  //   );
  // };

//   const renderReplyPreview = () => {
//   if (!message.replyPreview?.trim()) {
//     return null;
//   }

//   const repliedAuthor = message.replyTo
//     ? (
//         message.replyTo === myPeerId
//           ? ''
//           : 'Replied message'
//       )
//     : 'Replied message';

//   return (
//     <div
//       className="chat-reply-preview"
//       title="Replied message"
//     >
//       <div className="chat-reply-accent" />

//       <div className="chat-reply-content">
//         <div className="chat-reply-author">
//           {repliedAuthor}
//         </div>

//         <div className="chat-reply-text">
//           {message.replyPreview}
//         </div>
//       </div>
//     </div>
//   );
// };

const renderReplyPreview = () => {
  if (!message.replyPreview?.trim() || !message.replyTo) {
    return null;
  }

  const originalMessage = messages.find(
    (m) => m.id === message.replyTo
  );

  /*
   * If the original message is unavailable
   * (for example, old history), fall back to
   * the compact quoted-message UI.
   */
  if (!originalMessage) {
    return (
      <div className="chat-reply-preview">
        <div className="chat-reply-accent" />

        <div className="chat-reply-content">
          <div className="chat-reply-text">
            {message.replyPreview}
          </div>
        </div>
      </div>
    );
  }

  const isReplyingToSelf =
    originalMessage.from.peerId === myPeerId;

  return (
    <div className="chat-reply-preview">
      <div className="chat-reply-accent" />

      <div className="chat-reply-content">
        {!isReplyingToSelf && (
          <div className="chat-reply-author-row">
            <span
              className="chat-reply-avatar"
              style={{
                background:
                  originalMessage.from.color ||
                  'var(--primary)',
              }}
            >
              {originalMessage.from.avatar}
            </span>

            <span className="chat-reply-author">
              {originalMessage.from.nickname}
            </span>
          </div>
        )}

        <div className="chat-reply-text">
          {message.replyPreview}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
  // CODE
  // ─────────────────────────────────────────────────────────────

  const renderCodeSnippet = (
    codeData: NonNullable<
      typeof message.codeSnippet
    >
  ) => {
    return (
      <div className="chat-rich-card chat-code-card">
        <div className="chat-code-header">
          <span className="chat-code-language">
            {codeData.title ||
              codeData.language}
          </span>

          <button
            type="button"
            className="btn btn-ghost btn-sm chat-code-copy"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  codeData.code
                );

                setCopiedCode(true);

                setTimeout(
                  () => setCopiedCode(false),
                  1500
                );
              } catch {
                // Clipboard may be unavailable in preview mode.
              }
            }}
          >
            {copiedCode ? (
              <Check size={11} />
            ) : (
              <Copy size={11} />
            )}

            <span>
              {copiedCode
                ? 'Copied'
                : 'Copy'}
            </span>
          </button>
        </div>

        <pre className="chat-code-pre">
          {codeData.code}
        </pre>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // IMAGE
  // ─────────────────────────────────────────────────────────────

  const renderImage = (
    imgUrl: string,
    caption?: string
  ) => {
    return (
      <div className="chat-rich-card chat-image-card">
        <div
          className="chat-image-wrap"
          onClick={() =>
            onOpenImage?.(
              imgUrl,
              caption
            )
          }
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' ||
              e.key === ' '
            ) {
              onOpenImage?.(
                imgUrl,
                caption
              );
            }
          }}
        >
          <img
            src={imgUrl}
            alt={
              caption ||
              'Shared image'
            }
            className="chat-image"
          />

          <div className="chat-image-enlarge">
            <Maximize2 size={10} />
            <span>Enlarge</span>
          </div>
        </div>

        {caption && (
          <div className="chat-image-caption">
            {caption}
          </div>
        )}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // POLL
  // ─────────────────────────────────────────────────────────────

  const renderPoll = (
    poll: NonNullable<typeof message.poll>
  ) => {
    const totalVotes =
      poll.options.reduce(
        (acc, opt) =>
          acc + opt.votes.length,
        0
      );

    return (
      <div className="chat-rich-card chat-poll-card">
        <div className="chat-rich-title">
          <BarChart2
            size={13}
            color="var(--primary)"
          />

          <span>
            {poll.question}
          </span>
        </div>

        <div className="chat-poll-options">
          {poll.options.map(
            (option) => {
              const hasVoted =
                option.votes.includes(
                  myPeerId
                );

              const count =
                option.votes.length;

              const pct =
                totalVotes > 0
                  ? Math.round(
                      (count /
                        totalVotes) *
                        100
                    )
                  : 0;

              return (
                <button
                  key={option.id}
                  type="button"
                  className={`chat-poll-option ${
                    hasVoted
                      ? 'chat-poll-option-selected'
                      : ''
                  }`}
                  onClick={() =>
                    onVotePoll?.(
                      message.id,
                      poll.id,
                      option.id,
                      poll.isMultiChoice
                    )
                  }
                >
                  <span
                    className="chat-poll-progress"
                    style={{
                      width: `${pct}%`,
                    }}
                  />

                  <span className="chat-poll-option-text">
                    {hasVoted
                      ? '✓ '
                      : ''}
                    {option.text}
                  </span>

                  <span className="chat-poll-option-count">
                    {pct}% ({count})
                  </span>
                </button>
              );
            }
          )}
        </div>

        <div className="chat-rich-meta">
          {totalVotes}{' '}
          {totalVotes === 1
            ? 'vote'
            : 'votes'}{' '}
          ·{' '}
          {poll.isMultiChoice
            ? 'Multi-choice'
            : 'Single-choice'}
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // QUIZ
  // ─────────────────────────────────────────────────────────────

  const renderQuiz = (
    quiz: NonNullable<typeof message.quiz>
  ) => {
    const myAnswer =
      quiz.answers?.[myPeerId];

    const hasAnswered =
      typeof myAnswer === 'number';

    const totalAnswers = Object.keys(
      quiz.answers || {}
    ).length;

    return (
      <div className="chat-rich-card chat-quiz-card">
        <div className="chat-rich-title chat-quiz-title">
          <HelpCircle size={13} />

          <span>
            DSA Challenge:{' '}
            {quiz.question}
          </span>
        </div>

        <div className="chat-quiz-options">
          {quiz.options.map(
            (optText, oIdx) => {
              const isCorrect =
                oIdx ===
                quiz.correctOptionIndex;

              const isMyPick =
                myAnswer === oIdx;

              return (
                <button
                  key={oIdx}
                  type="button"
                  disabled={hasAnswered}
                  onClick={() =>
                    onAnswerQuiz?.(
                      message.id,
                      quiz.id,
                      oIdx
                    )
                  }
                  className={[
                    'chat-quiz-option',
                    isCorrect &&
                    hasAnswered
                      ? 'chat-quiz-correct'
                      : '',
                    isMyPick &&
                    hasAnswered &&
                    !isCorrect
                      ? 'chat-quiz-wrong'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span>
                    {String.fromCharCode(
                      65 + oIdx
                    )}
                    . {optText}
                  </span>

                  {hasAnswered && (
                    <span className="chat-quiz-result">
                      {isCorrect
                        ? '✅ Correct'
                        : isMyPick
                          ? '❌ Wrong'
                          : ''}
                    </span>
                  )}
                </button>
              );
            }
          )}
        </div>

        {hasAnswered &&
          quiz.explanation && (
            <div className="chat-quiz-explanation-wrap">
              <button
                type="button"
                className="btn btn-ghost btn-sm chat-quiz-explanation-button"
                onClick={() =>
                  setShowQuizExplanation(
                    !showQuizExplanation
                  )
                }
              >
                <Sparkles size={11} />

                <span>
                  {showQuizExplanation
                    ? 'Hide Explanation'
                    : 'View Explanation'}
                </span>

                {showQuizExplanation ? (
                  <ChevronUp size={11} />
                ) : (
                  <ChevronDown size={11} />
                )}
              </button>

              {showQuizExplanation && (
                <div className="chat-quiz-explanation">
                  {quiz.explanation}
                </div>
              )}
            </div>
          )}

        <div className="chat-rich-meta">
          {totalAnswers}{' '}
          {totalAnswers === 1
            ? 'participant'
            : 'participants'}{' '}
          answered
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // FILE
  // ─────────────────────────────────────────────────────────────

  const renderFile = (
    file: NonNullable<
      typeof message.fileAttachment
    >
  ) => {
    return (
      <div className="chat-rich-card chat-file-card">
        <div className="chat-file-info">
          <FileText
            size={16}
            color="var(--primary)"
          />

          <div className="chat-file-text">
            <div className="chat-file-name">
              {file.name}
            </div>

            <div className="chat-file-size">
              {(file.size / 1024).toFixed(1)}{' '}
              KB
            </div>
          </div>
        </div>

        <a
          href={file.dataUrl}
          download={file.name}
          className="btn btn-secondary btn-sm chat-file-download"
        >
          <Download size={11} />
          <span>Download</span>
        </a>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // CARD
  // ─────────────────────────────────────────────────────────────

  return (
    <div
      className={`glass-card chat-card ${
        message.isSelf
          ? 'chat-card-self'
          : 'chat-card-other'
      }`}
    >
      {/* Floating reaction toolbar */}
      {onReact && (
        <div
          className="reaction-bar"
          role="toolbar"
          aria-label="Message reactions"
        >
          {DEFAULT_REACTIONS.map(
            (emoji) => (
              <button
                key={emoji}
                type="button"
                className="reaction-btn"
                onClick={() =>
                  onReact(
                    message.id,
                    emoji
                  )
                }
                title={`React with ${emoji}`}
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </button>
            )
          )}
        </div>
      )}

      {/* Reply preview */}
      {renderReplyPreview()}

      {/* Header */}
      <div className="chat-card-header">
        {/* <div className="chat-author">
          <span
            className="chat-author-avatar"
            style={{
              background:
                message.isSelf
                  ? 'var(--primary)'
                  : message.from.color ||
                    'var(--primary)',
              color: '#ffffff',
            }}
          >
            {message.from.avatar}
          </span>

          <span
            className="chat-author-name"
            style={{
              color:
                message.isSelf
                  ? 'var(--text-primary)'
                  : message.from.color ||
                    'var(--primary)',
            }}
          >
            {message.isSelf
              ? ''
              : message.from.nickname}
          </span>
        </div> */}
<div className="chat-author">
  {!message.isSelf && (
    <>
      <span
        className="chat-author-avatar"
        style={{
          background:
            message.from.color ||
            'var(--primary)',
          color: '#ffffff',
        }}
      >
        {message.from.avatar}
      </span>

      <span
        className="chat-author-name"
        style={{
          color:
            message.from.color ||
            'var(--primary)',
        }}
      >
        {message.from.nickname}
      </span>
    </>
  )}
</div>
        <div className="chat-card-header-meta">
          <span className="chat-timestamp">
            {formatTimestamp(
              message.timestamp
            )}
          </span>

          {onReply && (
            <button
              type="button"
              className="chat-reply-button"
              onClick={() =>
                onReply(message)
              }
              title="Reply"
              aria-label="Reply"
            >
              <CornerUpLeft size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Message body */}
      <div className="chat-body">
        {message.text &&
          renderFormattedText(
            message.text
          )}

        {message.imageUrl &&
          renderImage(
            message.imageUrl,
            message.imageCaption
          )}

        {message.codeSnippet &&
          renderCodeSnippet(
            message.codeSnippet
          )}

        {message.poll &&
          renderPoll(
            message.poll
          )}

        {message.quiz &&
          renderQuiz(
            message.quiz
          )}

        {message.fileAttachment &&
          renderFile(
            message.fileAttachment
          )}
      </div>

      {/* Persistent reactions */}
      {message.reactions &&
        Object.keys(
          message.reactions
        ).length > 0 && (
          <div className="reactions-list">
            {Object.entries(
              message.reactions
            ).map(
              ([emoji, reactors]) => {
                const hasMyReaction =
                  reactors.includes(
                    myPeerId
                  );

                return (
                  <button
                    key={emoji}
                    type="button"
                    className={`reaction-pill ${
                      hasMyReaction
                        ? 'active'
                        : ''
                    }`}
                    onClick={() =>
                      onReact?.(
                        message.id,
                        emoji
                      )
                    }
                    title={`${reactors.length} reactions`}
                  >
                    <span>
                      {emoji}
                    </span>

                    <span>
                      {reactors.length}
                    </span>
                  </button>
                );
              }
            )}
          </div>
        )}

      {/* ACK */}
      {message.isSelf && (
        <div className="chat-footer">
          {message.status ===
            'pending' && (
            <span className="ack-icon">
              ⏳
            </span>
          )}

          {message.status ===
            'sent' && (
            <Check
              size={11}
              className="ack-icon"
              color="var(--text-dim)"
            />
          )}

          {message.status ===
            'delivered' && (
            <CheckCheck
              size={11}
              className="ack-icon"
              color="var(--text-secondary)"
            />
          )}

          {message.status ===
            'read' && (
            <CheckCheck
              size={11}
              className="ack-icon ack-read"
              color="var(--accent-cyan)"
            />
          )}
        </div>
      )}
    </div>
  );
};