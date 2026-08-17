


// ─── WhatsApp-Style Real-Time Chat View Component ───

import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  X,
  Code,
  BarChart2,
  HelpCircle,
  Download,
} from 'lucide-react';
import { ChatService, ChatMessageItem } from './chat.service';
import { ChatCard } from './ChatCard';
import { ChatInput } from './ChatInput';
import { PeerIdentity } from '@/core/network/packet';
import { DiscoveryService } from '@/features/discovery/discovery.service';
import { TutorService } from '@/features/tutor/tutor.service';
import { VoiceService } from '@/features/voice/voice.service';
// import './chatLayoutFixes.css';

interface ChatViewProps {
  myIdentity: PeerIdentity | null;
  roomId: string;
}

export const ChatView: React.FC<ChatViewProps> = ({ myIdentity, roomId }) => {
  const chatService = ChatService.getInstance();
  const discoveryService = DiscoveryService.getInstance();
  const tutorService = TutorService.getInstance();
  const voiceService = VoiceService.getInstance();

  const [messages, setMessages] = useState<ChatMessageItem[]>(chatService.getMessages());
  const [replyingTo, setReplyingTo] = useState<ChatMessageItem | null>(null);
  const [peers, setPeers] = useState<PeerIdentity[]>(
    discoveryService.getOnlinePeers().map((p) => p.identity)
  );
  const [stageState, setStageState] = useState(tutorService.getState());
  const [isInVoice, setIsInVoice] = useState(voiceService.getIsInVoice());

  // Modals state
  const [lightboxImage, setLightboxImage] = useState<{ url: string; caption?: string } | null>(null);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [showQuizModal, setShowQuizModal] = useState(false);

  // Form states for modals
  const [codeText, setCodeText] = useState('');
  const [codeLanguage, setCodeLanguage] = useState('python');
  const [codeTitle, setCodeTitle] = useState('');

  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['Option 1', 'Option 2']);
  const [pollMultiChoice, setPollMultiChoice] = useState(false);

  const [quizQuestion, setQuizQuestion] = useState('');
  const [quizOptions, setQuizOptions] = useState(['Option A', 'Option B', 'Option C', 'Option D']);
  const [quizCorrectIndex, setQuizCorrectIndex] = useState(0);
  const [quizExplanation, setQuizExplanation] = useState('');

  const scrollEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (myIdentity && roomId) {
      chatService.init(roomId, myIdentity.peerId);
      chatService.markAsRead();
    }
  }, [roomId, myIdentity]);

  useEffect(() => {
    const unsubMessages = chatService.onMessages((updated) => {
      setMessages([...updated]);
    });

    const unsubDiscovery = discoveryService.onChange((onlinePeers) => {
      setPeers(onlinePeers.map((p) => p.identity));
    });

    const unsubTutor = tutorService.onStateChange((st) => {
      setStageState(st);
    });

    const unsubVoice = voiceService.onStateChange((inVoice) => {
      setIsInVoice(inVoice);
    });

    setPeers(discoveryService.getOnlinePeers().map((p) => p.identity));

    return () => {
      unsubMessages();
      unsubDiscovery();
      unsubTutor();
      unsubVoice();
    };
  }, [chatService, discoveryService, tutorService, voiceService]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Live Stream and Voice Lounge Handlers
  const handleGoLive = () => {
    if (stageState.myRole === 'tutor') {
      tutorService.stopTutorStage(roomId);
    } else {
      tutorService.startTutorStage('screen', roomId, `${myIdentity?.nickname || 'Tutor'}'s Screen`);
    }
  };

  const handleToggleVoice = async () => {
    if (isInVoice) {
      voiceService.leaveVoice();
    } else {
      await voiceService.joinVoice();
    }
  };

  // Message Send Handlers
  const handleSendMessage = (text: string, replyTo?: { id: string; preview: string }) => {
    if (!myIdentity) return;
    chatService.sendMessage(text, myIdentity, { replyTo });
  };

  const handleSendImage = (dataUrl: string, caption = '') => {
    if (!myIdentity) return;
    chatService.sendImage(dataUrl, caption, myIdentity);
  };

  const handleCaptureScreenshot = async () => {
    if (!myIdentity) return;
    await chatService.captureAndSendScreenshot(myIdentity, '📸 Active Tab Screenshot');
  };

  const handleAttachFile = (file: File) => {
    if (!myIdentity) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        chatService.sendFileAttachment(
          {
            name: file.name,
            size: file.size,
            type: file.type,
            dataUrl: e.target.result as string,
          },
          myIdentity
        );
      }
    };
    reader.readAsDataURL(file);
  };

  const handleReact = (messageId: string, emoji: string) => {
    if (!myIdentity) return;
    chatService.toggleReaction(messageId, emoji, myIdentity);
  };

  const handleVotePoll = (messageId: string, pollId: string, optionId: string, isMultiChoice = false) => {
    if (!myIdentity) return;
    chatService.votePoll(messageId, pollId, optionId, myIdentity, isMultiChoice);
  };

  const handleAnswerQuiz = (messageId: string, quizId: string, selectedIndex: number) => {
    if (!myIdentity) return;
    chatService.answerQuiz(messageId, quizId, selectedIndex, myIdentity);
  };

  // Submit Code Snippet Modal
  const handleSubmitCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!myIdentity || !codeText.trim()) return;
    chatService.sendCodeSnippet(codeText, codeLanguage, codeTitle, myIdentity);
    setCodeText('');
    setCodeTitle('');
    setShowCodeModal(false);
  };

  // Submit Poll Modal
  const handleSubmitPoll = (e: React.FormEvent) => {
    e.preventDefault();
    if (!myIdentity || !pollQuestion.trim()) return;
    const validOpts = pollOptions.filter((o) => o.trim().length > 0);
    if (validOpts.length < 2) return;
    chatService.sendPoll(pollQuestion, validOpts, pollMultiChoice, myIdentity);
    setPollQuestion('');
    setPollOptions(['Option 1', 'Option 2']);
    setShowPollModal(false);
  };

  // Submit Quiz Modal
  const handleSubmitQuiz = (e: React.FormEvent) => {
    e.preventDefault();
    if (!myIdentity || !quizQuestion.trim()) return;
    const validOpts = quizOptions.filter((o) => o.trim().length > 0);
    if (validOpts.length < 2) return;
    chatService.sendQuiz(quizQuestion, validOpts, quizCorrectIndex, quizExplanation, myIdentity);
    setQuizQuestion('');
    setQuizOptions(['Option A', 'Option B', 'Option C', 'Option D']);
    setQuizExplanation('');
    setShowQuizModal(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* ─── Messages List ─── */}
      <div className="message-list">
        {messages.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--text-muted)',
              gap: '8px',
              padding: '30px 10px',
              textAlign: 'center',
            }}
          >
            <MessageSquare size={32} color="var(--text-dim)" />
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              No messages yet
            </div>
            <div style={{ fontSize: '11px', maxWidth: '220px' }}>
              Say hello, share a screenshot, or type @ to mention room peers!
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div className="chat-card-item" key={msg.id}>
              <ChatCard
                message={msg}  
                messages={messages}
                myIdentity={myIdentity}
                onReply={(m) => setReplyingTo(m)}
                onReact={handleReact}
                onVotePoll={handleVotePoll}
                onAnswerQuiz={handleAnswerQuiz}
                onOpenImage={(url, caption) => setLightboxImage({ url, caption })}
              />
            </div>
          ))
        )}
        <div ref={scrollEndRef} />
      </div>

      {/* ─── Chat Composer Input ─── */}
      <ChatInput
        onSendMessage={handleSendMessage}
        onSendImage={handleSendImage}
        onCaptureScreenshot={handleCaptureScreenshot}
        onOpenCodeModal={() => setShowCodeModal(true)}
        onOpenPollModal={() => setShowPollModal(true)}
        onOpenQuizModal={() => setShowQuizModal(true)}
        onAttachFile={handleAttachFile}
        onGoLive={handleGoLive}
        onToggleVoice={handleToggleVoice}
        isLive={stageState.myRole === 'tutor'}
        isInVoice={isInVoice}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        peers={peers}
      />

      {/* ─── 1. Image Lightbox Modal ─── */}
      {lightboxImage && (
        <div className="modal-overlay" onClick={() => setLightboxImage(null)}>
          <div
            style={{
              position: 'relative',
              maxWidth: '90%',
              maxHeight: '90%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightboxImage.url}
              alt="Enlarged"
              style={{
                maxWidth: '100%',
                maxHeight: '80vh',
                borderRadius: '8px',
                boxShadow: 'var(--shadow-lg)',
                objectFit: 'contain',
              }}
            />
            {lightboxImage.caption && (
              <div style={{ color: '#fff', fontSize: '12px', background: 'rgba(0,0,0,0.6)', padding: '4px 12px', borderRadius: '4px' }}>
                {lightboxImage.caption}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <a
                href={lightboxImage.url}
                download="synqto-screenshot.png"
                className="btn btn-primary btn-sm"
                style={{ fontSize: '11px', gap: '4px' }}
              >
                <Download size={12} />
                <span>Download</span>
              </a>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setLightboxImage(null)}
                style={{ fontSize: '11px' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 2. Code Snippet Modal ─── */}
      {showCodeModal && (
        <div className="modal-overlay" onClick={() => setShowCodeModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                <Code size={15} color="var(--primary)" />
                <span>Share Code Snippet</span>
              </div>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setShowCodeModal(false)}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSubmitCode} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  className="input-glass"
                  placeholder="Snippet Title (optional)..."
                  value={codeTitle}
                  onChange={(e) => setCodeTitle(e.target.value)}
                  style={{ flex: 1, fontSize: '11px' }}
                />
                <select
                  value={codeLanguage}
                  onChange={(e) => setCodeLanguage(e.target.value)}
                  style={{
                    background: 'var(--bg-glass-input)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '4px',
                    padding: '4px 6px',
                    fontSize: '11px',
                  }}
                >
                  <option value="python">Python</option>
                  <option value="cpp">C++</option>
                  <option value="java">Java</option>
                  <option value="javascript">JavaScript</option>
                  <option value="go">Go</option>
                  <option value="rust">Rust</option>
                  <option value="sql">SQL</option>
                </select>
              </div>

              <textarea
                className="input-glass"
                placeholder="Paste your code snippet here..."
                value={codeText}
                onChange={(e) => setCodeText(e.target.value)}
                rows={6}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', resize: 'vertical' }}
                autoFocus
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowCodeModal(false)} style={{ fontSize: '11px' }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={!codeText.trim()} style={{ fontSize: '11px' }}>
                  Share Code
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── 3. Live Poll Modal ─── */}
      {showPollModal && (
        <div className="modal-overlay" onClick={() => setShowPollModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                <BarChart2 size={15} color="var(--primary)" />
                <span>Create Live Poll</span>
              </div>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setShowPollModal(false)}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSubmitPoll} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="text"
                className="input-glass"
                placeholder="Ask a question (e.g. Which approach is faster?)..."
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
                style={{ fontSize: '11px' }}
                autoFocus
              />

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {pollOptions.map((opt, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '4px' }}>
                    <input
                      type="text"
                      className="input-glass"
                      placeholder={`Option ${idx + 1}...`}
                      value={opt}
                      onChange={(e) => {
                        const updated = [...pollOptions];
                        updated[idx] = e.target.value;
                        setPollOptions(updated);
                      }}
                      style={{ flex: 1, fontSize: '11px' }}
                    />
                    {pollOptions.length > 2 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        onClick={() => setPollOptions(pollOptions.filter((_, i) => i !== idx))}
                        style={{ width: '26px', height: '26px' }}
                      >
                        <X size={12} color="var(--accent-rose)" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {pollOptions.length < 5 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPollOptions([...pollOptions, `Option ${pollOptions.length + 1}`])}
                  style={{ alignSelf: 'flex-start', fontSize: '10.5px', color: 'var(--primary)' }}
                >
                  + Add Option
                </button>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={pollMultiChoice}
                  onChange={(e) => setPollMultiChoice(e.target.checked)}
                />
                <span>Allow multiple choices</span>
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '4px' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPollModal(false)} style={{ fontSize: '11px' }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={!pollQuestion.trim()} style={{ fontSize: '11px' }}>
                  Launch Poll
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── 4. DSA Quiz Modal ─── */}
      {showQuizModal && (
        <div className="modal-overlay" onClick={() => setShowQuizModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: '#fbbf24' }}>
                <HelpCircle size={15} color="#f59e0b" />
                <span>Create DSA Quiz Challenge</span>
              </div>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setShowQuizModal(false)}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSubmitQuiz} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="text"
                className="input-glass"
                placeholder="Question (e.g. Time complexity of Heapify?)..."
                value={quizQuestion}
                onChange={(e) => setQuizQuestion(e.target.value)}
                style={{ fontSize: '11px' }}
                autoFocus
              />

              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                Select the radio button next to the <strong>correct answer</strong>:
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {quizOptions.map((opt, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="radio"
                      name="quiz_correct"
                      checked={quizCorrectIndex === idx}
                      onChange={() => setQuizCorrectIndex(idx)}
                      style={{ accentColor: '#10b981' }}
                    />
                    <input
                      type="text"
                      className="input-glass"
                      placeholder={`Choice ${String.fromCharCode(65 + idx)}...`}
                      value={opt}
                      onChange={(e) => {
                        const updated = [...quizOptions];
                        updated[idx] = e.target.value;
                        setQuizOptions(updated);
                      }}
                      style={{ flex: 1, fontSize: '11px' }}
                    />
                  </div>
                ))}
              </div>

              <textarea
                className="input-glass"
                placeholder="Explanation (revealed after answer, optional)..."
                value={quizExplanation}
                onChange={(e) => setQuizExplanation(e.target.value)}
                rows={2}
                style={{ fontSize: '10.5px' }}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '4px' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowQuizModal(false)} style={{ fontSize: '11px' }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={!quizQuestion.trim()} style={{ fontSize: '11px' }}>
                  Post Challenge
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};