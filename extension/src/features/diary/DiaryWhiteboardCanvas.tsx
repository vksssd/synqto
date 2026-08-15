// ─── Synqto Diary Embedded Whiteboard Sketchpad Component (Independent Pen Styles, Object Eraser & Undo Clear) ───

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
  Minus,
  RotateCcw,
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

const DEFAULT_TOOL_STYLES: Record<string, { color: string; width: number }> = {
  pen: { color: '#6366f1', width: 3 },
  temp_pen: { color: '#38bdf8', width: 3 },
  eraser: { color: '#ffffff', width: 18 },
  text: { color: '#ffffff', width: 3 },
  line: { color: '#6366f1', width: 3 },
  arrow: { color: '#6366f1', width: 3 },
  rect: { color: '#6366f1', width: 3 },
  circle: { color: '#6366f1', width: 3 },
  tree_node: { color: '#10b981', width: 3 },
  db_cylinder: { color: '#10b981', width: 2.5 },
  cloud: { color: '#38bdf8', width: 2.5 },
  load_balancer: { color: '#f59e0b', width: 2.5 },
  server_box: { color: '#818cf8', width: 2.5 },
  cache_mem: { color: '#f43f5e', width: 2.5 },
};

function distanceToLineSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

function isStrokeIntersectingEraser(stroke: Stroke, eraserPt: Point, radius: number): boolean {
  if (stroke.text && stroke.geometry) {
    return Math.hypot(stroke.geometry.x1 - eraserPt.x, stroke.geometry.y1 - eraserPt.y) <= radius + 30;
  }

  if (stroke.geometry) {
    const { x1, y1, x2, y2 } = stroke.geometry;
    const minX = Math.min(x1, x2) - radius;
    const maxX = Math.max(x1, x2) + radius;
    const minY = Math.min(y1, y2) - radius;
    const maxY = Math.max(y1, y2) + radius;

    if (eraserPt.x < minX || eraserPt.x > maxX || eraserPt.y < minY || eraserPt.y > maxY) {
      return false;
    }

    if (stroke.tool === 'line' || stroke.tool === 'arrow') {
      return distanceToLineSegment(eraserPt.x, eraserPt.y, x1, y1, x2, y2) <= radius + stroke.width;
    }

    return true;
  }

  if (stroke.points && stroke.points.length > 0) {
    const hitRadius = radius + stroke.width / 2;
    for (let i = 0; i < stroke.points.length; i++) {
      const p = stroke.points[i];
      if (Math.hypot(p.x - eraserPt.x, p.y - eraserPt.y) <= hitRadius) {
        return true;
      }
      if (i > 0) {
        const prev = stroke.points[i - 1];
        if (distanceToLineSegment(eraserPt.x, eraserPt.y, prev.x, prev.y, p.x, p.y) <= hitRadius) {
          return true;
        }
      }
    }
  }

  return false;
}

export const DiaryWhiteboardCanvas: React.FC<{
  whiteboardData?: DiaryWhiteboardData;
  onChange: (data: DiaryWhiteboardData) => void;
}> = ({ whiteboardData, onChange }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [activeTool, setActiveTool] = useState<string>('pen');

  // Independent per-tool style dictionary
  const [toolStyles, setToolStyles] = useState<Record<string, { color: string; width: number }>>(() => {
    try {
      const saved = localStorage.getItem('synqto_diary_tool_styles');
      if (saved) return { ...DEFAULT_TOOL_STYLES, ...JSON.parse(saved) };
    } catch (e) {}
    return DEFAULT_TOOL_STYLES;
  });

  const activeColor = toolStyles[activeTool]?.color || DEFAULT_TOOL_STYLES[activeTool]?.color || '#6366f1';
  const activeWidth = toolStyles[activeTool]?.width || DEFAULT_TOOL_STYLES[activeTool]?.width || 3;

  const [bgColor, setBgColor] = useState<string>(whiteboardData?.bgColor || '#090d16');
  const [bgPattern, setBgPattern] = useState<string>(whiteboardData?.bgPattern || 'grid');

  const [strokes, setStrokes] = useState<Stroke[]>(whiteboardData?.strokes || []);
  const [undoStack, setUndoStack] = useState<Stroke[][]>([]);
  const [tempStrokes, setTempStrokes] = useState<{ stroke: Stroke; createdAt: number }[]>([]);

  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [eraserPos, setEraserPos] = useState<Point | null>(null);

  // Text Tool Prompt State
  const [textModalPos, setTextModalPos] = useState<Point | null>(null);
  const [textInput, setTextInput] = useState('');

  // Update active tool's color
  const updateActiveToolColor = (newColor: string) => {
    setToolStyles((prev) => {
      const updated = {
        ...prev,
        [activeTool]: {
          ...(prev[activeTool] || { width: 3 }),
          color: newColor,
        },
      };
      try {
        localStorage.setItem('synqto_diary_tool_styles', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

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
      if (s.tool === 'eraser') return;

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
        } else if (s.tool === 'cloud') {
          const cw = Math.max(60, w);
          const ch = Math.max(40, h);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, cw, ch, 14);
          ctx.fill();
          ctx.stroke();
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
        } else if (s.tool === 'cache_mem') {
          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 4);
          ctx.fill();
          ctx.stroke();
        }

        if (label && label.trim()) {
          ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, minX + w / 2, minY + h / 2);
        }
      } else if (s.points && s.points.length > 0) {
        if (s.points.length === 1) {
          ctx.beginPath();
          ctx.arc(s.points[0].x, s.points[0].y, s.width / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(s.points[0].x, s.points[0].y);
          for (let i = 1; i < s.points.length - 1; i++) {
            const midX = (s.points[i].x + s.points[i + 1].x) / 2;
            const midY = (s.points[i].y + s.points[i + 1].y) / 2;
            ctx.quadraticCurveTo(s.points[i].x, s.points[i].y, midX, midY);
          }
          ctx.lineTo(s.points[s.points.length - 1].x, s.points[s.points.length - 1].y);
          ctx.stroke();
        }
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

      // Draw Eraser Indicator
      if (activeTool === 'eraser' && eraserPos) {
        ctx.save();
        const r = activeWidth * 2.2 || 18;
        ctx.strokeStyle = isLight ? '#ef4444' : '#f87171';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(eraserPos.x, eraserPos.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = isLight ? 'rgba(239, 68, 68, 0.08)' : 'rgba(239, 68, 68, 0.15)';
        ctx.fill();
        ctx.restore();
      }
    },
    [activeColor, activeTool, activeWidth, drawBackground, renderSingleStroke, strokes, tempStrokes, eraserPos, isLight]
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

    if (activeTool === 'eraser') {
      setIsDrawing(true);
      setEraserPos(pt);
      const radius = activeWidth * 2.2 || 18;
      const remaining = strokes.filter((s) => !isStrokeIntersectingEraser(s, pt, radius));
      if (remaining.length !== strokes.length) {
        setUndoStack((prev) => [...prev, strokes]);
        setStrokes(remaining);
        onChange({ strokes: remaining, bgColor, bgPattern });
      }
      return;
    }

    setIsDrawing(true);
    setStartPoint(pt);
    setCurrentPoints([pt]);
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    const pt = getCoords(e);

    if (activeTool === 'eraser') {
      setEraserPos(pt);
      if (isDrawing) {
        const radius = activeWidth * 2.2 || 18;
        const remaining = strokes.filter((s) => !isStrokeIntersectingEraser(s, pt, radius));
        if (remaining.length !== strokes.length) {
          setUndoStack((prev) => [...prev, strokes]);
          setStrokes(remaining);
          onChange({ strokes: remaining, bgColor, bgPattern });
        }
      }
      redraw();
      return;
    }

    if (!isDrawing) return;
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
    if (activeTool === 'eraser') {
      setIsDrawing(false);
      setEraserPos(null);
      redraw();
      return;
    }

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
      setUndoStack((prev) => [...prev, strokes]);
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

    setUndoStack((prev) => [...prev, strokes]);
    const updated = [...strokes, textStroke];
    setStrokes(updated);
    onChange({ strokes: updated, bgColor, bgPattern });
    setTextModalPos(null);
    setTextInput('');
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setStrokes(previous);
    onChange({ strokes: previous, bgColor, bgPattern });
  };

  const handleClear = () => {
    if (strokes.length === 0) return;
    setUndoStack((prev) => [...prev, strokes]);
    setStrokes([]);
    setTempStrokes([]);
    onChange({ strokes: [], bgColor, bgPattern });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bgColor, position: 'relative' }}>
      {/* ─── Compact Sketchpad Toolbar with Independent Tool Styling ─── */}
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
            { id: 'pen', icon: Pencil, label: 'Pen', defColor: '#6366f1' },
            { id: 'temp_pen', icon: Clock, label: 'Temp Ink (3s)', defColor: '#38bdf8' },
            { id: 'eraser', icon: Eraser, label: 'Eraser', defColor: '#ffffff' },
            { id: 'arrow', icon: MoveRight, label: 'Arrow', defColor: '#6366f1' },
            { id: 'rect', icon: Square, label: 'Box', defColor: '#6366f1' },
            { id: 'circle', icon: Circle, label: 'Circle', defColor: '#6366f1' },
            { id: 'tree_node', icon: GitBranch, label: 'Tree Node', defColor: '#10b981' },
            { id: 'db_cylinder', icon: Database, label: 'Database', defColor: '#10b981' },
            { id: 'cloud', icon: Cloud, label: 'Cloud', defColor: '#38bdf8' },
            { id: 'load_balancer', icon: Scale, label: 'Load Balancer', defColor: '#f59e0b' },
            { id: 'server_box', icon: Server, label: 'App Server', defColor: '#818cf8' },
            { id: 'cache_mem', icon: Zap, label: 'Cache / Redis', defColor: '#f43f5e' },
            { id: 'text', icon: Type, label: 'Text Label', defColor: '#ffffff' },
          ].map((t) => {
            const Icon = t.icon;
            const isActive = activeTool === t.id;
            const toolColor = toolStyles[t.id]?.color || t.defColor;

            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTool(t.id)}
                title={`${t.label} (Remembers its own style)`}
                style={{
                  background: isActive ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255, 255, 255, 0.04)',
                  borderColor: isActive ? 'var(--primary)' : 'transparent',
                  color: isActive ? '#ffffff' : 'var(--text-muted)',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderRadius: '4px',
                  padding: '3px 5px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <Icon size={12} color={isActive ? toolColor : 'var(--text-muted)'} />
                {t.id !== 'eraser' && (
                  <span
                    style={{
                      width: '5px',
                      height: '5px',
                      borderRadius: '50%',
                      background: toolColor,
                      display: 'inline-block',
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Color Swatches, Undo & Clear */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {PEN_COLORS.map((c) => (
            <span
              key={c}
              onClick={() => updateActiveToolColor(c)}
              title={`Color for ${activeTool}`}
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
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            title="Undo (Ctrl+Z)"
            style={{
              background: 'none',
              border: 'none',
              color: undoStack.length > 0 ? '#c7d2fe' : 'var(--text-dim)',
              cursor: undoStack.length > 0 ? 'pointer' : 'default',
              padding: '2px 4px',
              marginLeft: '2px',
            }}
          >
            <RotateCcw size={12} />
          </button>

          <button
            type="button"
            onClick={handleClear}
            title="Clear Sketchpad (Undoable)"
            style={{
              background: 'none',
              border: 'none',
              color: '#f87171',
              cursor: 'pointer',
              padding: '2px 4px',
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
          style={{ width: '100%', height: '100%', display: 'block', cursor: activeTool === 'text' ? 'text' : activeTool === 'eraser' ? 'cell' : 'crosshair' }}
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
