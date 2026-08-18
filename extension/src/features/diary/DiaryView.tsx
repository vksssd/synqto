// ─── Synqto Personal Diary & Notes App View (Collapsible Sidebar + Markdown + Whiteboard + PDF Export) ───

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BookOpen, Plus, Trash2, Download, Search, Tag, ExternalLink, ChevronDown, Code, CheckSquare, List, FileText, Palette, Columns, Printer, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { DiaryService } from './diary.service';
import { DiaryBook, DiaryEntry, DiaryMood, DiaryWhiteboardData } from './diary.types';
import { DiaryWhiteboardCanvas } from './DiaryWhiteboardCanvas';

const MOODS: { id: DiaryMood; icon: string; label: string; color: string }[] = [
  { id: 'productive', icon: '🚀', label: 'Productive', color: '#10b981' },
  { id: 'breakthrough', icon: '💡', label: 'Breakthrough', color: '#f59e0b' },
  { id: 'challenging', icon: '🧠', label: 'Challenging', color: '#6366f1' },
  { id: 'mastered', icon: '🎯', label: 'Mastered', color: '#06b6d4' },
  { id: 'review_needed', icon: '⚠️', label: 'Review Needed', color: '#f43f5e' },
];

type EntryViewMode = 'text' | 'whiteboard' | 'split';

export const DiaryView: React.FC = () => {
  const diaryService = DiaryService.getInstance();
  const [diaries, setDiaries] = useState<DiaryBook[]>(diaryService.getDiaries());
  const [activeDiary, setActiveDiary] = useState<DiaryBook>(diaryService.getActiveDiary());
  const [activeEntry, setActiveEntry] = useState<DiaryEntry | null>(diaryService.getActiveEntry());

  // Collapsible Pages/Entries Sidebar (Collapsed by default)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(true);

  // Local state for smooth typing without cursor jumping or re-render stutter
  const [localTitle, setLocalTitle] = useState<string>('');
  const [localContent, setLocalContent] = useState<string>('');
  const saveTimeoutRef = useRef<any>(null);

  // View mode inside entry: 'text' | 'whiteboard' | 'split'
  const [entryMode, setEntryMode] = useState<EntryViewMode>('text');

  const [searchQuery, setSearchQuery] = useState('');
  const [isDiaryDropdownOpen, setIsDiaryDropdownOpen] = useState(false);
  const [isCreatingDiary, setIsCreatingDiary] = useState(false);
  const [newDiaryTitle, setNewDiaryTitle] = useState('');
  const [newDiaryIcon, setNewDiaryIcon] = useState('📓');
  const [newDiaryColor, setNewDiaryColor] = useState('#6366f1');

  const [newTagInput, setNewTagInput] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // Initialize local text state when activeEntry changes
  useEffect(() => {
    if (activeEntry) {
      setLocalTitle(activeEntry.title || '');
      setLocalContent(activeEntry.content || '');
    } else {
      setLocalTitle('');
      setLocalContent('');
    }
  }, [activeEntry?.id]);

  // Subscribe to DiaryService state changes
  useEffect(() => {
    return diaryService.onStateChange((state) => {
      setDiaries(state.diaries);
      const curDiary = state.diaries.find((d) => d.id === state.activeDiaryId) || state.diaries[0];
      setActiveDiary(curDiary);
      const curEntry = curDiary?.entries.find((e) => e.id === state.activeEntryId) || curDiary?.entries[0] || null;
      setActiveEntry(curEntry);
    });
  }, [diaryService]);

  // Debounced auto-save for typing
  const debouncedSave = useCallback(
    (title: string, content: string) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        if (activeDiary && activeEntry) {
          diaryService.updateEntry(activeDiary.id, activeEntry.id, { title, content });
        }
      }, 350);
    },
    [activeDiary, activeEntry, diaryService]
  );

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalTitle(val);
    debouncedSave(val, localContent);
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setLocalContent(val);
    debouncedSave(localTitle, val);
  };

  const handleBlur = () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (activeDiary && activeEntry) {
      diaryService.updateEntry(activeDiary.id, activeEntry.id, {
        title: localTitle,
        content: localContent,
      });
    }
  };

  // Create new page
  const handleCreateNewEntry = () => {
    if (!activeDiary) return;
    const newEntry = diaryService.createEntry(activeDiary.id, 'Untitled Problem Page', '');
    setActiveEntry(newEntry);
    setLocalTitle(newEntry.title);
    setLocalContent('');
    // Auto un-collapse sidebar to show newly added page
    setIsSidebarCollapsed(false);
  };

  // Create new diary folder
  const handleSaveNewDiary = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDiaryTitle.trim()) return;
    const newBook = diaryService.createDiary(newDiaryTitle.trim(), newDiaryIcon, newDiaryColor);
    setNewDiaryTitle('');
    setIsCreatingDiary(false);
    setIsDiaryDropdownOpen(false);
    setActiveDiary(newBook);
    setActiveEntry(newBook.entries[0] || null);
  };

  // Whiteboard drawing stroke update handler
  const handleWhiteboardChange = (wbData: DiaryWhiteboardData) => {
    if (!activeDiary || !activeEntry) return;
    diaryService.updateEntry(activeDiary.id, activeEntry.id, { whiteboard: wbData });
  };

  // Export handlers
  const handleExportMarkdown = () => {
    if (!activeEntry) return;
    diaryService.exportEntryMarkdown(activeEntry);
    setExportMenuOpen(false);
  };

  const handleExportPdf = () => {
    if (!activeEntry || !activeDiary) return;
    diaryService.exportDiaryPdf(activeDiary.id, activeEntry.id);
    setExportMenuOpen(false);
  };

  // Markdown Snippet Inserter
  const insertMarkdownSnippet = (prefix: string, suffix = '') => {
    const textarea = document.getElementById('diary-content-textarea') as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = localContent.substring(start, end);
    const replacement = `${prefix}${selected || 'text'}${suffix}`;
    const updated = localContent.substring(0, start) + replacement + localContent.substring(end);

    setLocalContent(updated);
    debouncedSave(localTitle, updated);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + (selected.length || 4));
    }, 50);
  };

  // Full Template Inserter (DSA Solution / System Design Blueprint)
  const insertTemplate = (templateMarkdown: string) => {
    const textarea = document.getElementById('diary-content-textarea') as HTMLTextAreaElement;
    const baseContent = localContent.trim() ? `${localContent}\n\n` : '';
    const updated = `${baseContent}${templateMarkdown}`;
    setLocalContent(updated);
    debouncedSave(localTitle, updated);
    setTimeout(() => {
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(updated.length, updated.length);
      }
    }, 50);
  };

  // Tag Handlers
  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newTagInput.trim() && activeEntry && activeDiary) {
      e.preventDefault();
      const tag = newTagInput.trim().replace(/^#/, '');
      if (!activeEntry.tags.includes(tag)) {
        const updated = [...activeEntry.tags, tag];
        diaryService.updateEntry(activeDiary.id, activeEntry.id, { tags: updated });
      }
      setNewTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    if (!activeEntry || !activeDiary) return;
    const updated = activeEntry.tags.filter((t) => t !== tagToRemove);
    diaryService.updateEntry(activeDiary.id, activeEntry.id, { tags: updated });
  };

  // Filter entries by search
  const filteredEntries =
    activeDiary?.entries.filter((entry) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        entry.title.toLowerCase().includes(q) ||
        entry.content.toLowerCase().includes(q) ||
        entry.tags.some((t) => t.toLowerCase().includes(q)) ||
        (entry.problemTitle && entry.problemTitle.toLowerCase().includes(q))
      );
    }) || [];

  // Word count & char count calculation
  const wordCount = localContent.trim() ? localContent.trim().split(/\s+/).length : 0;
  const charCount = localContent.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-app)', overflow: 'hidden' }}>
      {/* ─── 1. Top Diary App Header Bar ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          background: 'var(--bg-surface-elevated)',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
          position: 'relative',
          gap: '8px',
        }}
      >
        {/* Left: Sidebar Toggle + Notebook Selector Pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Collapsible Sidebar Button */}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? 'Show Pages Sidebar' : 'Collapse Pages Sidebar (Full Width)'}
            style={{
              padding: '4px 6px',
              color: isSidebarCollapsed ? 'var(--primary)' : 'var(--text-muted)',
              background: isSidebarCollapsed ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {isSidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            {isSidebarCollapsed && (
              <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>Pages ({activeDiary?.entries.length || 0})</span>
            )}
          </button>

          {/* Notebook Dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setIsDiaryDropdownOpen(!isDiaryDropdownOpen)}
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 700,
                padding: '3px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                background: 'var(--bg-hover)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
            >
              <span>{activeDiary.icon}</span>
              <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeDiary.title}
              </span>
              <ChevronDown size={11} color="var(--text-muted)" />
            </button>

            {/* Diary Folders Dropdown */}
            {isDiaryDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '34px',
                  left: 0,
                  zIndex: 100,
                  width: '240px',
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '8px',
                  padding: '6px',
                  boxShadow: 'var(--shadow-lg)',
                  backdropFilter: 'var(--glass-blur)',
                }}
              >
                <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-muted)', padding: '4px 6px' }}>
                  NOTEBOOKS ({diaries.length})
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
                        background: d.id === activeDiary.id ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                        <span style={{ fontSize: 'var(--font-size-lg)' }}>{d.icon}</span>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{d.title}</div>
                          <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>{d.entries.length} pages</div>
                        </div>
                      </div>

                      {diaries.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete notebook "${d.title}" and all pages?`)) {
                              diaryService.deleteDiary(d.id);
                            }
                          }}
                          style={{ background: 'none', border: 'none', color: 'var(--accent-rose)', cursor: 'pointer', padding: '2px' }}
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Create New Notebook */}
                {!isCreatingDiary ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setIsCreatingDiary(true)}
                    style={{ width: '100%', marginTop: '6px', fontSize: 'var(--font-size-xs)', color: 'var(--primary)' }}
                  >
                    <Plus size={11} style={{ marginRight: '4px' }} />
                    <span>Create Notebook</span>
                  </button>
                ) : (
                  <form onSubmit={handleSaveNewDiary} style={{ marginTop: '8px', borderTop: '1px solid var(--border-subtle)', paddingTop: '6px' }}>
                    <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                      <select
                        value={newDiaryIcon}
                        onChange={(e) => setNewDiaryIcon(e.target.value)}
                        style={{
                          background: 'var(--bg-glass-input)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '4px',
                          padding: '2px 4px',
                          fontSize: 'var(--font-size-md)',
                        }}
                      >
                        {['📓', '💡', '🧠', '🎯', '🚀', '⚡', '📊', '🔥'].map((ico) => (
                          <option key={ico} value={ico}>{ico}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        className="input-glass"
                        placeholder="Notebook name..."
                        value={newDiaryTitle}
                        onChange={(e) => setNewDiaryTitle(e.target.value)}
                        autoFocus
                        style={{ fontSize: 'var(--font-size-xs)', padding: '4px 6px', flex: 1 }}
                       aria-label="Notebook name"/>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIsCreatingDiary(false)} style={{ fontSize: 'var(--font-size-2xs)', padding: '2px 6px' }}>
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-primary btn-sm" disabled={!newDiaryTitle.trim()} style={{ fontSize: 'var(--font-size-2xs)', padding: '2px 6px' }}>
                        Save
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Header Actions: ➕ New Page & 📄 Export PDF / MD */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleCreateNewEntry}
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 700,
              padding: '3px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Plus size={12} />
            <span>New Page</span>
          </button>

          {/* Export Menu */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setExportMenuOpen(!exportMenuOpen)}
              title="Export as PDF / Markdown"
              style={{
                fontSize: 'var(--font-size-xs)',
                padding: '3px 7px',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                color: 'var(--accent-emerald)',
                borderColor: 'rgba(16, 185, 129, 0.4)',
                background: 'rgba(16, 185, 129, 0.12)',
              }}
            >
              <Printer size={12} />
              <span>Export</span>
              <ChevronDown size={10} />
            </button>

            {exportMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '30px',
                  right: 0,
                  zIndex: 100,
                  width: '160px',
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '6px',
                  padding: '4px',
                  boxShadow: 'var(--shadow-lg)',
                  backdropFilter: 'var(--glass-blur)',
                }}
              >
                <button
                  type="button"
                  onClick={handleExportPdf}
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%', justifyContent: 'flex-start', fontSize: 'var(--font-size-xs)', gap: '6px', color: 'var(--accent-emerald)' }}
                >
                  <Printer size={12} />
                  <span>Save as PDF (.pdf)</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportMarkdown}
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%', justifyContent: 'flex-start', fontSize: 'var(--font-size-xs)', gap: '6px', color: 'var(--primary)' }}
                >
                  <FileText size={12} />
                  <span>Download Markdown (.md)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── 2. Main Body: Collapsible Pages Sidebar + Notes Editor Workspace ─── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Side: Collapsible Pages Timeline */}
        {!isSidebarCollapsed && (
          <div
            style={{
              width: '170px',
              borderRight: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0,
            }}
          >
            {/* Search Input in Sidebar */}
            <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', position: 'relative' }}>
              <Search size={11} color="var(--text-muted)" style={{ position: 'absolute', left: '14px', top: '10px' }} />
              <input
                type="text"
                className="input-glass"
                placeholder="Search pages..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ fontSize: 'var(--font-size-xs)', padding: '3px 6px 3px 22px', width: '100%' }}
               aria-label="Search pages"/>
            </div>

            {/* List of Pages */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredEntries.length === 0 ? (
                <div style={{ padding: '20px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
                  No pages found.
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
                        padding: '7px 9px',
                        borderBottom: '1px solid var(--border-subtle)',
                        background: isSelected ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
                        borderLeft: isSelected ? '3px solid var(--primary)' : '3px solid transparent',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                        <span style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>{dateStr}</span>
                        <span style={{ fontSize: 'var(--font-size-xs)' }} title={moodObj.label}>{moodObj.icon}</span>
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          fontWeight: isSelected ? 700 : 500,
                          color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {entry.title || 'Untitled Page'}
                      </div>
                      {entry.tags.length > 0 && (
                        <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--primary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {entry.tags.map((t) => `#${t}`).join(' ')}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Right Side: Active Page Dual-Mode Editor */}
        {activeEntry ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-app)' }}>
            {/* Top Editor Bar: Title + Segmented Mode Switcher [✍️ Text | 🎨 Whiteboard | 🌗 Split] */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 12px',
                borderBottom: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              {/* Title Input */}
              <input
                type="text"
                value={localTitle}
                onChange={handleTitleChange}
                onBlur={handleBlur}
                placeholder="Page Title (e.g. Binary Search Tree Inversion)..."
                style={{
                  fontSize: 'var(--font-size-md)',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  flex: 1,
                  minWidth: '150px',
                }}
               aria-label="Page Title (e.g. Binary Search Tree Inversion)"/>

              {/* View Switcher: Text / Whiteboard / Split */}
              <div
                style={{
                  display: 'flex',
                  gap: '2px',
                  background: 'rgba(0,0,0,0.2)',
                  padding: '2px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {[
                  { id: 'text' as const, icon: FileText, label: 'Notes' },
                  { id: 'whiteboard' as const, icon: Palette, label: 'Sketch' },
                  { id: 'split' as const, icon: Columns, label: 'Split' },
                ].map((m) => {
                  const Icon = m.icon;
                  const isActive = entryMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setEntryMode(m.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '3px 7px',
                        fontSize: 'var(--font-size-xs)',
                        fontWeight: 600,
                        borderRadius: '4px',
                        border: 'none',
                        background: isActive ? 'var(--primary)' : 'transparent',
                        color: isActive ? '#ffffff' : 'var(--text-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      <Icon size={11} />
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Delete Entry */}
              <button
                type="button"
                onClick={() => {
                  if (confirm('Delete this diary page?')) {
                    diaryService.deleteEntry(activeDiary.id, activeEntry.id);
                  }
                }}
                title="Delete Page"
                style={{ background: 'none', border: 'none', color: 'var(--accent-rose)', cursor: 'pointer', padding: '2px' }}
              >
                <Trash2 size={13} />
              </button>
            </div>

            {/* Metadata Bar: Mood, Problem Link, Tags, Word Count */}
            <div
              style={{
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                padding: '4px 12px',
                borderBottom: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)',
                flexWrap: 'wrap',
                fontSize: 'var(--font-size-xs)',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Mood Selector */}
                <select
                  value={activeEntry.mood}
                  onChange={(e) => diaryService.updateEntry(activeDiary.id, activeEntry.id, { mood: e.target.value as any })}
                  style={{
                    background: 'var(--bg-glass-input)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '4px',
                    padding: '2px 4px',
                    fontSize: 'var(--font-size-xs)',
                  }}
                >
                  {MOODS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.icon} {m.label}
                    </option>
                  ))}
                </select>

                {/* Problem Link if available */}
                {activeEntry.problemUrl && (
                  <a
                    href={activeEntry.problemUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      color: 'var(--primary)',
                      textDecoration: 'none',
                      fontSize: 'var(--font-size-xs)',
                    }}
                  >
                    <ExternalLink size={10} />
                    <span>{activeEntry.problemTitle || 'Problem'}</span>
                  </a>
                )}

                {/* Tag Chips */}
                <div style={{ display: 'flex', gap: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {activeEntry.tags.map((t) => (
                    <span
                      key={t}
                      style={{
                        background: 'rgba(99, 102, 241, 0.15)',
                        border: '1px solid rgba(99, 102, 241, 0.3)',
                        color: 'var(--primary)',
                        padding: '1px 4px',
                        borderRadius: '3px',
                        fontSize: 'var(--font-size-2xs)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '2px',
                      }}
                    >
                      <span>#{t}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(t)}
                        style={{ background: 'none', border: 'none', color: 'var(--accent-rose)', padding: 0, cursor: 'pointer' }}
                      >
                        ×
                      </button>
                    </span>
                  ))}

                  <input
                    type="text"
                    placeholder="+tag"
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={handleAddTag}
                    style={{
                      background: 'transparent',
                      border: '1px dashed var(--border-subtle)',
                      borderRadius: '3px',
                      color: 'var(--text-primary)',
                      padding: '1px 4px',
                      fontSize: 'var(--font-size-2xs)',
                      width: '45px',
                    }}
                   aria-label="+tag"/>
                </div>
              </div>

              {/* Status & Word Counters */}
              <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span>{wordCount} words</span>
                <span>•</span>
                <span>{charCount} chars</span>
                <span>•</span>
                <span style={{ color: 'var(--accent-emerald)' }}>✓ Saved</span>
              </div>
            </div>

            {/* Main Content Area: Text / Board / Split */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              {/* Text Editor Pane */}
              {(entryMode === 'text' || entryMode === 'split') && (
                <div
                  style={{
                    flex: entryMode === 'split' ? '1 1 50%' : '1 1 100%',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRight: entryMode === 'split' ? '1px solid var(--border-subtle)' : 'none',
                    height: '100%',
                    background: 'var(--bg-app)',
                  }}
                >
                  {/* Markdown Quick Toolbar */}
                  <div
                    style={{
                      display: 'flex',
                      gap: '3px',
                      padding: '3px 8px',
                      background: 'var(--bg-surface)',
                      borderBottom: '1px solid var(--border-subtle)',
                      alignItems: 'center',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => insertMarkdownSnippet('**', '**')}
                      title="Bold"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '2px 5px', fontSize: 'var(--font-size-xs)', fontWeight: 700 }}
                    >
                      B
                    </button>
                    <button
                      type="button"
                      onClick={() => insertMarkdownSnippet('*', '*')}
                      title="Italic"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '2px 5px', fontSize: 'var(--font-size-xs)', fontStyle: 'italic' }}
                    >
                      I
                    </button>
                    <button
                      type="button"
                      onClick={() => insertMarkdownSnippet('`', '`')}
                      title="Inline Code"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '2px 5px', fontSize: 'var(--font-size-xs)', fontFamily: 'monospace' }}
                    >
                      &lt;/&gt;
                    </button>
                    <button
                      type="button"
                      onClick={() => insertMarkdownSnippet('```python\n', '\n```')}
                      title="Code Block"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '2px 5px', fontSize: 'var(--font-size-xs)' }}
                    >
                      <Code size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => insertMarkdownSnippet('- [ ] ')}
                      title="Checklist"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '2px 5px', fontSize: 'var(--font-size-xs)' }}
                    >
                      <CheckSquare size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => insertMarkdownSnippet('### ')}
                      title="Heading"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '2px 5px', fontSize: 'var(--font-size-xs)' }}
                    >
                      H3
                    </button>
                    <button
                      type="button"
                      onClick={() => insertMarkdownSnippet('- ')}
                      title="Bullet List"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '2px 5px', fontSize: 'var(--font-size-xs)' }}
                    >
                      <List size={11} />
                    </button>

                    <div style={{ width: '1px', height: '12px', background: 'var(--border-subtle)', margin: '0 2px' }} />

                    {/* DSA & System Design Note Templates */}
                    <span style={{ fontSize: 'var(--font-size-2xs)', color: '#818cf8', fontWeight: 700, marginLeft: '2px' }}>⚡ Templates:</span>

                    <button
                      type="button"
                      onClick={() =>
                        insertTemplate(
                          `### 💡 Problem Intuition & Core Invariant\n- **Pattern**: [Two Pointers / Sliding Window / Monotonic Stack / 2D DP / Binary Search]\n- **Key Insight**: \n- **Invariant**: \n\n### 📐 Step-by-Step Algorithm\n1. Initialize data structures / boundary pointers.\n2. Iterate through input elements while maintaining invariants.\n3. Return computed optimal result.\n\n### ⚠️ Edge Cases & Pitfalls\n- [ ] Empty input / single element ($N = 0, 1$)\n- [ ] Duplicate values / all equal elements\n- [ ] Negative numbers / zero boundary\n- [ ] Integer overflow ($> 2^{31}-1$)\n\n### ⏱️ Complexity\n- **Time Complexity**: $O(N)$\n- **Space Complexity**: $O(1)$ auxiliary space\n\n### 💻 Optimal Implementation\n\`\`\`python\ndef solve(nums: list[int], target: int) -> int:\n    left, right = 0, len(nums) - 1\n    while left < right:\n        curr = nums[left] + nums[right]\n        if curr == target:\n            return [left, right]\n        elif curr < target:\n            left += 1\n        else:\n            right -= 1\n    return -1\n\`\`\`\n`
                        )
                      }
                      title="Insert LeetCode / DSA Solution Blueprint"
                      style={{
                        padding: '2px 6px',
                        fontSize: 'var(--font-size-2xs)',
                        fontWeight: 600,
                        borderRadius: '4px',
                        border: '1px solid rgba(99, 102, 241, 0.3)',
                        background: 'rgba(99, 102, 241, 0.15)',
                        color: '#c7d2fe',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      🔲 DSA Blueprint
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        insertTemplate(
                          `# 🏛️ System Design Architecture: [System Name]\n\n### 1. Requirements Exploration\n- **Functional Requirements**:\n  1. Users can submit ...\n  2. Users can retrieve ...\n  3. Real-time updates for ...\n- **Non-Functional Requirements**:\n  - High Availability (99.99%) & Low Latency (< 50ms p99)\n  - Read:Write Ratio: 100:1 (Read-heavy)\n  - CAP Choice: AP (High Availability with Eventual Consistency)\n\n### 2. Capacity & Scale Estimation\n- **Traffic**: 100M DAU × 10 requests = 1B requests/day (~12,000 QPS average, ~25,000 QPS peak)\n- **Storage**: 1B writes/day × 500 bytes = 500 GB/day → ~180 TB/year\n\n### 3. High-Level Architecture Blueprint\n- **Edge**: Cloudflare CDN (Static caching) + GeoDNS\n- **Ingress**: AWS ALB / NGINX with Token Bucket Rate Limiter\n- **Web Tier**: Stateless Microservices (Auto-scaling cluster)\n- **Cache**: Redis Cluster (LRU eviction, Cache-Aside)\n- **Database**: Sharded PostgreSQL (Primary write + Read replicas)\n- **Async Queue**: Apache Kafka + Worker fleet\n\n### 4. Data Model & Schema\n\`\`\`sql\nCREATE TABLE items (\n    id VARCHAR(64) PRIMARY KEY,\n    user_id VARCHAR(64) NOT NULL,\n    payload JSONB NOT NULL,\n    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()\n);\nCREATE INDEX idx_user_items ON items(user_id, created_at DESC);\n\`\`\`\n\n### 5. Deep-Dive & Trade-offs (CAP Theorem)\n- **Consistent Hashing**: Virtual nodes for database partition balance.\n- **Cache Invalidation**: Redis Pub/Sub event broadcast on mutation.\n- **Trade-off**: CP vs AP — chose AP with idempotent retry queues.\n`
                        )
                      }
                      title="Insert System Design Interview Framework"
                      style={{
                        padding: '2px 6px',
                        fontSize: 'var(--font-size-2xs)',
                        fontWeight: 600,
                        borderRadius: '4px',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: '#6ee7b7',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      🏛️ System Design Blueprint
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        insertTemplate(
                          `### ⚡ Algorithm Pattern Cheat Sheet\n\n#### 1. Binary Search (Left-Closed, Right-Open)\n\`\`\`python\ndef binary_search(nums: list[int], target: int) -> int:\n    left, right = 0, len(nums)\n    while left < right:\n        mid = left + (right - left) // 2\n        if nums[mid] >= target:\n            right = mid\n        else:\n            left = mid + 1\n    return left\n\`\`\`\n\n#### 2. Sliding Window (Dynamic Expansion & Contraction)\n\`\`\`python\ndef sliding_window(s: str, k: int) -> int:\n    counts = {}\n    left = max_len = 0\n    for right, ch in enumerate(s):\n        counts[ch] = counts.get(ch, 0) + 1\n        while len(counts) > k:\n            counts[s[left]] -= 1\n            if counts[s[left]] == 0:\n                del counts[s[left]]\n            left += 1\n        max_len = max(max_len, right - left + 1)\n    return max_len\n\`\`\`\n`
                        )
                      }
                      title="Insert Algorithm Cheat Sheet (Binary Search & Sliding Window)"
                      style={{
                        padding: '2px 6px',
                        fontSize: 'var(--font-size-2xs)',
                        fontWeight: 600,
                        borderRadius: '4px',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        background: 'rgba(245, 158, 11, 0.15)',
                        color: '#fcd34d',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      📑 Cheat Sheet
                    </button>
                  </div>

                  {/* Fluid Textarea */}
                  <textarea
                    id="diary-content-textarea"
                    value={localContent}
                    onChange={handleContentChange}
                    onBlur={handleBlur}
                    placeholder="Write your problem notes, approach, complexity, code snippets, dry runs, and checklists..."
                    style={{
                      flex: 1,
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      padding: '12px',
                      color: 'var(--text-primary)',
                      fontSize: 'var(--font-size-md)',
                      fontFamily: 'var(--font-mono)',
                      lineHeight: '1.6',
                      resize: 'none',
                      outline: 'none',
                    }}
                  />
                </div>
              )}

              {/* Whiteboard Sketchpad Pane */}
              {(entryMode === 'whiteboard' || entryMode === 'split') && (
                <div
                  style={{
                    flex: entryMode === 'split' ? '1 1 50%' : '1 1 100%',
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    position: 'relative',
                  }}
                >
                  <DiaryWhiteboardCanvas
                    whiteboardData={activeEntry.whiteboard}
                    onChange={handleWhiteboardChange}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--text-muted)' }}>
            <BookOpen size={28} color="var(--text-dim)" />
            <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 600 }}>This notebook is currently empty</div>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleCreateNewEntry} style={{ fontSize: 'var(--font-size-sm)' }}>
              <Plus size={12} style={{ marginRight: '4px' }} />
              <span>Write First Page</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
