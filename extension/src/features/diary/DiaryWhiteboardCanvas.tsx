// ─── Synqto Diary Embedded Whiteboard Sketchpad Component ───

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Pencil,
  Clock,
  Eraser,
  Square,
  Circle,
  MoveRight,
  Database,
  Cloud,
  Scale,
  Server,
  Layers,
  Zap,
  GitBranch,
  Trash2,
  Download,
  Palette,
  Type,
} from 'lucide-react';
import { DiaryWhiteboardData } from './diary.types';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  id: string;
  tool: string;
  color: string;
  width: number;
  points: Point[];
  geometry?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    label?: string;
  };
  text?: string;
  timestamp: number;
}

const PEN_COLORS = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e', '#ffffff'];

const BG_PRESETS = [
  { id: 'dark_grid', label: 'Dark Grid', color: '#090d16', pattern: 'grid' },
  { id: 'dark_blank', label: 'Dark Blank', color: '#090d16', pattern: 'blank' },
  { id: 'dark_ruled', label: 'Dark Ruled', color: '#090d16', pattern: 'ruled' },
  { id: 'white_grid', label: 'Light Grid', color: '#ffffff', pattern: 'grid' },
  { id: 'white_ruled', label: 'Light Ruled', color: '#ffffff', pattern: 'ruled' },
  { id: 'sepia', label: 'Vintage Sepia', color: '#fef3c7', pattern: 'ruled' },
];

export const DiaryWhiteboardCanvas: React.FC<{
  whiteboardData?: DiaryWhiteboardData;
  onChange: (data: DiaryWhiteboardData) => void;
}> = ({ whiteboardData, onChange }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [activeTool, setActiveTool] = useState<string>('pen');
  const [activeColor, setActiveColor] = useState<string>('#6366f1');
  const [activeWidth, setActiveWidth] = useState<number>(3);
  const [bgColor, setBgColor] = useState<string>(whiteboardData?.bgColor || '#090d16');
  const [bgPattern, setBgPattern] = useState<string>(whiteboardData?.bgPattern || 'grid');

  const [strokes, setStrokes] = useState<Stroke[]>(whiteboardData?.strokes || []);
  const [tempStrokes, setTempStrokes] = useState<{ stroke: Stroke; createdAt: number }[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);

  // Text Tool Prompt State
  const [textModalPos, setTextModalPos] = useState<Point | null>(null);
  const [textInput, setTextInput] = useState('');

  // Sync incoming props if entry changes
  useEffect(() => {
    setStrokes(whiteboardData?.strokes || []);
    setBgColor(whiteboardData?.bgColor || '#090d16');
    setBgPattern(whiteboardData?.bgPattern || 'grid');
  }, [whiteboardData]);

  // Temporary Ink Fading Animation Loop
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setTempStrokes((prev) => {
        if (prev.length === 0) return prev;
        return prev.filter((item) => now - item.createdAt < 3000);
      });
    }, 40);
    return () => clearInterval(interval);
  }, []);

  const isLight = bgColor === '#ffffff' || bgColor === '#f8fafc' || bgColor === '#fef3c7';

  // Draw Background Grid/Pattern
  const drawBackground = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, w, h);

      if (bgPattern === 'grid') {
        ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        const step = 20;
        for (let x = 0; x < w; x += step) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = 0; y < h; y += step) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
      } else if (bgPattern === 'ruled') {
        ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        const step = 24;
        for (let y = 30; y < h; y += step) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
      }
    },
    [bgColor, bgPattern, isLight]
  );

  // Render Single Stroke (Without forced hardcoded text)
  const renderSingleStroke = useCallback(
    (ctx: CanvasRenderingContext2D, s: Stroke, alpha = 1.0) => {
      ctx.save();
      let color = s.color;
      if (isLight && (color === '#ffffff' || color === '#fff')) {
        color = '#0f172a';
      }

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = s.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = alpha;

      if (s.tool === 'eraser') {
        ctx.strokeStyle = isLight ? '#ffffff' : '#090d16';
        ctx.fillStyle = isLight ? '#ffffff' : '#090d16';
        ctx.lineWidth = s.width * 5;
      }

      if (s.text && s.geometry) {
        ctx.font = `bold ${Math.max(12, s.width * 3.5)}px -apple-system, sans-serif`;
        ctx.fillText(s.text, s.geometry.x1, s.geometry.y1);
      } else if (s.geometry) {
        const { x1, y1, x2, y2, label } = s.geometry;
        const w = Math.abs(x2 - x1);
        const h = Math.abs(y2 - y1);
        const minX = Math.min(x1, x2);
        const minY = Math.min(y1, y2);

        if (s.tool === 'line') {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        } else if (s.tool === 'arrow') {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();

          const angle = Math.atan2(y2 - y1, x2 - x1);
          const headLen = Math.max(10, s.width * 3);
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
        } else if (s.tool === 'rect') {
          ctx.strokeRect(minX, minY, w, h);
        } else if (s.tool === 'circle') {
          ctx.beginPath();
          ctx.ellipse(minX + w / 2, minY + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (s.tool === 'tree_node') {
          const r = Math.max(16, s.width * 4);
          ctx.beginPath();
          ctx.arc(x1, y1, r, 0, Math.PI * 2);
          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.fill();
          ctx.stroke();
          if (label) {
            ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 11px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, x1, y1);
          }
        } else if (s.tool === 'db_cylinder') {
          const dw = Math.max(45, w);
          const dh = Math.max(50, h);
          const ry = Math.min(14, dh * 0.2);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.ellipse(minX + dw / 2, minY + ry, dw / 2, ry, 0, Math.PI, 0);
          ctx.lineTo(minX + dw, minY + dh - ry);
          ctx.ellipse(minX + dw / 2, minY + dh - ry, dw / 2, ry, 0, 0, Math.PI);
          ctx.lineTo(minX, minY + ry);
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.ellipse(minX + dw / 2, minY + ry, dw / 2, ry, 0, 0, Math.PI * 2);
          ctx.stroke();

          if (label) {
            ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, minX + dw / 2, minY + dh / 2);
          }
        } else if (s.tool === 'cloud') {
          const cw = Math.max(60, w);
          const ch = Math.max(40, h);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, cw, ch, 14);
          ctx.fill();
          ctx.stroke();

          if (label) {
            ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, minX + cw / 2, minY + ch / 2);
          }
        } else if (s.tool === 'load_balancer') {
          const midX = minX + w / 2;
          const midY = minY + h / 2;
          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.moveTo(midX, minY);
          ctx.lineTo(minX + w, midY);
          ctx.lineTo(midX, minY + h);
          ctx.lineTo(minX, midY);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          if (label) {
            ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, midX, midY);
          }
        } else if (s.tool === 'server_box') {
          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 6);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#10b981';
          ctx.beginPath();
          ctx.arc(minX + 8, minY + 8, 3, 0, Math.PI * 2);
          ctx.fill();

          if (label) {
            ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, minX + w / 2, minY + h / 2);
          }
        } else if (s.tool === 'cache_mem') {
          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 4);
          ctx.fill();
          ctx.stroke();

          if (label) {
            ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, minX + w / 2, minY + h / 2);
          }
        }
      } else if (s.points && s.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo(s.points[i].x, s.points[i].y);
        }
        ctx.stroke();
      }
      ctx.restore();
    },
    [isLight]
  );

  // Master Redraw
  const redraw = useCallback(
    (previewPts?: Point[], previewGeom?: any) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;

      drawBackground(ctx, w, h);
      strokes.forEach((s) => renderSingleStroke(ctx, s));

      const now = Date.now();
      tempStrokes.forEach((item) => {
        const alpha = Math.max(0, 1 - (now - item.createdAt) / 3000);
        renderSingleStroke(ctx, item.stroke, alpha);
      });

      if (previewGeom) {
        renderSingleStroke(ctx, {
          id: 'preview',
          tool: activeTool,
          color: activeColor,
          width: activeWidth,
          points: [],
          geometry: previewGeom,
          timestamp: Date.now(),
        });
      } else if (previewPts && previewPts.length > 1) {
        renderSingleStroke(ctx, {
          id: 'preview',
          tool: activeTool,
          color: activeColor,
          width: activeWidth,
          points: previewPts,
          timestamp: Date.now(),
        });
      }
    },
    [activeColor, activeTool, activeWidth, drawBackground, renderSingleStroke, strokes, tempStrokes]
  );

  // Resize canvas to container
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
      if (ctx) ctx.scale(dpr, dpr);

      redraw();
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [redraw]);

  // Helper for coordinates
  const getCoords = (e: React.MouseEvent | React.TouchEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e && e.touches[0] ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e && e.touches[0] ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    const pt = getCoords(e);
    if (activeTool === 'text') {
      setTextModalPos(pt);
      setTextInput('');
      return;
    }

    setIsDrawing(true);
    setStartPoint(pt);
    setCurrentPoints([pt]);
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const pt = getCoords(e);
    const isGeom = ['line', 'arrow', 'rect', 'circle', 'tree_node', 'db_cylinder', 'cloud', 'load_balancer', 'server_box', 'cache_mem'].includes(activeTool);

    if (isGeom && startPoint) {
      redraw(undefined, { x1: startPoint.x, y1: startPoint.y, x2: pt.x, y2: pt.y });
    } else {
      const updated = [...currentPoints, pt];
      setCurrentPoints(updated);
      redraw(updated);
    }
  };

  const handlePointerUp = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const endPt = getCoords(e);
    const isGeom = ['line', 'arrow', 'rect', 'circle', 'tree_node', 'db_cylinder', 'cloud', 'load_balancer', 'server_box', 'cache_mem'].includes(activeTool);

    const newStroke: Stroke = {
      id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      tool: activeTool,
      color: activeColor,
      width: activeWidth,
      points: isGeom ? [] : [...currentPoints],
      geometry: isGeom && startPoint ? { x1: startPoint.x, y1: startPoint.y, x2: endPt.x, y2: endPt.y } : undefined,
      timestamp: Date.now(),
    };

    if (activeTool === 'temp_pen') {
      setTempStrokes((prev) => [...prev, { stroke: newStroke, createdAt: Date.now() }]);
    } else {
      const updatedStrokes = [...strokes, newStroke];
      setStrokes(updatedStrokes);
      onChange({ strokes: updatedStrokes, bgColor, bgPattern });
    }

    setCurrentPoints([]);
    setStartPoint(null);
  };

  const handleConfirmText = () => {
    if (!textModalPos || !textInput.trim()) {
      setTextModalPos(null);
      return;
    }

    const textStroke: Stroke = {
      id: `text-${Date.now()}`,
      tool: 'text',
      color: activeColor,
      width: activeWidth,
      points: [],
      text: textInput.trim(),
      geometry: { x1: textModalPos.x, y1: textModalPos.y, x2: textModalPos.x, y2: textModalPos.y },
      timestamp: Date.now(),
    };

    const updated = [...strokes, textStroke];
    setStrokes(updated);
    onChange({ strokes: updated, bgColor, bgPattern });
    setTextModalPos(null);
    setTextInput('');
  };

  const handleClear = () => {
    setStrokes([]);
    setTempStrokes([]);
    onChange({ strokes: [], bgColor, bgPattern });
  };

  const handleSelectBg = (color: string, pattern: string) => {
    setBgColor(color);
    setBgPattern(pattern);
    onChange({ strokes, bgColor: color, bgPattern: pattern });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bgColor, position: 'relative' }}>
      {/* ─── Compact Sketchpad Toolbar ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 8px',
          background: 'rgba(15, 23, 42, 0.95)',
          borderBottom: '1px solid var(--border-subtle)',
          flexWrap: 'wrap',
          gap: '4px',
          zIndex: 10,
        }}
      >
        {/* Drawing & Shape Tools */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          {[
            { id: 'pen', icon: Pencil, label: 'Pen' },
            { id: 'temp_pen', icon: Clock, label: 'Temp Ink (3s)' },
            { id: 'eraser', icon: Eraser, label: 'Eraser' },
            { id: 'arrow', icon: MoveRight, label: 'Arrow' },
            { id: 'rect', icon: Square, label: 'Box' },
            { id: 'circle', icon: Circle, label: 'Circle' },
            { id: 'tree_node', icon: GitBranch, label: 'Tree Node' },
            { id: 'db_cylinder', icon: Database, label: 'Database' },
            { id: 'cloud', icon: Cloud, label: 'Cloud' },
            { id: 'load_balancer', icon: Scale, label: 'Load Balancer' },
            { id: 'server_box', icon: Server, label: 'App Server' },
            { id: 'cache_mem', icon: Zap, label: 'Cache / Redis' },
            { id: 'text', icon: Type, label: 'Text Label' },
          ].map((t) => {
            const Icon = t.icon;
            const isActive = activeTool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTool(t.id)}
                title={t.label}
                style={{
                  background: isActive ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255, 255, 255, 0.04)',
                  borderColor: isActive ? 'var(--primary)' : 'transparent',
                  color: isActive ? '#ffffff' : '#c7d2fe',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderRadius: '4px',
                  padding: '3px 5px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon size={12} />
              </button>
            );
          })}
        </div>

        {/* Color Swatches & Clear */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {PEN_COLORS.map((c) => (
            <span
              key={c}
              onClick={() => setActiveColor(c)}
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                background: c,
                cursor: 'pointer',
                border: activeColor === c ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.2)',
                transform: activeColor === c ? 'scale(1.2)' : 'none',
              }}
            />
          ))}

          <button
            type="button"
            onClick={handleClear}
            title="Clear Sketchpad"
            style={{
              background: 'none',
              border: 'none',
              color: '#f87171',
              cursor: 'pointer',
              padding: '2px 4px',
              marginLeft: '4px',
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* ─── Canvas Workspace ─── */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onTouchStart={handlePointerDown}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
          style={{ width: '100%', height: '100%', display: 'block', cursor: activeTool === 'text' ? 'text' : 'crosshair' }}
        />

        {/* Inline Text Tool Modal */}
        {textModalPos && (
          <div
            style={{
              position: 'absolute',
              left: `${Math.min(textModalPos.x, (containerRef.current?.clientWidth || 300) - 180)}px`,
              top: `${Math.max(10, textModalPos.y - 35)}px`,
              zIndex: 50,
              background: 'rgba(15, 23, 42, 0.95)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '4px 6px',
              display: 'flex',
              gap: '4px',
              boxShadow: '0 10px 25px rgba(0,0,0,0.8)',
            }}
          >
            <input
              type="text"
              placeholder="Type label..."
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmText();
                if (e.key === 'Escape') setTextModalPos(null);
              }}
              autoFocus
              style={{
                background: 'rgba(0,0,0,0.5)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '4px',
                color: activeColor,
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 6px',
                width: '120px',
                outline: 'none',
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleConfirmText}
              style={{ fontSize: '9px', padding: '2px 6px' }}
            >
              Add
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
