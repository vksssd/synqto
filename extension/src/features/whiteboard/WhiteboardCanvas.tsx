// ─── Collaborative Whiteboard Canvas with Theme & Background Choice ───

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Pencil,
  Highlighter,
  Eraser,
  Minus,
  MoveRight,
  Square,
  Circle,
  GitBranch,
  RotateCcw,
  RotateCw,
  Trash2,
  Download,
  Grid,
  Sun,
  Moon,
  Sparkles,
} from 'lucide-react';
import { WhiteboardService } from './whiteboard.service';
import { WhiteboardToolType, WhiteboardStroke, Point } from './whiteboard.types';

export type BoardTheme = 'dark_grid' | 'clean_white' | 'dot_matrix' | 'isometric' | 'clean_dark';

const COLORS = [
  '#6366f1', // Indigo
  '#06b6d4', // Cyan
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#f43f5e', // Rose
  '#ffffff', // White
  '#0f172a', // Dark slate (for white board)
];

const PEN_SIZES = [
  { label: 'S', size: 2 },
  { label: 'M', size: 4 },
  { label: 'L', size: 8 },
];

export const WhiteboardCanvas: React.FC = () => {
  const whiteboardService = WhiteboardService.getInstance();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [activeTool, setActiveTool] = useState<WhiteboardToolType>('pen');
  const [activeColor, setActiveColor] = useState<string>('#6366f1');
  const [activeWidth, setActiveWidth] = useState<number>(4);
  const [boardTheme, setBoardTheme] = useState<BoardTheme>('dark_grid');
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [startPoint, setStartPoint] = useState<Point | null>(null);

  // Redraw all strokes and background on canvas
  const redrawCanvas = useCallback(
    (strokes: WhiteboardStroke[], previewPoints?: Point[], previewGeometry?: any) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;

      // 1. Draw Background Theme
      ctx.save();
      if (boardTheme === 'clean_white') {
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, w, h);

        // Subtle gray grid
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
        ctx.lineWidth = 1;
        const gridSize = 24;
        for (let x = 0; x < w; x += gridSize) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = 0; y < h; y += gridSize) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
      } else if (boardTheme === 'dot_matrix') {
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, w, h);

        // Dot matrix grid
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        const dotGap = 20;
        for (let x = 10; x < w; x += dotGap) {
          for (let y = 10; y < h; y += dotGap) {
            ctx.beginPath();
            ctx.arc(x, y, 1.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (boardTheme === 'isometric') {
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, w, h);

        // Array / Matrix isometric grid
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.08)';
        ctx.lineWidth = 1;
        const cell = 28;
        for (let x = 0; x < w; x += cell) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = 0; y < h; y += cell) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
      } else if (boardTheme === 'clean_dark') {
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, w, h);
      } else {
        // Default: Dark Grid
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
        const gridSize = 24;
        for (let x = 0; x < w; x += gridSize) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = 0; y < h; y += gridSize) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
      }
      ctx.restore();

      // 2. Helper to draw a single stroke
      const renderStroke = (stroke: WhiteboardStroke) => {
        ctx.save();
        let drawColor = stroke.color;
        if (boardTheme === 'clean_white' && (drawColor === '#ffffff' || drawColor === '#fff')) {
          drawColor = '#0f172a'; // Auto-invert white strokes on white board
        }

        ctx.strokeStyle = drawColor;
        ctx.fillStyle = drawColor;
        ctx.lineWidth = stroke.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = stroke.opacity;

        if (stroke.tool === 'eraser') {
          if (boardTheme === 'clean_white') {
            ctx.strokeStyle = '#f8fafc';
            ctx.fillStyle = '#f8fafc';
          } else {
            ctx.strokeStyle = '#090d16';
            ctx.fillStyle = '#090d16';
          }
          ctx.lineWidth = stroke.width * 3.5;
        }

        if (stroke.geometry) {
          const { x1, y1, x2, y2 } = stroke.geometry;

          if (stroke.tool === 'line') {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          } else if (stroke.tool === 'arrow') {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();

            const angle = Math.atan2(y2 - y1, x2 - x1);
            const headLen = Math.max(10, stroke.width * 3);
            ctx.beginPath();
            ctx.moveTo(x2, y2);
            ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(x2, y2);
            ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
            ctx.stroke();
          } else if (stroke.tool === 'rect') {
            ctx.strokeRect(
              Math.min(x1, x2),
              Math.min(y1, y2),
              Math.abs(x2 - x1),
              Math.abs(y2 - y1)
            );
          } else if (stroke.tool === 'circle') {
            const radiusX = Math.abs(x2 - x1) / 2;
            const radiusY = Math.abs(y2 - y1) / 2;
            const centerX = Math.min(x1, x2) + radiusX;
            const centerY = Math.min(y1, y2) + radiusY;
            ctx.beginPath();
            ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
            ctx.stroke();
          } else if (stroke.tool === 'tree_node') {
            const radius = Math.max(18, stroke.width * 4);
            ctx.beginPath();
            ctx.arc(x1, y1, radius, 0, Math.PI * 2);
            ctx.fillStyle = boardTheme === 'clean_white' ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = boardTheme === 'clean_white' ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 12px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(stroke.geometry.label || 'N', x1, y1);
          }
        } else if (stroke.points && stroke.points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
          for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
          }
          ctx.stroke();
        }

        ctx.restore();
      };

      strokes.forEach(renderStroke);

      if (previewGeometry) {
        renderStroke({
          id: 'preview',
          peerId: 'local',
          nickname: 'You',
          tool: activeTool,
          color: activeColor,
          width: activeTool === 'highlighter' ? 14 : activeWidth,
          opacity: activeTool === 'highlighter' ? 0.35 : 1.0,
          points: [],
          geometry: previewGeometry,
          timestamp: Date.now(),
        });
      } else if (previewPoints && previewPoints.length > 1) {
        renderStroke({
          id: 'preview',
          peerId: 'local',
          nickname: 'You',
          tool: activeTool,
          color: activeColor,
          width: activeTool === 'highlighter' ? 14 : activeWidth,
          opacity: activeTool === 'highlighter' ? 0.35 : 1.0,
          points: previewPoints,
          timestamp: Date.now(),
        });
      }
    },
    [activeTool, activeColor, activeWidth, boardTheme]
  );

  // Sync canvas size with container
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
      }

      redrawCanvas(whiteboardService.getStrokes());
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [redrawCanvas, whiteboardService]);

  // Subscribe to stroke changes
  useEffect(() => {
    return whiteboardService.onStrokesChange((strokes) => {
      redrawCanvas(strokes);
    });
  }, [redrawCanvas, whiteboardService]);

  // Pointer Event Handlers
  const getCanvasCoords = (e: React.MouseEvent | React.TouchEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    let clientX = 0;
    let clientY = 0;

    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    const pt = getCanvasCoords(e);
    setIsDrawing(true);
    setStartPoint(pt);
    setCurrentPoints([pt]);
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const pt = getCanvasCoords(e);

    const isGeometry = ['line', 'arrow', 'rect', 'circle', 'tree_node'].includes(activeTool);

    if (isGeometry && startPoint) {
      redrawCanvas(whiteboardService.getStrokes(), undefined, {
        x1: startPoint.x,
        y1: startPoint.y,
        x2: pt.x,
        y2: pt.y,
        label: activeTool === 'tree_node' ? 'val' : undefined,
      });
    } else {
      const updated = [...currentPoints, pt];
      setCurrentPoints(updated);
      redrawCanvas(whiteboardService.getStrokes(), updated);
    }
  };

  const handlePointerUp = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    setIsDrawing(false);

    const endPt = getCanvasCoords(e);
    const isGeometry = ['line', 'arrow', 'rect', 'circle', 'tree_node'].includes(activeTool);
    const strokeWidth = activeTool === 'highlighter' ? 14 : activeWidth;

    if (isGeometry && startPoint) {
      whiteboardService.addStroke(
        activeTool,
        activeColor,
        strokeWidth,
        [],
        {
          x1: startPoint.x,
          y1: startPoint.y,
          x2: endPt.x,
          y2: endPt.y,
          label: activeTool === 'tree_node' ? String(Math.floor(Math.random() * 50) + 1) : undefined,
        }
      );
    } else if (currentPoints.length > 0) {
      whiteboardService.addStroke(activeTool, activeColor, strokeWidth, currentPoints);
    }

    setCurrentPoints([]);
    setStartPoint(null);
  };

  const handleExportPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `synqto-whiteboard-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  };

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: boardTheme === 'clean_white' ? '#f8fafc' : '#090d16',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Top Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          background: 'rgba(15, 23, 42, 0.96)',
          borderBottom: '1px solid var(--border-subtle)',
          flexWrap: 'wrap',
          gap: '6px',
        }}
      >
        {/* Tool Selector Buttons */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          <button
            type="button"
            className={`btn-icon ${activeTool === 'pen' ? 'active' : ''}`}
            onClick={() => setActiveTool('pen')}
            title="Pen Tool"
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              border: activeTool === 'pen' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'pen' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'pen' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Pencil size={13} />
          </button>

          <button
            type="button"
            className={`btn-icon ${activeTool === 'highlighter' ? 'active' : ''}`}
            onClick={() => setActiveTool('highlighter')}
            title="Highlighter"
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              border: activeTool === 'highlighter' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'highlighter' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'highlighter' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Highlighter size={13} />
          </button>

          <button
            type="button"
            className={`btn-icon ${activeTool === 'eraser' ? 'active' : ''}`}
            onClick={() => setActiveTool('eraser')}
            title="Eraser"
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              border: activeTool === 'eraser' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'eraser' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'eraser' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Eraser size={13} />
          </button>

          <div style={{ width: '1px', height: '14px', background: 'var(--border-subtle)', margin: '0 2px' }} />

          {/* Shapes & Geometry */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'line' ? 'active' : ''}`}
            onClick={() => setActiveTool('line')}
            title="Straight Line"
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              border: activeTool === 'line' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'line' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'line' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Minus size={13} />
          </button>

          <button
            type="button"
            className={`btn-icon ${activeTool === 'arrow' ? 'active' : ''}`}
            onClick={() => setActiveTool('arrow')}
            title="Arrow"
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              border: activeTool === 'arrow' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'arrow' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'arrow' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <MoveRight size={13} />
          </button>

          <button
            type="button"
            className={`btn-icon ${activeTool === 'rect' ? 'active' : ''}`}
            onClick={() => setActiveTool('rect')}
            title="Rectangle / Array Box"
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              border: activeTool === 'rect' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'rect' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'rect' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Square size={13} />
          </button>

          <button
            type="button"
            className={`btn-icon ${activeTool === 'circle' ? 'active' : ''}`}
            onClick={() => setActiveTool('circle')}
            title="Circle / Node"
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              border: activeTool === 'circle' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'circle' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'circle' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Circle size={13} />
          </button>

          <button
            type="button"
            className={`btn-icon ${activeTool === 'tree_node' ? 'active' : ''}`}
            onClick={() => setActiveTool('tree_node')}
            title="Binary Tree Node"
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              border: activeTool === 'tree_node' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'tree_node' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'tree_node' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <GitBranch size={13} />
          </button>
        </div>

        {/* Action Controls: Undo, Redo, Clear, Save */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => whiteboardService.undo()}
            title="Undo (Ctrl+Z)"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '3px' }}
          >
            <RotateCcw size={12} />
          </button>

          <button
            type="button"
            onClick={() => whiteboardService.redo()}
            title="Redo"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '3px' }}
          >
            <RotateCw size={12} />
          </button>

          <button
            type="button"
            onClick={() => {
              if (confirm('Clear collaborative whiteboard canvas?')) {
                whiteboardService.clearAll();
              }
            }}
            title="Clear Canvas"
            style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '3px' }}
          >
            <Trash2 size={12} />
          </button>

          <button
            type="button"
            onClick={handleExportPNG}
            title="Download Canvas as PNG"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '3px' }}
          >
            <Download size={12} />
          </button>
        </div>
      </div>

      {/* Sub-toolbar: Background Choice Theme & Palette */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 10px',
          background: 'rgba(0, 0, 0, 0.45)',
          borderBottom: '1px solid var(--border-subtle)',
          flexWrap: 'wrap',
          gap: '6px',
        }}
      >
        {/* Whiteboard Background Choice */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>Board:</span>
          <button
            type="button"
            onClick={() => setBoardTheme('dark_grid')}
            title="Dark Grid"
            style={{
              fontSize: '9px',
              padding: '1px 5px',
              borderRadius: '3px',
              background: boardTheme === 'dark_grid' ? 'var(--primary)' : 'rgba(255,255,255,0.06)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            ⬛ Grid
          </button>
          <button
            type="button"
            onClick={() => {
              setBoardTheme('clean_white');
              if (activeColor === '#ffffff') setActiveColor('#0f172a');
            }}
            title="Classic Whiteboard"
            style={{
              fontSize: '9px',
              padding: '1px 5px',
              borderRadius: '3px',
              background: boardTheme === 'clean_white' ? 'var(--primary)' : 'rgba(255,255,255,0.06)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            ⬜ White
          </button>
          <button
            type="button"
            onClick={() => setBoardTheme('dot_matrix')}
            title="Dot Matrix"
            style={{
              fontSize: '9px',
              padding: '1px 5px',
              borderRadius: '3px',
              background: boardTheme === 'dot_matrix' ? 'var(--primary)' : 'rgba(255,255,255,0.06)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            🟦 Dots
          </button>
          <button
            type="button"
            onClick={() => setBoardTheme('isometric')}
            title="Array / Matrix Grid"
            style={{
              fontSize: '9px',
              padding: '1px 5px',
              borderRadius: '3px',
              background: boardTheme === 'isometric' ? 'var(--primary)' : 'rgba(255,255,255,0.06)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            📐 Matrix
          </button>
        </div>

        {/* Color Palette & Widths */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Colors */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setActiveColor(c)}
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: c,
                  border: activeColor === c ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.2)',
                  boxShadow: activeColor === c ? `0 0 5px ${c}` : 'none',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </div>

          {/* Widths */}
          <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
            {PEN_SIZES.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setActiveWidth(p.size)}
                style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  padding: '1px 4px',
                  borderRadius: '3px',
                  background: activeWidth === p.size ? 'rgba(99, 102, 241, 0.4)' : 'rgba(255,255,255,0.05)',
                  border: activeWidth === p.size ? '1px solid var(--primary)' : '1px solid transparent',
                  color: activeWidth === p.size ? '#fff' : 'var(--text-dim)',
                  cursor: 'pointer',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Interactive Drawing Canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
        style={{
          flexGrow: 1,
          width: '100%',
          height: '100%',
          cursor: 'crosshair',
          touchAction: 'none',
        }}
      />
    </div>
  );
};
