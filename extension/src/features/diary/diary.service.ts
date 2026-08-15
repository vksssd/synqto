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

  public exportEntryMarkdown(entry: DiaryEntry): void {
    const date = new Date(entry.createdAt).toLocaleString();
    let md = `# 📓 ${entry.title}\n\n`;
    md += `*Date: ${date}* | *Mood: ${entry.mood}*\n`;
    if (entry.problemTitle) md += `*Problem: [${entry.problemTitle}](${entry.problemUrl || '#'})*\n`;
    if (entry.tags.length > 0) md += `*Tags: ${entry.tags.map((t) => `#${t}`).join(' ')}*\n\n`;
    md += `---\n\n${entry.content}\n`;

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `${(entry.title || 'diary-page').toLowerCase().replace(/\s+/g, '-')}.md`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
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

  private escapeHtml(text: string): string {
    return (text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private renderMarkdownToHtml(mdText: string): string {
    if (!mdText) return '';
    let html = mdText;

    // Code blocks ```...```
    html = html.replace(/```([a-z0-9_-]*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
      return `<pre><code>${this.escapeHtml(code.trim())}</code></pre>`;
    });

    // Inline code `...`
    html = html.replace(/`([^`]+)`/g, (_match, code) => {
      return `<code>${this.escapeHtml(code)}</code>`;
    });

    // Checkboxes
    html = html.replace(/^- \[ \] (.*)$/gm, '<div style="display:flex;align-items:center;gap:6px;margin:3px 0;"><input type="checkbox" disabled style="margin:0;" /> <span>$1</span></div>');
    html = html.replace(/^- \[x\] (.*)$/gm, '<div style="display:flex;align-items:center;gap:6px;margin:3px 0;"><input type="checkbox" checked disabled style="margin:0;" /> <span style="text-decoration:line-through;color:#94a3b8;">$1</span></div>');

    // Headers
    html = html.replace(/^### (.*$)/gm, '<h3 style="font-size:15px;font-weight:700;margin:14px 0 6px;color:#1e293b;">$1</h3>');
    html = html.replace(/^## (.*$)/gm, '<h2 style="font-size:17px;font-weight:700;margin:18px 0 8px;color:#0f172a;">$1</h2>');
    html = html.replace(/^# (.*$)/gm, '<h1 style="font-size:20px;font-weight:800;margin:20px 0 10px;color:#0f172a;">$1</h1>');

    // Bold & Italic
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Unordered lists
    html = html.replace(/^- (.*$)/gm, '<li style="margin-left:18px;margin-bottom:3px;">$1</li>');

    // Line breaks
    html = html.replace(/\n\n/g, '<p style="margin:8px 0;"></p>');
    html = html.replace(/\n/g, '<br/>');

    return html;
  }

  private renderWhiteboardToDataUrl(wbData?: { strokes: any[]; bgColor?: string }): string | null {
    if (!wbData || !Array.isArray(wbData.strokes) || wbData.strokes.length === 0) {
      return null;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 420;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      // Fill background
      ctx.fillStyle = wbData.bgColor || '#090d16';
      ctx.fillRect(0, 0, 800, 420);

      // Draw subtle grid dots
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      for (let x = 20; x < 800; x += 20) {
        for (let y = 20; y < 420; y += 20) {
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Render strokes
      wbData.strokes.forEach((stroke: any) => {
        if (!stroke) return;
        ctx.save();
        ctx.strokeStyle = stroke.color || '#6366f1';
        ctx.fillStyle = stroke.color || '#6366f1';
        ctx.lineWidth = stroke.width || 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (stroke.tool === 'highlighter') {
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = Math.max(12, stroke.width || 16);
        }

        if (stroke.points && stroke.points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
          for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
          }
          ctx.stroke();
        } else {
          const geom = stroke.geometry || (stroke.start && stroke.end ? {
            x1: stroke.start.x,
            y1: stroke.start.y,
            x2: stroke.end.x,
            y2: stroke.end.y,
          } : null);

          if (geom) {
            const { x1, y1, x2, y2 } = geom;
            const minX = Math.min(x1, x2);
            const minY = Math.min(y1, y2);
            const w = Math.abs(x2 - x1);
            const h = Math.abs(y2 - y1);

            if (stroke.tool === 'line' || stroke.tool === 'arrow') {
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
              ctx.stroke();
              if (stroke.tool === 'arrow') {
                const angle = Math.atan2(y2 - y1, x2 - x1);
                const headLen = 12;
                ctx.beginPath();
                ctx.moveTo(x2, y2);
                ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
                ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
                ctx.closePath();
                ctx.fill();
              }
            } else if (stroke.tool === 'rect') {
              ctx.strokeRect(minX, minY, w, h);
            } else if (stroke.tool === 'circle') {
              ctx.beginPath();
              ctx.ellipse(minX + w / 2, minY + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
              ctx.stroke();
            } else if (stroke.tool === 'tree_node') {
              const cx = (x1 + x2) / 2;
              const cy = (y1 + y2) / 2;
              const r = Math.max(14, Math.hypot(x2 - x1, y2 - y1) / 2);
              ctx.beginPath();
              ctx.arc(cx, cy, r, 0, Math.PI * 2);
              ctx.stroke();
              if (stroke.text) {
                ctx.font = 'bold 13px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(stroke.text, cx, cy);
              }
            }
          } else if (stroke.text && (stroke.geometry || stroke.start)) {
            const tx = stroke.geometry ? stroke.geometry.x1 : stroke.start.x;
            const ty = stroke.geometry ? stroke.geometry.y1 : stroke.start.y;
            ctx.font = '14px Inter, sans-serif';
            ctx.fillText(stroke.text, tx, ty);
          }
        }

        ctx.restore();
      });

      return canvas.toDataURL('image/png');
    } catch (err) {
      console.warn('[DiaryService] Failed to render whiteboard canvas for PDF export:', err);
      return null;
    }
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
      font-family: inherit;
      line-height: 1.6;
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
    .whiteboard-attachment {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px dashed #cbd5e1;
    }
    .wb-label {
      font-size: 11px;
      font-weight: 700;
      color: #6366f1;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .wb-img {
      width: 100%;
      max-height: 380px;
      object-fit: contain;
      border-radius: 6px;
      border: 1px solid #cbd5e1;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
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
    .map((e) => {
      const wbDataUrl = this.renderWhiteboardToDataUrl(e.whiteboard);
      return `
    <div class="entry-card">
      <div class="entry-header">
        <div class="entry-title">${this.escapeHtml(e.title)}</div>
        <div class="entry-date">${new Date(e.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
      </div>
      <div class="entry-meta">
        <span class="mood-tag">Mood: ${e.mood}</span>
        ${e.problemTitle ? `<span class="prob-link">Problem: ${this.escapeHtml(e.problemTitle)}</span>` : ''}
        ${e.tags.map((t) => `<span class="tag">${this.escapeHtml(t)}</span>`).join(' ')}
      </div>
      <div class="entry-body">${this.renderMarkdownToHtml(e.content)}</div>
      ${wbDataUrl ? `
        <div class="whiteboard-attachment">
          <div class="wb-label">🎨 Attached Architecture Sketch / Canvas:</div>
          <img class="wb-img" src="${wbDataUrl}" alt="Whiteboard Sketch" />
        </div>
      ` : ''}
    </div>
  `;
    })
    .join('')}

  <div class="footer">
    Exported securely from Synqto Chrome Extension • Local Storage Offline Journal
  </div>

  <script>
    window.onload = () => {
      setTimeout(() => {
        window.print();
      }, 500);
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
