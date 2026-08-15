// ─── Collaborative Whiteboard Canvas Component ───

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
} from 'lucide-react';
import { WhiteboardService } from './whiteboard.service';
import { WhiteboardToolType, WhiteboardStroke, Point } from './whiteboard.types';

const COLORS = [
  '#6366f1', // Indigo
  '#06b6d4', // Cyan
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#f43f5e', // Rose
  '#ffffff', // White
  '#94a3b8', // Gray
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
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [startPoint, setStartPoint] = useState<Point | null>(null);

  // Redraw all strokes on canvas
  const redrawCanvas = useCallback((strokes: WhiteboardStroke[], previewPoints?: Point[], previewGeometry?: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear background
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Set subtle grid background
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    const gridSize = 24;
    for (let x = 0; x < canvas.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    ctx.restore();

    // Helper to draw a single stroke
    const renderStroke = (stroke: WhiteboardStroke) => {
      ctx.save();
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = stroke.opacity;

      if (stroke.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = stroke.width * 3;
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

          // Arrow head
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
          // Circular Tree Node + Label
          const radius = Math.max(18, stroke.width * 4);
          ctx.beginPath();
          ctx.arc(x1, y1, radius, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
          ctx.fill();
          ctx.stroke();

          // Node center value text
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 12px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(stroke.geometry.label || 'N', x1, y1);
        }
      } else if (stroke.points && stroke.points.length > 1) {
        // Freehand pen or highlighter curve
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
      }

      ctx.restore();
    };

    // Draw all confirmed strokes
    strokes.forEach(renderStroke);

    // Draw live in-progress stroke preview
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
  }, [activeTool, activeColor, activeWidth]);

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

  // Subscribe to external/remote stroke changes
  useEffect(() => {
    return whiteboardService.onStrokesChange((strokes) => {
      redrawCanvas(strokes);
    });
  }, [redrawCanvas, whiteboardService]);

  // Mouse / Touch Event Handlers
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
        background: '#090d16',
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
          padding: '8px 10px',
          background: 'rgba(15, 23, 42, 0.95)',
          borderBottom: '1px solid var(--border-subtle)',
          flexWrap: 'wrap',
          gap: '6px',
        }}
      >
        {/* Tool Selector Buttons */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button
            type="button"
            className={`btn-icon ${activeTool === 'pen' ? 'active' : ''}`}
            onClick={() => setActiveTool('pen')}
            title="Pen Tool"
            style={{
              padding: '5px',
              borderRadius: '4px',
              border: activeTool === 'pen' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'pen' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'pen' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Pencil size={14} />
          </button>

          <button
            type="button"
            className={`btn-icon ${activeTool === 'highlighter' ? 'active' : ''}`}
            onClick={() => setActiveTool('highlighter')}
            title="Highlighter"
            style={{
              padding: '5px',
              borderRadius: '4px',
              border: activeTool === 'highlighter' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'highlighter' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'highlighter' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Highlighter size={14} />
          </button>

          <button
            type="button"
            className={`btn-icon ${activeTool === 'eraser' ? 'active' : ''}`}
            onClick={() => setActiveTool('eraser')}
            title="Eraser"
            style={{
              padding: '5px',
              borderRadius: '4px',
              border: activeTool === 'eraser' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'eraser' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'eraser' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Eraser size={14} />
          </button>

          <div style={{ width: '1px', height: '16px', background: 'var(--border-subtle)', margin: '0 2px' }} />

          {/* Shapes & Geometry */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'line' ? 'active' : ''}`}
            onClick={() => setActiveTool('line')}
            title="Straight Line"
            style={{
              padding: '5px',
              borderRadius: '4px',
              border: activeTool === 'line' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'line' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'line' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Minus size={14} />
          </button>

          <button
            type="button"
            className={`btn-icon ${activeTool === 'arrow' ? 'active' : ''}`}
            onClick={() => setActiveTool('arrow')}
            title="Arrow"
            style={{
              padding: '5px',
              borderRadius: '4px',
              border: activeTool === 'arrow' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'arrow' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'arrow' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <MoveRight size={14} />
          </button>

          <button
            type="button"
            className={`btn-icon ${activeTool === 'rect' ? 'active' : ''}`}
            onClick={() => setActiveTool('rect')}
            title="Rectangle / Array Box"
            style={{
              padding: '5px',
              borderRadius: '4px',
              border: activeTool === 'rect' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'rect' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'rect' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Square size={14} />
          </button>

          <button
            type="button"
            className={`btn-icon ${activeTool === 'circle' ? 'active' : ''}`}
            onClick={() => setActiveTool('circle')}
            title="Circle / Node"
            style={{
              padding: '5px',
              borderRadius: '4px',
              border: activeTool === 'circle' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'circle' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'circle' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Circle size={14} />
          </button>

          <button
            type="button"
            className={`btn-icon ${activeTool === 'tree_node' ? 'active' : ''}`}
            onClick={() => setActiveTool('tree_node')}
            title="Binary Tree Node"
            style={{
              padding: '5px',
              borderRadius: '4px',
              border: activeTool === 'tree_node' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'tree_node' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'tree_node' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <GitBranch size={14} />
          </button>
        </div>

        {/* Action Controls: Undo, Redo, Clear, Save */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => whiteboardService.undo()}
            title="Undo (Ctrl+Z)"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            <RotateCcw size={13} />
          </button>

          <button
            type="button"
            onClick={() => whiteboardService.redo()}
            title="Redo"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            <RotateCw size={13} />
          </button>

          <button
            type="button"
            onClick={() => {
              if (confirm('Clear collaborative whiteboard canvas?')) {
                whiteboardService.clearAll();
              }
            }}
            title="Clear Canvas"
            style={{
              background: 'none',
              border: 'none',
              color: '#f87171',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            <Trash2 size={13} />
          </button>

          <button
            type="button"
            onClick={handleExportPNG}
            title="Download Canvas as PNG"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            <Download size={13} />
          </button>
        </div>
      </div>

      {/* Sub-toolbar: Colors & Stroke Width */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 10px',
          background: 'rgba(0, 0, 0, 0.4)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {/* Color Palette */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setActiveColor(c)}
              style={{
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                background: c,
                border: activeColor === c ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.2)',
                boxShadow: activeColor === c ? `0 0 6px ${c}` : 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            />
          ))}
        </div>

        {/* Width Selector */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {PEN_SIZES.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setActiveWidth(p.size)}
              style={{
                fontSize: '9px',
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: '3px',
                background: activeWidth === p.size ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255,255,255,0.05)',
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
          cursor: activeTool === 'eraser' ? 'crosshair' : 'crosshair',
          touchAction: 'none',
        }}
      />
    </div>
  );
};
