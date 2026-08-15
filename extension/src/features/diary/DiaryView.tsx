// ─── Synqto Personal Diary & Journal Notebook View ───

import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Plus,
  Trash2,
  Download,
  Search,
  Tag,
  Smile,
  Calendar,
  ExternalLink,
  ChevronDown,
  Edit3,
  Code,
  CheckSquare,
  List,
  Check,
} from 'lucide-react';
import { DiaryService } from './diary.service';
import { DiaryBook, DiaryEntry, DiaryMood } from './diary.types';

const MOODS: { id: DiaryMood; icon: string; label: string; color: string }[] = [
  { id: 'productive', icon: '🚀', label: 'Productive', color: '#10b981' },
  { id: 'breakthrough', icon: '💡', label: 'Breakthrough', color: '#f59e0b' },
  { id: 'challenging', icon: '🧠', label: 'Challenging', color: '#6366f1' },
  { id: 'mastered', icon: '🎯', label: 'Mastered', color: '#06b6d4' },
  { id: 'review_needed', icon: '⚠️', label: 'Review Needed', color: '#f43f5e' },
];

export const DiaryView: React.FC = () => {
  const diaryService = DiaryService.getInstance();
  const [diaries, setDiaries] = useState<DiaryBook[]>(diaryService.getDiaries());
  const [activeDiary, setActiveDiary] = useState<DiaryBook>(diaryService.getActiveDiary());
  const [activeEntry, setActiveEntry] = useState<DiaryEntry | null>(diaryService.getActiveEntry());

  const [searchQuery, setSearchQuery] = useState('');
  const [isDiaryDropdownOpen, setIsDiaryDropdownOpen] = useState(false);
  const [isCreatingDiary, setIsCreatingDiary] = useState(false);
  const [newDiaryTitle, setNewDiaryTitle] = useState('');
  const [newDiaryIcon, setNewDiaryIcon] = useState('📓');
  const [newDiaryColor, setNewDiaryColor] = useState('#6366f1');

  const [newTagInput, setNewTagInput] = useState('');
  const [copiedToast, setCopiedToast] = useState(false);

  useEffect(() => {
    return diaryService.onStateChange((state) => {
      setDiaries(state.diaries);
      const curDiary = state.diaries.find((d) => d.id === state.activeDiaryId) || state.diaries[0];
      setActiveDiary(curDiary);
      const curEntry = curDiary?.entries.find((e) => e.id === state.activeEntryId) || curDiary?.entries[0] || null;
      setActiveEntry(curEntry);
    });
  }, [diaryService]);

  // Create New Entry
  const handleCreateNewEntry = () => {
    diaryService.createEntry(activeDiary.id);
  };

  // Create New Diary Book
  const handleSaveNewDiary = (e: React.FormEvent) => {
    e.preventDefault();
    if (newDiaryTitle.trim()) {
      diaryService.createDiary(newDiaryTitle.trim(), newDiaryIcon, newDiaryColor);
      setNewDiaryTitle('');
      setIsCreatingDiary(false);
      setIsDiaryDropdownOpen(false);
    }
  };

  // Export Diary to Markdown
  const handleExportMarkdown = () => {
    const md = diaryService.exportDiaryMarkdown(activeDiary.id);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `${activeDiary.title.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.md`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Add Tag to Active Entry
  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newTagInput.trim() && activeEntry) {
      e.preventDefault();
      const formatted = newTagInput.trim().startsWith('#') ? newTagInput.trim() : `#${newTagInput.trim()}`;
      if (!activeEntry.tags.includes(formatted)) {
        const updated = [...activeEntry.tags, formatted];
        diaryService.updateEntry(activeDiary.id, activeEntry.id, { tags: updated });
      }
      setNewTagInput('');
    }
  };

  // Remove Tag
  const handleRemoveTag = (tagToRemove: string) => {
    if (!activeEntry) return;
    const updated = activeEntry.tags.filter((t) => t !== tagToRemove);
    diaryService.updateEntry(activeDiary.id, activeEntry.id, { tags: updated });
  };

  // Filter entries
  const filteredEntries = activeDiary?.entries.filter((entry) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      entry.title.toLowerCase().includes(q) ||
      entry.content.toLowerCase().includes(q) ||
      entry.tags.some((t) => t.toLowerCase().includes(q)) ||
      (entry.problemTitle && entry.problemTitle.toLowerCase().includes(q))
    );
  }) || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#090d16', overflow: 'hidden' }}>
      {/* ─── 1. Top Diary Header Bar ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'rgba(15, 23, 42, 0.95)',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {/* Diary Selector Pill */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setIsDiaryDropdownOpen(!isDiaryDropdownOpen)}
            style={{
              fontSize: '11px',
              fontWeight: 700,
              padding: '4px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(99, 102, 241, 0.15)',
              borderColor: 'rgba(99, 102, 241, 0.4)',
              color: '#ffffff',
            }}
          >
            <span>{activeDiary.icon}</span>
            <span>{activeDiary.title}</span>
            <ChevronDown size={11} color="#c7d2fe" />
          </button>

          {/* Diary Books Dropdown Menu */}
          {isDiaryDropdownOpen && (
            <div
              style={{
                position: 'absolute',
                top: '36px',
                left: 0,
                zIndex: 100,
                width: '240px',
                background: 'rgba(15, 23, 42, 0.98)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '6px',
                boxShadow: '0 20px 40px rgba(0,0,0,0.8)',
                backdropFilter: 'blur(20px)',
              }}
            >
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', padding: '4px 6px' }}>
                YOUR DIARIES ({diaries.length})
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '180px', overflowY: 'auto' }}>
                {diaries.map((d) => (
                  <div
                    key={d.id}
                    onClick={() => {
                      diaryService.setActiveDiary(d.id);
                      setIsDiaryDropdownOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      borderRadius: '5px',
                      background: d.id === activeDiary.id ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                      <span style={{ fontSize: '14px' }}>{d.icon}</span>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#fff' }}>{d.title}</div>
                        <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{d.entries.length} entries</div>
                      </div>
                    </div>

                    {diaries.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete diary "${d.title}" and all its entries?`)) {
                            diaryService.deleteDiary(d.id);
                          }
                        }}
                        style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '2px' }}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Create New Diary Button */}
              {!isCreatingDiary ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setIsCreatingDiary(true)}
                  style={{ width: '100%', marginTop: '6px', fontSize: '10px', color: 'var(--primary)' }}
                >
                  <Plus size={11} style={{ marginRight: '4px' }} />
                  <span>Create New Diary</span>
                </button>
              ) : (
                <form onSubmit={handleSaveNewDiary} style={{ marginTop: '8px', borderTop: '1px solid var(--border-subtle)', paddingTop: '6px' }}>
                  <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                    <select
                      value={newDiaryIcon}
                      onChange={(e) => setNewDiaryIcon(e.target.value)}
                      style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '2px 4px', fontSize: '12px' }}
                    >
                      {['📓', '💡', '🧠', '🎯', '🚀', '⚡', '📊', '🔥'].map((ico) => (
                        <option key={ico} value={ico}>{ico}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      className="input-glass"
                      placeholder="Diary Title (e.g. Graph DP Notes)"
                      value={newDiaryTitle}
                      onChange={(e) => setNewDiaryTitle(e.target.value)}
                      autoFocus
                      style={{ fontSize: '10px', padding: '4px 6px', flex: 1 }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIsCreatingDiary(false)} style={{ fontSize: '9px', padding: '2px 6px' }}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={!newDiaryTitle.trim()} style={{ fontSize: '9px', padding: '2px 6px' }}>
                      Save
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Right Actions: ➕ New Page / Entry & Export .md */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleCreateNewEntry}
            style={{
              fontSize: '11px',
              fontWeight: 700,
              padding: '4px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            }}
          >
            <Plus size={13} />
            <span>New Page</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleExportMarkdown}
            title="Download Diary as Markdown (.md)"
            style={{ fontSize: '11px', padding: '4px 8px' }}
          >
            <Download size={12} />
          </button>
        </div>
      </div>

      {/* ─── 2. Search & Filter Bar ─── */}
      <div style={{ padding: '6px 12px', background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={12} color="var(--text-muted)" style={{ position: 'absolute', left: '8px', top: '8px' }} />
          <input
            type="text"
            className="input-glass"
            placeholder={`Search ${activeDiary.entries.length} entries by title, tag, or code...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ fontSize: '11px', padding: '4px 8px 4px 26px', width: '100%' }}
          />
        </div>
      </div>

      {/* ─── 3. Main Workspace: Entries List + Active Page Editor ─── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Side: Entries List (Compact Timeline) */}
        <div
          style={{
            width: '160px',
            borderRight: '1px solid var(--border-subtle)',
            background: 'rgba(15, 23, 42, 0.4)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {filteredEntries.length === 0 ? (
            <div style={{ padding: '20px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '10px' }}>
              No entries found.
            </div>
          ) : (
            filteredEntries.map((entry) => {
              const isSelected = activeEntry?.id === entry.id;
              const dateStr = new Date(entry.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const moodObj = MOODS.find((m) => m.id === entry.mood) || MOODS[0];

              return (
                <div
                  key={entry.id}
                  onClick={() => diaryService.setActiveEntry(entry.id)}
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    background: isSelected ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
                    borderLeft: isSelected ? '3px solid var(--primary)' : '3px solid transparent',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{dateStr}</span>
                    <span style={{ fontSize: '10px' }} title={moodObj.label}>{moodObj.icon}</span>
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: isSelected ? 700 : 500,
                      color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {entry.title}
                  </div>
                  {entry.tags.length > 0 && (
                    <div style={{ fontSize: '9px', color: '#818cf8', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.tags.join(' ')}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Right Side: Active Page / Entry Editor */}
        {activeEntry ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '12px', gap: '10px' }}>
            {/* Title & Delete Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <input
                type="text"
                value={activeEntry.title}
                onChange={(e) => diaryService.updateEntry(activeDiary.id, activeEntry.id, { title: e.target.value })}
                placeholder="Entry Title..."
                style={{
                  fontSize: '15px',
                  fontWeight: 700,
                  color: '#ffffff',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  width: '100%',
                }}
              />

              <button
                type="button"
                onClick={() => {
                  if (confirm('Delete this diary entry?')) {
                    diaryService.deleteEntry(activeDiary.id, activeEntry.id);
                  }
                }}
                title="Delete Entry"
                style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '4px' }}
              >
                <Trash2 size={14} />
              </button>
            </div>

            {/* Metadata Bar: Mood Selector, Tags, Problem Link */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '10px' }}>
              {/* Mood Dropdown */}
              <select
                value={activeEntry.mood}
                onChange={(e) => diaryService.updateEntry(activeDiary.id, activeEntry.id, { mood: e.target.value as any })}
                style={{
                  background: 'rgba(15, 23, 42, 0.8)',
                  color: '#fff',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '4px',
                  padding: '3px 6px',
                  fontSize: '10px',
                }}
              >
                {MOODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.icon} {m.label}
                  </option>
                ))}
              </select>

              {/* Tags List */}
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                {activeEntry.tags.map((t) => (
                  <span
                    key={t}
                    style={{
                      background: 'rgba(99, 102, 241, 0.15)',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      color: '#c7d2fe',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      fontSize: '9px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                    }}
                  >
                    <span>{t}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(t)}
                      style={{ background: 'none', border: 'none', color: '#f87171', padding: 0, cursor: 'pointer' }}
                    >
                      ×
                    </button>
                  </span>
                ))}

                {/* Add Tag Input */}
                <input
                  type="text"
                  placeholder="+ Add #tag (Enter)"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={handleAddTag}
                  style={{
                    background: 'transparent',
                    border: '1px dashed var(--border-subtle)',
                    borderRadius: '3px',
                    color: '#fff',
                    padding: '2px 5px',
                    fontSize: '9px',
                    width: '90px',
                  }}
                />
              </div>
            </div>

            {/* Markdown Text Editor */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '260px' }}>
              <textarea
                value={activeEntry.content}
                onChange={(e) => diaryService.updateEntry(activeDiary.id, activeEntry.id, { content: e.target.value })}
                placeholder="Write your thoughts, code, dry run notes, key takeaways, and checklists..."
                style={{
                  flex: 1,
                  width: '100%',
                  background: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  padding: '10px',
                  color: '#f8fafc',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  lineHeight: '1.6',
                  resize: 'none',
                  outline: 'none',
                }}
              />
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--text-muted)' }}>
            <BookOpen size={28} color="var(--text-dim)" />
            <div style={{ fontSize: '12px', fontWeight: 600 }}>This diary is currently empty</div>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleCreateNewEntry} style={{ fontSize: '11px' }}>
              <Plus size={12} style={{ marginRight: '4px' }} />
              <span>Write First Page</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
