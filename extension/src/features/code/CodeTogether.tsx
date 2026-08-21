// ─── Code Together: Live Collaborative P2P Code Editor ───

import React, { useState, useEffect, useRef } from 'react';
import { CodeService } from './code.service';
import { CodeLanguage, CodeSessionState } from './code.types';
import { Play, Copy, Check, RotateCcw, Terminal, Code2, Users, ChevronDown, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { OwnedTimeouts } from '@/shared/owned-timeouts';

interface CodeTogetherProps {
  currentRoomId: string;
  isCompact?: boolean;
}

const LANGUAGE_LABELS: Record<CodeLanguage, { name: string; icon: string; ext: string }> = {
  python: { name: 'Python 3', icon: '🐍', ext: '.py' },
  cpp: { name: 'C++ 20', icon: '⚡', ext: '.cpp' },
  java: { name: 'Java 21', icon: '☕', ext: '.java' },
  javascript: { name: 'JavaScript (Node)', icon: '💛', ext: '.js' },
  typescript: { name: 'TypeScript', icon: '💙', ext: '.ts' },
  go: { name: 'Go 1.23', icon: '🐹', ext: '.go' },
  rust: { name: 'Rust', icon: '🦀', ext: '.rs' },
  sql: { name: 'PostgreSQL', icon: '🐘', ext: '.sql' },
};

export const CodeTogether: React.FC<CodeTogetherProps> = ({ currentRoomId, isCompact = false }) => {
  const codeService = CodeService.getInstance();
  const [session, setSession] = useState<CodeSessionState>(codeService.getState());
  const [copied, setCopied] = useState(false);
  const [showConsole, setShowConsole] = useState(true);
  // Whether THIS tab has a real page editor (Monaco / CodeMirror / textarea) attached.
  // When it does, that editor is the collaboration surface and this panel is a mirror.
  const [pageEditorAttached, setPageEditorAttached] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const timeoutsRef = useRef<OwnedTimeouts | null>(null);
  if (timeoutsRef.current === null) timeoutsRef.current = new OwnedTimeouts();
  const timeouts = timeoutsRef.current;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      timeouts.clearAll();
      copiedTimerRef.current = null;
    };
  }, [timeouts]);

  useEffect(() => {
    const unsub = codeService.onStateChange((state) => {
      setSession(state);
    });
    return () => unsub();
  }, []);

  // Ask the active tab whether an editor is hooked. The in-page bridge attaches to the
  // page's own editor, which is where collaborative typing actually happens.
  useEffect(() => {
    let cancelled = false;
    const probe = () => {
      if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const id = tabs?.[0]?.id;
        if (!id) return;
        chrome.tabs.sendMessage(id, { type: 'CODE_EDITOR_PROBE' }, (resp) => {
          // lastError is expected on tabs with no content script; treat as "not attached".
          const err = chrome.runtime.lastError;
          if (!cancelled) setPageEditorAttached(!err && !!resp?.attached);
        });
      });
    };
    probe();
    const t = setInterval(probe, 4000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newCode = e.target.value;
    const cursorPos = e.target.selectionStart;
    const lines = newCode.substring(0, cursorPos).split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length;

    codeService.updateCode(newCode, line, col);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enable Tab indentation (2 spaces)
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const val = e.currentTarget.value;
      const newCode = val.substring(0, start) + '  ' + val.substring(end);

      codeService.updateCode(newCode);

      // Restore cursor after state updates
      timeouts.schedule(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = start + 2;
          textareaRef.current.selectionEnd = start + 2;
        }
      }, 0);
    }
  };

  const handleCursorMove = () => {
    if (textareaRef.current) {
      const pos = textareaRef.current.selectionStart;
      const lines = textareaRef.current.value.substring(0, pos).split('\n');
      codeService.updateMyCursor(lines.length, lines[lines.length - 1].length);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(session.code);
      if (!mountedRef.current) return;
      setCopied(true);
      copiedTimerRef.current = timeouts.replace(copiedTimerRef.current, () => {
        copiedTimerRef.current = null;
        setCopied(false);
      }, 2000);
    } catch {}
  };

  const handleRun = async () => {
    setShowConsole(true);
    await codeService.runCode();
  };

  const lineCount = Math.max(1, session.code.split('\n').length);
  const linesArray = Array.from({ length: lineCount }, (_, i) => i + 1);

  return (
    <div className="flex flex-col h-full bg-[#0a0e17] text-slate-100 font-sans select-none overflow-hidden border border-slate-800/80 rounded-xl shadow-2xl">
      {/* ── Header / Controls Bar ── */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#101726] border-b border-slate-800/80 text-xs gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded-md text-blue-400 font-semibold">
            <Code2 className="w-3.5 h-3.5" />
            <span>Code Together</span>
          </div>

          {/* Language Selector */}
          <div className="relative">
            <select
              value={session.language}
              onChange={(e) => codeService.setLanguage(e.target.value as CodeLanguage)}
              className="appearance-none bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium pl-2.5 pr-7 py-1 rounded-md border border-slate-700 focus:outline-none focus:border-blue-500 cursor-pointer transition-colors"
            >
              {Object.entries(LANGUAGE_LABELS).map(([lang, { name, icon }]) => (
                <option key={lang} value={lang}>
                  {icon} {name}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Reset Template */}
          <button
            onClick={() => codeService.setLanguage(session.language, true)}
            title="Reset Starter Template"
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5">
          {/* Active Co-coders badges */}
          {session.activeCursors.length > 0 && (
            <div className="flex items-center gap-1 bg-slate-800/80 px-2 py-0.5 rounded-full border border-slate-700">
              <Users className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] text-slate-300 font-mono">
                {session.activeCursors.length} typing
              </span>
            </div>
          )}

          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition-colors font-medium text-[11px]"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            onClick={handleRun}
            disabled={session.isRunning}
            className={`flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold rounded-md shadow-sm transition-all text-xs ${
              session.isRunning ? 'opacity-75 cursor-not-allowed animate-pulse' : 'hover:scale-[1.02]'
            }`}
          >
            <Play className={`w-3.5 h-3.5 fill-current ${session.isRunning ? 'animate-spin' : ''}`} />
            <span>{session.isRunning ? 'Running...' : 'Run'}</span>
          </button>
        </div>
      </div>

      {/* ── Active Cursors Bar (Multi-Peer Collaboration) ── */}
      {session.activeCursors.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1 bg-slate-900/60 border-b border-slate-800/50 text-[10px] text-slate-400 overflow-x-auto shrink-0">
          <span>Active Editors:</span>
          {session.activeCursors.map((c) => (
            <span
              key={c.peerId}
              style={{ backgroundColor: `${c.color}20`, borderColor: c.color, color: c.color }}
              className="px-1.5 py-0.5 rounded border text-[10px] font-medium flex items-center gap-1"
            >
              <span className="w-1.5 h-1.5 rounded-full animate-ping" style={{ backgroundColor: c.color }} />
              {c.nickname} (Ln {c.line})
            </span>
          ))}
        </div>
      )}

      {/* ── Main Code Editor Surface ── */}
      <div
        className="flex-1 flex overflow-hidden relative font-mono text-[13px] leading-relaxed"
        style={{ background: 'var(--bg-app)' }}
      >
        {/* Line Numbers */}
        <div
          ref={lineNumbersRef}
          className="w-10 select-none text-right pr-2.5 pt-3 shrink-0 font-mono text-[11px] overflow-hidden"
          style={{
            background: 'var(--bg-surface)',
            color: 'var(--text-muted)',
            borderRight: '1px solid var(--border-subtle)',
          }}
        >
          {linesArray.map((line) => (
            <div key={line} className="h-5">
              {line}
            </div>
          ))}
        </div>

        {/* The page's own editor is the collaboration surface. This panel is a mirror and a
            fallback, not a rival document — editing here also writes back into the page
            editor so the two can never disagree about the same code. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 8px',
            fontSize: 'var(--font-size-xs)',
            borderBottom: '1px solid var(--border-subtle)',
            background: pageEditorAttached ? 'rgba(16,185,129,0.10)' : 'rgba(255,255,255,0.03)',
            color: pageEditorAttached ? '#6ee7b7' : 'var(--text-muted)',
          }}
        >
          <span
            className={pageEditorAttached ? 'status-dot pulse' : 'status-dot'}
            style={{ background: pageEditorAttached ? '#10b981' : 'var(--text-dim)' }}
            aria-hidden={true}
          />
          <span>
            {pageEditorAttached
              ? 'Synced with this page’s editor — type directly in the problem and your buddy sees it live.'
              : 'No code editor detected on this tab. Open a problem page to code together in it, or use the box below.'}
          </span>
        </div>

        {/* Textarea Code Input */}
        <div className="flex-1 relative h-full">
          <textarea
            ref={textareaRef}
            value={session.code}
            onChange={handleCodeChange}
            onKeyDown={handleKeyDown}
            onKeyUp={handleCursorMove}
            onClick={handleCursorMove}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            className="w-full h-full p-3 bg-transparent resize-none focus:outline-none font-mono text-[13px] leading-5 whitespace-pre overflow-auto scrollbar-thin scrollbar-thumb-slate-700"
            style={{ color: 'var(--text-primary)' }}
            placeholder="// Type code here or collaborate with room peers..."
          />
        </div>
      </div>

      {/* ── Console / Execution Result Drawer ── */}
      {showConsole && session.lastResult && (
        <div
          className="flex flex-col shrink-0 max-h-44 transition-all"
          style={{
            background: 'var(--bg-surface)',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-1.5 text-[11px]"
            style={{
              background: 'var(--bg-surface-elevated)',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Terminal Output</span>
              {session.lastResult.status === 'success' ? (
                <span className="flex items-center gap-1 font-medium" style={{ color: 'var(--accent-emerald, #10b981)' }}>
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Success</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 font-medium" style={{ color: 'var(--accent-rose, #ef4444)' }}>
                  <AlertCircle className="w-3 h-3" />
                  <span>Error</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {session.lastResult.executionTimeMs}ms
              </span>
              <button
                onClick={() => setShowConsole(false)}
                style={{ color: 'var(--text-muted)' }}
              >
                ✕
              </button>
            </div>
          </div>

          <div className="p-2.5 overflow-auto font-mono text-[11px] leading-relaxed select-text">
            {session.lastResult.stdout && (
              <pre className="whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{session.lastResult.stdout}</pre>
            )}
            {session.lastResult.stderr && (
              <pre className="whitespace-pre-wrap mt-1" style={{ color: 'var(--accent-rose, #ef4444)' }}>{session.lastResult.stderr}</pre>
            )}
          </div>
        </div>
      )}

      {/* ── Footer Status Bar ── */}
      <div
        className="flex items-center justify-between px-3 py-1 text-[10px] font-mono shrink-0"
        style={{
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-subtle)',
          color: 'var(--text-muted)',
        }}
      >
        <div className="flex items-center gap-3">
          <span>{LANGUAGE_LABELS[session.language].name}</span>
          <span>{lineCount} lines</span>
          <span>UTF-8</span>
        </div>
        <div>
          {session.lastEditedBy ? (
            <span>Last edited by {session.lastEditedBy}</span>
          ) : (
            <span>Ready to code</span>
          )}
        </div>
      </div>
    </div>
  );
};
