// ─── Synqto Unified Workspace: Whiteboard & Personal Diary Container ───

import React, { useState } from 'react';
import { Palette, BookOpen } from 'lucide-react';
import { WhiteboardCanvas } from './WhiteboardCanvas';
import { DiaryView } from '@/features/diary/DiaryView';

export const BoardAndDiaryContainer: React.FC = () => {
  const [activeView, setActiveView] = useState<'whiteboard' | 'diary'>('whiteboard');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ─── Mode Switcher Bar: [ 🎨 Whiteboard | 📔 Diary & Journal ] ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          background: 'rgba(15, 23, 42, 0.98)',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            background: 'rgba(0, 0, 0, 0.45)',
            padding: '3px',
            borderRadius: '6px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            gap: '3px',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveView('whiteboard')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 700,
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              background: activeView === 'whiteboard' ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'transparent',
              color: activeView === 'whiteboard' ? '#ffffff' : 'var(--text-muted)',
              transition: 'all 0.15s ease',
            }}
          >
            <Palette size={12} />
            <span>🎨 Whiteboard</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView('diary')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 700,
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              background: activeView === 'diary' ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'transparent',
              color: activeView === 'diary' ? '#ffffff' : 'var(--text-muted)',
              transition: 'all 0.15s ease',
            }}
          >
            <BookOpen size={12} />
            <span>📔 Diary & Notes</span>
          </button>
        </div>

        <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 500 }}>
          {activeView === 'whiteboard' ? 'Drawing & Architecture Workspace' : 'Private Offline Local Storage Journal'}
        </div>
      </div>

      {/* ─── Main Content View (100% Full Workspace Space) ─── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {activeView === 'whiteboard' ? <WhiteboardCanvas /> : <DiaryView />}
      </div>
    </div>
  );
};
