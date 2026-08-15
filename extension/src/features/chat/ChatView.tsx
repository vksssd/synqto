// ─── Unified Chat View Component ───

import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, RefreshCw } from 'lucide-react';
import { ChatService, ChatMessageItem } from './chat.service';
import { ChatCard } from './ChatCard';
import { ChatInput } from './ChatInput';
import { PeerIdentity } from '@/core/network/packet';

interface ChatViewProps {
  myIdentity: PeerIdentity | null;
  roomId: string;
}

export const ChatView: React.FC<ChatViewProps> = ({ myIdentity, roomId }) => {
  const chatService = ChatService.getInstance();
  const [messages, setMessages] = useState<ChatMessageItem[]>(chatService.getMessages());
  const [replyingTo, setReplyingTo] = useState<ChatMessageItem | null>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (myIdentity && roomId) {
      chatService.init(roomId, myIdentity.peerId);
      chatService.markAsRead();
    }
  }, [roomId, myIdentity]);

  useEffect(() => {
    const unsub = chatService.onChange((updated) => {
      setMessages([...updated]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = (text: string, replyTo?: { id: string; preview: string }) => {
    if (!myIdentity) return;
    chatService.sendMessage(text, myIdentity, replyTo);
  };

  return (
    <div className="chat-container">
      {/* Messages list */}
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
              Say hello or ask for a hint! Messages are synchronized P2P across all peers.
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <ChatCard
              key={msg.id}
              message={msg}
              onReply={(m) => setReplyingTo(m)}
            />
          ))
        )}
        <div ref={scrollEndRef} />
      </div>

      {/* Input box */}
      <ChatInput
        onSendMessage={handleSendMessage}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
      />
    </div>
  );
};
