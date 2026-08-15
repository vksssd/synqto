// ─── Synqto Personal Diary Service (Local Storage Persistence & Multi-Journal Management) ───

import { DiaryBook, DiaryEntry, DiaryMood, DiaryState, DEFAULT_DIARIES } from './diary.types';
import { uuid } from '@/shared/utils';

const STORAGE_KEY = 'synqto_diaries_v1';

export class DiaryService {
  private static instance: DiaryService | null = null;

  private state: DiaryState = {
    activeDiaryId: 'diary-problem-log',
    activeEntryId: 'entry-welcome',
    diaries: DEFAULT_DIARIES,
  };

  private listeners: Set<(state: DiaryState) => void> = new Set();

  private constructor() {
    this.loadFromStorage();
  }

  public static getInstance(): DiaryService {
    if (!DiaryService.instance) {
      DiaryService.instance = new DiaryService();
    }
    return DiaryService.instance;
  }

  private async loadFromStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const res = await chrome.storage.local.get([STORAGE_KEY]);
        if (res[STORAGE_KEY] && Array.isArray(res[STORAGE_KEY].diaries) && res[STORAGE_KEY].diaries.length > 0) {
          this.state = res[STORAGE_KEY];
          this.notify();
        }
      } catch (e) {}
    } else if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          this.state = JSON.parse(saved);
          this.notify();
        }
      } catch (e) {}
    }
  }

  private saveToStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        chrome.storage.local.set({ [STORAGE_KEY]: this.state });
      } catch (e) {}
    } else if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (e) {}
    }
  }

  public getState(): DiaryState {
    return { ...this.state };
  }

  public getDiaries(): DiaryBook[] {
    return this.state.diaries;
  }

  public getActiveDiary(): DiaryBook {
    const d = this.state.diaries.find((item) => item.id === this.state.activeDiaryId);
    return d || this.state.diaries[0];
  }

  public getActiveEntry(): DiaryEntry | null {
    const diary = this.getActiveDiary();
    if (!this.state.activeEntryId) {
      return diary.entries[0] || null;
    }
    return diary.entries.find((e) => e.id === this.state.activeEntryId) || diary.entries[0] || null;
  }

  public setActiveDiary(diaryId: string) {
    if (this.state.diaries.some((d) => d.id === diaryId)) {
      this.state.activeDiaryId = diaryId;
      const diary = this.state.diaries.find((d) => d.id === diaryId);
      this.state.activeEntryId = diary?.entries[0]?.id || null;
      this.saveToStorage();
      this.notify();
    }
  }

  public setActiveEntry(entryId: string | null) {
    this.state.activeEntryId = entryId;
    this.saveToStorage();
    this.notify();
  }

  public createDiary(title: string, icon = '📓', color = '#6366f1', description = ''): DiaryBook {
    const newDiary: DiaryBook = {
      id: `diary-${uuid()}`,
      title: title.trim() || 'New Journal',
      icon,
      color,
      description,
      entries: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.state.diaries.push(newDiary);
    this.state.activeDiaryId = newDiary.id;
    this.state.activeEntryId = null;
    this.saveToStorage();
    this.notify();
    return newDiary;
  }

  public renameDiary(diaryId: string, title: string, icon?: string, color?: string) {
    const diary = this.state.diaries.find((d) => d.id === diaryId);
    if (diary) {
      if (title.trim()) diary.title = title.trim();
      if (icon) diary.icon = icon;
      if (color) diary.color = color;
      diary.updatedAt = Date.now();
      this.saveToStorage();
      this.notify();
    }
  }

  public deleteDiary(diaryId: string) {
    if (this.state.diaries.length <= 1) return; // Keep at least 1 diary
    this.state.diaries = this.state.diaries.filter((d) => d.id !== diaryId);
    if (this.state.activeDiaryId === diaryId) {
      this.state.activeDiaryId = this.state.diaries[0].id;
      this.state.activeEntryId = this.state.diaries[0].entries[0]?.id || null;
    }
    this.saveToStorage();
    this.notify();
  }

  public createEntry(
    diaryId: string,
    title = '',
    content = '',
    problemTitle?: string,
    problemUrl?: string,
    tags: string[] = [],
    mood: DiaryMood = 'productive'
  ): DiaryEntry {
    const diary = this.state.diaries.find((d) => d.id === diaryId) || this.getActiveDiary();
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const newEntry: DiaryEntry = {
      id: `entry-${uuid()}`,
      title: title.trim() || `Entry: ${dateStr}`,
      content: content || `### 📝 Notes for ${dateStr}\n\n- \n`,
      problemTitle,
      problemUrl,
      tags: tags.length > 0 ? tags : ['#coding', '#notes'],
      mood,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    diary.entries.unshift(newEntry);
    diary.updatedAt = Date.now();
    this.state.activeDiaryId = diary.id;
    this.state.activeEntryId = newEntry.id;

    this.saveToStorage();
    this.notify();
    return newEntry;
  }

  public updateEntry(diaryId: string, entryId: string, updates: Partial<DiaryEntry>) {
    const diary = this.state.diaries.find((d) => d.id === diaryId);
    if (!diary) return;

    const entry = diary.entries.find((e) => e.id === entryId);
    if (entry) {
      Object.assign(entry, updates, { updatedAt: Date.now() });
      diary.updatedAt = Date.now();
      this.saveToStorage();
      this.notify();
    }
  }

  public deleteEntry(diaryId: string, entryId: string) {
    const diary = this.state.diaries.find((d) => d.id === diaryId);
    if (!diary) return;

    diary.entries = diary.entries.filter((e) => e.id !== entryId);
    diary.updatedAt = Date.now();
    if (this.state.activeEntryId === entryId) {
      this.state.activeEntryId = diary.entries[0]?.id || null;
    }
    this.saveToStorage();
    this.notify();
  }

  public exportDiaryMarkdown(diaryId: string): string {
    const diary = this.state.diaries.find((d) => d.id === diaryId) || this.getActiveDiary();
    let md = `# ${diary.icon} ${diary.title}\n\n`;
    if (diary.description) md += `*${diary.description}*\n\n---\n\n`;

    diary.entries.forEach((e) => {
      const date = new Date(e.createdAt).toLocaleString();
      md += `## ${e.title}\n*Date: ${date}* | *Mood: ${e.mood}*\n`;
      if (e.problemTitle) md += `*Problem: [${e.problemTitle}](${e.problemUrl || '#'})*\n`;
      if (e.tags.length > 0) md += `*Tags: ${e.tags.join(' ')}*\n\n`;
      md += `${e.content}\n\n---\n\n`;
    });

    return md;
  }

  /**
   * Generates a styled, print-optimized HTML document for instant PDF export
   */
  public exportDiaryPdf(diaryId: string, entryId?: string) {
    const diary = this.state.diaries.find((d) => d.id === diaryId) || this.getActiveDiary();
    const entriesToExport = entryId
      ? diary.entries.filter((e) => e.id === entryId)
      : diary.entries;

    const printWin = window.open('', '_blank', 'width=850,height=900');
    if (!printWin) {
      alert('Please allow popups to export diary as PDF.');
      return;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${diary.title} — Synqto Diary PDF</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #0f172a;
      background: #ffffff;
      padding: 40px;
      line-height: 1.6;
    }
    .header {
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .brand-tag {
      font-size: 11px;
      font-weight: 700;
      color: #6366f1;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 4px;
    }
    .title {
      font-size: 26px;
      font-weight: 800;
      color: #0f172a;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .desc {
      font-size: 13px;
      color: #64748b;
      margin-top: 4px;
    }
    .entry-card {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 28px;
      page-break-inside: avoid;
      background: #f8fafc;
    }
    .entry-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 10px;
    }
    .entry-title {
      font-size: 18px;
      font-weight: 700;
      color: #1e293b;
    }
    .entry-date {
      font-size: 12px;
      color: #64748b;
      font-weight: 500;
    }
    .entry-meta {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 14px;
      flex-wrap: wrap;
    }
    .mood-tag {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 12px;
      background: #e0e7ff;
      color: #4338ca;
    }
    .prob-link {
      font-size: 11px;
      color: #0284c7;
      text-decoration: none;
      font-weight: 600;
    }
    .tags {
      display: flex;
      gap: 4px;
    }
    .tag {
      font-size: 10px;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      color: #475569;
      padding: 1px 6px;
      border-radius: 4px;
    }
    .entry-body {
      font-size: 13px;
      color: #334155;
      white-space: pre-wrap;
      font-family: inherit;
    }
    code, pre {
      font-family: 'JetBrains Mono', monospace;
      background: #0f172a;
      color: #f8fafc;
      padding: 12px;
      border-radius: 6px;
      display: block;
      overflow-x: auto;
      font-size: 12px;
      margin: 10px 0;
      line-height: 1.5;
    }
    .footer {
      text-align: center;
      font-size: 11px;
      color: #94a3b8;
      margin-top: 40px;
      border-top: 1px solid #e2e8f0;
      padding-top: 14px;
    }
    @media print {
      body { padding: 15mm; }
      .no-print { display: none; }
      .entry-card { break-inside: avoid; border-color: #cbd5e1; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand-tag">Synqto Personal Coding Journal</div>
    <div class="title">${diary.icon} ${diary.title}</div>
    ${diary.description ? `<div class="desc">${diary.description}</div>` : ''}
  </div>

  ${entriesToExport
    .map(
      (e) => `
    <div class="entry-card">
      <div class="entry-header">
        <div class="entry-title">${e.title}</div>
        <div class="entry-date">${new Date(e.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
      </div>
      <div class="entry-meta">
        <span class="mood-tag">Mood: ${e.mood}</span>
        ${e.problemTitle ? `<span class="prob-link">Problem: ${e.problemTitle}</span>` : ''}
        ${e.tags.map((t) => `<span class="tag">${t}</span>`).join(' ')}
      </div>
      <div class="entry-body">${e.content}</div>
    </div>
  `
    )
    .join('')}

  <div class="footer">
    Exported securely from Synqto Chrome Extension • Local Storage Offline Journal
  </div>

  <script>
    window.onload = () => {
      setTimeout(() => {
        window.print();
      }, 400);
    };
  </script>
</body>
</html>`;

    printWin.document.write(html);
    printWin.document.close();
  }

  public onStateChange(listener: (state: DiaryState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const copy = this.getState();
    this.listeners.forEach((fn) => fn(copy));
  }
}
