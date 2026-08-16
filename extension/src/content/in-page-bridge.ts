// ─── Synqto In-Page Editor Bridge (Runs in MAIN World context) ───
// This script runs directly in the webpage context to access window.monaco / window.CodeMirror
// without violating page Content Security Policies (CSP).

(() => {
  if (typeof window === 'undefined') return;
  if ((window as any).__SYNQTO_BRIDGE_ACTIVE__) return;
  (window as any).__SYNQTO_BRIDGE_ACTIVE__ = true;

  if (document.documentElement) {
    document.documentElement.setAttribute('data-synqto-bridge', 'active');
  }

  let activeEditorType: 'monaco' | 'codemirror' | 'textarea' | null = null;
  let monacoEditorInstance: any = null;
  let monacoModelInstance: any = null;
  let codeMirrorInstance: any = null;
  let isApplyingRemote = false;
  let peerDecorations: Record<string, string[]> = {};
  let debounceTimer: any = null;
  let cursorDebounceTimer: any = null;

  // 1. Inject styling for remote cursor bars and floating name tags
  if (!document.getElementById('synqto-editor-sync-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'synqto-editor-sync-styles';
    styleEl.textContent = `
      .synqto-remote-cursor-line {
        position: relative !important;
        border-left-width: 2.5px !important;
        border-left-style: solid !important;
        box-shadow: 0 0 8px currentColor !important;
        animation: synqtoCursorBlink 1.1s ease-in-out infinite !important;
      }
      .synqto-remote-badge {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace !important;
        font-size: 10px !important;
        font-weight: 700 !important;
        padding: 1px 6px !important;
        border-radius: 4px !important;
        color: #ffffff !important;
        display: inline-block !important;
        margin-left: 6px !important;
        vertical-align: middle !important;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4) !important;
        pointer-events: none !important;
        user-select: none !important;
        z-index: 10 !important;
      }
      @keyframes synqtoCursorBlink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.35; }
      }
    `;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  // 2. Discover Monaco Editor (LeetCode, HackerRank modern UI)
  const hookMonaco = () => {
    const monaco = (window as any).monaco;
    if (!monaco || !monaco.editor) return false;

    const editors = monaco.editor.getEditors?.() || [];
    const models = monaco.editor.getModels?.() || [];

    if (editors.length > 0) {
      monacoEditorInstance = editors[0];
      monacoModelInstance = monacoEditorInstance.getModel() || (models.length > 0 ? models[0] : null);
    } else if (models.length > 0) {
      monacoModelInstance = models[0];
    }

    if (monacoModelInstance) {
      activeEditorType = 'monaco';

      // Listen for content changes in Monaco
      monacoModelInstance.onDidChangeContent(() => {
        if (isApplyingRemote) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const currentCode = monacoModelInstance.getValue();
          const pos = monacoEditorInstance ? monacoEditorInstance.getPosition() : { lineNumber: 1, column: 1 };
          const lang = monacoModelInstance.getLanguageId?.() || 'python';

          window.postMessage({
            source: 'SYNQTO_EDITOR_BRIDGE',
            type: 'LOCAL_CODE_CHANGED',
            payload: {
              code: currentCode,
              line: pos?.lineNumber || 1,
              col: pos?.column || 1,
              language: lang,
            },
          }, '*');
        }, 40);
      });

      // Listen for cursor moves in Monaco
      if (monacoEditorInstance) {
        monacoEditorInstance.onDidChangeCursorPosition((e: any) => {
          if (isApplyingRemote) return;
          clearTimeout(cursorDebounceTimer);
          cursorDebounceTimer = setTimeout(() => {
            const pos = e.position;
            window.postMessage({
              source: 'SYNQTO_EDITOR_BRIDGE',
              type: 'LOCAL_CURSOR_MOVED',
              payload: {
                line: pos.lineNumber,
                ch: pos.column,
              },
            }, '*');
          }, 80);
        });
      }

      console.log('[Synqto] Hooked into LeetCode Monaco Editor successfully in main world!');
      return true;
    }
    return false;
  };

  // 3. Discover CodeMirror (GeeksforGeeks, Classic HackerRank)
  const hookCodeMirror = () => {
    const cmEl = document.querySelector('.CodeMirror') as any;
    if (cmEl && cmEl.CodeMirror) {
      codeMirrorInstance = cmEl.CodeMirror;
      activeEditorType = 'codemirror';

      codeMirrorInstance.on('change', (_cm: any, changeObj: any) => {
        if (isApplyingRemote || changeObj.origin === 'setValue') return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const code = codeMirrorInstance.getValue();
          const cur = codeMirrorInstance.getCursor();
          window.postMessage({
            source: 'SYNQTO_EDITOR_BRIDGE',
            type: 'LOCAL_CODE_CHANGED',
            payload: {
              code,
              line: (cur?.line || 0) + 1,
              col: (cur?.ch || 0) + 1,
              language: 'python',
            },
          }, '*');
        }, 40);
      });

      codeMirrorInstance.on('cursorActivity', () => {
        if (isApplyingRemote) return;
        clearTimeout(cursorDebounceTimer);
        cursorDebounceTimer = setTimeout(() => {
          const cur = codeMirrorInstance.getCursor();
          window.postMessage({
            source: 'SYNQTO_EDITOR_BRIDGE',
            type: 'LOCAL_CURSOR_MOVED',
            payload: {
              line: (cur?.line || 0) + 1,
              col: (cur?.ch || 0) + 1,
            },
          }, '*');
        }, 80);
      });

      console.log('[Synqto] Hooked into CodeMirror Editor successfully in main world!');
      return true;
    }
    return false;
  };

  // Polling loop to find active editor as DOM loads
  const pollInterval = setInterval(() => {
    if (hookMonaco() || hookCodeMirror()) {
      clearInterval(pollInterval);
    }
  }, 600);

  // Stop polling after 30 seconds
  setTimeout(() => clearInterval(pollInterval), 30000);

  // 4. Handle incoming messages from Content Script
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== 'SYNQTO_CONTENT_SCRIPT') return;

    const { type, payload } = event.data;

    if (type === 'APPLY_REMOTE_CODE') {
      const { code } = payload;

      if (activeEditorType === 'monaco' && monacoModelInstance) {
        const currentVal = monacoModelInstance.getValue();
        if (currentVal !== code) {
          isApplyingRemote = true;
          try {
            monacoModelInstance.setValue(code);
          } finally {
            isApplyingRemote = false;
          }
        }
      } else if (activeEditorType === 'codemirror' && codeMirrorInstance) {
        const currentVal = codeMirrorInstance.getValue();
        if (currentVal !== code) {
          isApplyingRemote = true;
          try {
            codeMirrorInstance.setValue(code);
          } finally {
            isApplyingRemote = false;
          }
        }
      }
    } else if (type === 'APPLY_REMOTE_CURSOR') {
      const { peerId, nickname, color, line, ch } = payload;

      if (activeEditorType === 'monaco' && monacoEditorInstance) {
        const monaco = (window as any).monaco;
        if (!monaco) return;

        // Inject custom dynamic CSS for this peer's cursor color
        const customStyleId = `synqto-peer-style-${peerId}`;
        let peerStyle = document.getElementById(customStyleId);
        if (!peerStyle) {
          peerStyle = document.createElement('style');
          peerStyle.id = customStyleId;
          document.head.appendChild(peerStyle);
        }
        peerStyle.textContent = `
          .synqto-cursor-${peerId} {
            border-left: 2.5px solid ${color || '#3b82f6'} !important;
            box-shadow: 0 0 6px ${color || '#3b82f6'} !important;
          }
          .synqto-badge-${peerId} {
            background: ${color || '#3b82f6'} !important;
          }
        `;

        const targetLine = Math.max(1, line || 1);
        const targetCol = Math.max(1, ch || 1);

        const decoration = {
          range: new monaco.Range(targetLine, targetCol, targetLine, targetCol),
          options: {
            className: `synqto-remote-cursor-line synqto-cursor-${peerId}`,
            after: {
              content: ` ✍️ ${nickname || 'Peer'}`,
              inlineClassName: `synqto-remote-badge synqto-badge-${peerId}`,
            },
          },
        };

        const oldDecs = peerDecorations[peerId] || [];
        peerDecorations[peerId] = monacoEditorInstance.deltaDecorations(oldDecs, [decoration]);
      }
    } else if (type === 'REMOVE_PEER_CURSOR') {
      const { peerId } = payload;
      if (activeEditorType === 'monaco' && monacoEditorInstance) {
        const oldDecs = peerDecorations[peerId] || [];
        if (oldDecs.length > 0) {
          monacoEditorInstance.deltaDecorations(oldDecs, []);
          delete peerDecorations[peerId];
        }
      }
    }
  });

  console.log('[Synqto] In-page editor bridge initialized in MAIN world.');
})();
