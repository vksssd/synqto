// ─── WhatsApp-style Chat Composer (Mentions Autocomplete, Image Paste, Screenshot, Code, Poll, Quiz, Files) ───

import React, { useState, useRef, useEffect } from 'react';
import { Send, X, EyeOff, Plus, Camera, Code, BarChart2, HelpCircle, Paperclip, Users, Radio, Volume2, Image as ImageIcon } from 'lucide-react';
import { ChatMessageItem } from './chat.service';
import { PeerIdentity } from '@/core/network/packet';
import { OwnedTimeouts } from '@/shared/owned-timeouts';

interface ChatInputProps {
  onSendMessage: (text: string, replyTo?: { id: string; preview: string }) => void;
  onSendImage: (dataUrl: string, caption?: string) => void;
  onCaptureScreenshot: () => void;
  onOpenCodeModal: () => void;
  onOpenPollModal: () => void;
  onOpenQuizModal: () => void;
  onAttachFile: (file: File) => void;
  onGoLive?: () => void;
  onToggleVoice?: () => void;
  isLive?: boolean;
  isInVoice?: boolean;
  replyingTo: ChatMessageItem | null;
  onCancelReply: () => void;
  peers: PeerIdentity[];
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
  onSendImage,
  onCaptureScreenshot,
  onOpenCodeModal,
  onOpenPollModal,
  onOpenQuizModal,
  onAttachFile,
  onGoLive,
  onToggleVoice,
  isLive = false,
  isInVoice = false,
  replyingTo,
  onCancelReply,
  peers,
}) => {
  const [text, setText] = useState('');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showMentionPopup, setShowMentionPopup] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [stagedImage, setStagedImage] = useState<string | null>(null);
  const [stagedCaption, setStagedCaption] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const readersRef = useRef<Set<FileReader>>(new Set());
  const timeoutsRef = useRef<OwnedTimeouts | null>(null);
  if (timeoutsRef.current === null) timeoutsRef.current = new OwnedTimeouts();
  const timeouts = timeoutsRef.current;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      timeouts.clearAll();
      for (const reader of readersRef.current) reader.abort();
      readersRef.current.clear();
    };
  }, [timeouts]);

  const stageImageFile = (file: Blob) => {
    const reader = new FileReader();
    readersRef.current.add(reader);
    const release = () => readersRef.current.delete(reader);
    reader.onload = (event) => {
      release();
      if (mountedRef.current && event.target?.result) {
        setStagedImage(event.target.result as string);
      }
    };
    reader.onerror = release;
    reader.onabort = release;
    reader.readAsDataURL(file);
  };

  // Handle @ mention detection
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setText(val);

    const cursorPos = e.target.selectionStart || 0;
    const textBeforeCursor = val.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1 && !textBeforeCursor.slice(lastAtIndex).includes(' ')) {
      setMentionFilter(textBeforeCursor.slice(lastAtIndex + 1).toLowerCase());
      setShowMentionPopup(true);
    } else {
      setShowMentionPopup(false);
    }
  };

  const handleSelectMention = (mentionTag: string) => {
    if (!inputRef.current) return;
    const cursorPos = inputRef.current.selectionStart || text.length;
    const textBeforeCursor = text.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const newText = text.slice(0, lastAtIndex) + `@${mentionTag} ` + text.slice(cursorPos);
      setText(newText);
      setShowMentionPopup(false);
      timeouts.schedule(() => {
        inputRef.current?.focus();
      }, 50);
    }
  };

  // Clipboard image paste support (Ctrl+V)
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          stageImageFile(blob);
          e.preventDefault();
          return;
        }
      }
    }
  };

  // Image file select
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      stageImageFile(file);
    }
    e.target.value = '';
  };

  // Generic document file select
  const handleDocFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onAttachFile(file);
    }
    e.target.value = '';
  };

//   const handleSend = () => {
//     if (stagedImage) {
//       onSendImage(stagedImage, stagedCaption);
//       setStagedImage(null);
//       setStagedCaption('');
//       return;
//     }

//     if (!text.trim()) return;

//     // const replyData = replyingTo
//     //   ? {
//     //       id: replyingTo.id,
//     //       preview: `${replyingTo.from.nickname}: ${replyingTo.text.slice(0, 40)}`,
//     //     }
//     //   : undefined;
// const replyData = replyingTo
//   ? {
//       id: replyingTo.id,
//       preview: replyingTo.text?.trim()
//         ? replyingTo.text.slice(0, 120)
//         : replyingTo.imageUrl
//           ? '📷 Image'
//           : replyingTo.codeSnippet
//             ? '💻 Code snippet'
//             : replyingTo.poll
//               ? '📊 Poll'
//               : replyingTo.quiz
//                 ? '❓ Quiz'
//                 : replyingTo.fileAttachment
//                   ? `📎 ${replyingTo.fileAttachment.name}`
//                   : 'Message',
//     }
//   : undefined;

//     onSendMessage(text, replyData);
//     setText('');
//     onCancelReply();
//     setShowMentionPopup(false);
//   };

// const handleSend = () => {
//   if (stagedImage) {
//     onSendImage(
//       stagedImage,
//       stagedCaption
//     );

//     setStagedImage(null);
//     setStagedCaption('');

//     return;
//   }

//   if (!text.trim()) {
//     return;
//   }

//   const replyData = replyingTo
//     ? {
//         id: replyingTo.id,

//         preview: replyingTo.text?.trim()
//           ? replyingTo.text.slice(
//               0,
//               120
//             )
//           : replyingTo.imageUrl
//             ? '📷 Image'
//             : replyingTo.codeSnippet
//               ? '💻 Code snippet'
//               : replyingTo.poll
//                 ? '📊 Poll'
//                 : replyingTo.quiz
//                   ? '❓ Quiz'
//                   : replyingTo.fileAttachment
//                     ? `📎 ${replyingTo.fileAttachment.name}`
//                     : 'Message',
//       }
//     : undefined;

//   onSendMessage(
//     text,
//     replyData
//   );

//   setText('');

//   onCancelReply();

//   setShowMentionPopup(false);
// };
const handleSend = () => {
  if (stagedImage) {
    onSendImage(
      stagedImage,
      stagedCaption
    );

    setStagedImage(null);
    setStagedCaption('');

    return;
  }

  const trimmedText = text.trim();

  if (!trimmedText) {
    return;
  }

  const replyData = replyingTo
    ? {
        id: replyingTo.id,
        preview:
          replyingTo.text?.trim()
            ? replyingTo.text.slice(0, 120)
            : replyingTo.imageUrl
              ? '📷 Image'
              : replyingTo.codeSnippet
                ? '💻 Code snippet'
                : replyingTo.poll
                  ? '📊 Poll'
                  : replyingTo.quiz
                    ? '❓ Quiz'
                    : replyingTo.fileAttachment
                      ? `📎 ${replyingTo.fileAttachment.name}`
                      : 'Message',
      }
    : undefined;

  onSendMessage(
    trimmedText,
    replyData
  );

  setText('');
  setShowMentionPopup(false);
  onCancelReply();
};
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'Escape') {
      setShowMentionPopup(false);
      setShowAttachMenu(false);
    }
  };

  const insertSpoiler = () => {
    setText((prev) => `${prev}||hint solution||`);
  };

  // Filter peers for mention dropdown
  const filteredPeers = peers.filter(
    (p) =>
      p.nickname.toLowerCase().includes(mentionFilter) ||
      p.peerId.toLowerCase().includes(mentionFilter)
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', position: 'relative' }}>
      {/* Hidden File Inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageFileChange}
        accept="image/*"
        style={{ display: 'none' }}
      />
      <input
        type="file"
        ref={docInputRef}
        onChange={handleDocFileChange}
        accept=".pdf,.txt,.md,.cpp,.py,.java,.js,.json"
        style={{ display: 'none' }}
      />

      {/* Quick Strategy Pills Row */}
      <div className="prompt-pills-row">
        {QUICK_STRATEGY_CHIPS.map((prompt, i) => (
          <button key={i} className="prompt-pill" onClick={() => onSendMessage(prompt)}>
            {prompt}
          </button>
        ))}
      </div>

      {/* Reply indicator banner */}
      {/* {replyingTo && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(99, 102, 241, 0.15)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 8px',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-secondary)',
          }}
        >
          <span>
            Replying to <strong>{replyingTo.from.nickname}</strong>: {replyingTo.text.slice(0, 30)}...
          </span>
          <button className="btn btn-ghost btn-icon" style={{ width: '18px', height: '18px' }} onClick={onCancelReply}>
            <X size={12} />
          </button>
        </div>
      )} */}
{/* WhatsApp-style reply composer */}
{/* {replyingTo && (
  <div className="composer-reply">
    <div className="composer-reply-accent" />

    <div className="composer-reply-content">
      <div className="composer-reply-title">
        Replying to {replyingTo.isSelf ? 'You' : replyingTo.from.nickname}
      </div>

      <div className="composer-reply-text">
        {replyingTo.text?.trim()
          ? replyingTo.text
          : replyingTo.imageUrl
            ? '📷 Image'
            : replyingTo.codeSnippet
              ? '💻 Code snippet'
              : replyingTo.poll
                ? '📊 Poll'
                : replyingTo.quiz
                  ? '❓ Quiz'
                  : replyingTo.fileAttachment
                    ? `📎 ${replyingTo.fileAttachment.name}`
                    : 'Message'}
      </div>
    </div>

    <button
      type="button"
      className="composer-reply-close"
      onClick={onCancelReply}
      title="Cancel reply"
      aria-label="Cancel reply"
    >
      <X size={13} />
    </button>
  </div>
)} */}
{/* WhatsApp-style reply composer */}
{replyingTo && (
  <div className="composer-reply">
    <div className="composer-reply-accent" />

    <div className="composer-reply-content">
      <div className="composer-reply-title">
        Replying to{' '}
        {replyingTo.isSelf
          ? 'You'
          : replyingTo.from.nickname}
      </div>

      <div className="composer-reply-text">
        {replyingTo.text?.trim()
          ? replyingTo.text.slice(
              0,
              120
            )
          : replyingTo.imageUrl
            ? '📷 Image'
            : replyingTo.codeSnippet
              ? '💻 Code snippet'
              : replyingTo.poll
                ? '📊 Poll'
                : replyingTo.quiz
                  ? '❓ Quiz'
                  : replyingTo.fileAttachment
                    ? `📎 ${replyingTo.fileAttachment.name}`
                    : 'Message'}
      </div>
    </div>

    <button
      type="button"
      className="composer-reply-close"
      onClick={onCancelReply}
      title="Cancel reply"
      aria-label="Cancel reply"
    >
      <X size={13} />
    </button>
  </div>
)}
      {/* Staged Image Preview (Pasted or Selected) */}
      {stagedImage && (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            padding: '6px 8px',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-medium)',
            borderRadius: 'var(--radius-md)',
            alignItems: 'center',
          }}
        >
          <img
            src={stagedImage}
            alt="Staged"
            style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '4px' }}
          />
          <input
            type="text"
            className="input-glass"
            placeholder="Add image caption..."
            value={stagedCaption}
            onChange={(e) => setStagedCaption(e.target.value)}
            style={{ flex: 1, fontSize: 'var(--font-size-sm)' }}
            autoFocus
           aria-label="Add image caption"/>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSend}
            style={{ fontSize: 'var(--font-size-sm)', padding: '4px 8px' }}
          >
            Send
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => setStagedImage(null)}
            style={{ width: '24px', height: '24px' }}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* ─── @ Mention Autocomplete Popup ─── */}
      {showMentionPopup && (
        <div
          style={{
            position: 'absolute',
            bottom: '44px',
            left: '38px',
            width: '200px',
            maxHeight: '160px',
            overflowY: 'auto',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-medium)',
            borderRadius: '8px',
            padding: '4px',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 30,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          {/* @everyone option */}
          <div
            onClick={() => handleSelectMention('everyone')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 8px',
              borderRadius: '4px',
              background: 'rgba(245, 158, 11, 0.15)',
              cursor: 'pointer',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 700,
              color: '#fbbf24',
            }}
          >
            <Users size={12} />
            <span>@everyone (All Peers)</span>
          </div>

          {filteredPeers.map((p) => (
            <div
              key={p.peerId}
              onClick={() => handleSelectMention(p.nickname)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: 'var(--font-size-sm)',
                color: 'var(--text-primary)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span>{p.avatar}</span>
              <span style={{ fontWeight: 600 }}>{p.nickname}</span>
            </div>
          ))}
        </div>
      )}

      {/* ─── WhatsApp-style Attach Menu Popup ─── */}
      {showAttachMenu && (
        <div
          style={{
            position: 'absolute',
            bottom: '44px',
            left: '6px',
            width: '180px',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-medium)',
            borderRadius: '8px',
            padding: '4px',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 30,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setShowAttachMenu(false);
              onCaptureScreenshot();
            }}
            style={{ justifyContent: 'flex-start', fontSize: 'var(--font-size-sm)', gap: '6px' }}
          >
            <Camera size={13} color="var(--primary)" />
            <span>Capture Tab Screenshot</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setShowAttachMenu(false);
              fileInputRef.current?.click();
            }}
            style={{ justifyContent: 'flex-start', fontSize: 'var(--font-size-sm)', gap: '6px' }}
          >
            <ImageIcon size={13} color="#06b6d4" />
            <span>Upload Image</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setShowAttachMenu(false);
              onOpenCodeModal();
            }}
            style={{ justifyContent: 'flex-start', fontSize: 'var(--font-size-sm)', gap: '6px' }}
          >
            <Code size={13} color="#10b981" />
            <span>Code Snippet</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setShowAttachMenu(false);
              onOpenPollModal();
            }}
            style={{ justifyContent: 'flex-start', fontSize: 'var(--font-size-sm)', gap: '6px' }}
          >
            <BarChart2 size={13} color="#8b5cf6" />
            <span>Create Poll</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setShowAttachMenu(false);
              onOpenQuizModal();
            }}
            style={{ justifyContent: 'flex-start', fontSize: 'var(--font-size-sm)', gap: '6px' }}
          >
            <HelpCircle size={13} color="#f59e0b" />
            <span>DSA Quiz Question</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setShowAttachMenu(false);
              docInputRef.current?.click();
            }}
            style={{ justifyContent: 'flex-start', fontSize: 'var(--font-size-sm)', gap: '6px' }}
          >
            <Paperclip size={13} color="#ec4899" />
            <span>Attach Document</span>
          </button>

          <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '3px 0' }} />

          {onGoLive && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setShowAttachMenu(false);
                onGoLive();
              }}
              style={{
                justifyContent: 'flex-start',
                fontSize: 'var(--font-size-sm)',
                gap: '6px',
                color: isLive ? '#f87171' : '#c7d2fe',
                fontWeight: 600,
              }}
            >
              <Radio size={13} color={isLive ? '#ef4444' : '#818cf8'} />
              <span>{isLive ? '🔴 Stop Live Stream' : '🔴 Go Live (Share Screen)'}</span>
            </button>
          )}

          {onToggleVoice && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setShowAttachMenu(false);
                onToggleVoice();
              }}
              style={{
                justifyContent: 'flex-start',
                fontSize: 'var(--font-size-sm)',
                gap: '6px',
                color: isInVoice ? '#34d399' : 'var(--text-primary)',
                fontWeight: 600,
              }}
            >
              <Volume2 size={13} color={isInVoice ? '#10b981' : '#38bdf8'} />
              <span>{isInVoice ? '🎙️ Leave Voice Room' : '🎙️ Start / Join Voice'}</span>
            </button>
          )}
        </div>
      )}

      {/* Main Composer Input Row */}
      <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
        {/* Attachment '+' Button */}
        <button
          type="button"
          className="btn btn-secondary btn-icon"
          onClick={() => setShowAttachMenu(!showAttachMenu)}
          aria-label="Attach image, screenshot, code, poll, quiz, or file"
          title="Attach Image, Screenshot, Code, Poll, Quiz, or File"
          style={{ width: '32px', height: '32px', flexShrink: 0 }}
        >
          <Plus size={15} color="var(--primary)" />
        </button>

        {/* Spoiler Toggle */}
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={insertSpoiler}
          title="Insert Spoiler Blur ||text||"
          style={{ width: '30px', height: '30px', flexShrink: 0 }}
        
            aria-label="Insert Spoiler Blur ||text||">
          <EyeOff size={14} color="var(--text-muted)" />
        </button>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          className="input-glass"
          placeholder="Message or type @ to mention, paste image..."
          value={text}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          style={{ flex: 1, fontSize: 'var(--font-size-sm)' }}
         aria-label="Message or type @ to mention, paste image"/>

        {/* Send Button */}
        <button
          type="button"
          className="btn btn-primary btn-icon"
          onClick={handleSend}
          aria-label="Send message"
          title="Send message"
          disabled={!text.trim() && !stagedImage}
          style={{ flexShrink: 0, width: '32px', height: '32px' }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
};
