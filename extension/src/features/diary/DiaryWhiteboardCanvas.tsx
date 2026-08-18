// ─── Synqto Diary Embedded Whiteboard Sketchpad Component ───
// Full Feature Parity: DSA Visualizers, Architecture Nodes, 18 Presets, 3D Isometric & Independent Styles

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Pencil, Clock, Eraser, Circle, Server, Trash2, Type, RotateCcw, Code, Shield, Triangle, MousePointer, Copy, Plus, X, Clipboard, PenTool, Highlighter } from 'lucide-react';
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

const PEN_COLORS = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e', '#a855f7', '#ffffff', '#0f172a'];

const BG_PRESETS = [
  { id: 'dark_grid', label: 'Dark Grid', color: '#090d16', pattern: 'grid' },
  { id: 'dark_iso', label: '3D Isometric', color: '#090d16', pattern: 'isometric' },
  { id: 'dark_blank', label: 'Dark Blank', color: '#090d16', pattern: 'blank' },
  { id: 'dark_ruled', label: 'Dark Ruled', color: '#090d16', pattern: 'ruled' },
  { id: 'dark_plot', label: 'Coordinate Plot', color: '#090d16', pattern: 'plot' },
  { id: 'dark_matrix', label: 'Matrix Table', color: '#090d16', pattern: 'matrix' },
  { id: 'white_grid', label: 'Light Grid', color: '#ffffff', pattern: 'grid' },
  { id: 'white_ruled', label: 'Light Ruled', color: '#ffffff', pattern: 'ruled' },
  { id: 'sepia', label: 'Vintage Sepia', color: '#fef3c7', pattern: 'ruled' },
];

const DEFAULT_TOOL_STYLES: Record<string, { color: string; width: number }> = {
  select: { color: '#6366f1', width: 3 },
  hand: { color: '#6366f1', width: 3 },
  pen: { color: '#6366f1', width: 4 },
  brush: { color: '#06b6d4', width: 8 },
  highlighter: { color: '#f59e0b', width: 22 },
  temp_pen: { color: '#38bdf8', width: 4 },
  eraser: { color: '#ffffff', width: 24 },
  text: { color: '#ffffff', width: 4 },
  code_box: { color: '#38bdf8', width: 3 },
  line: { color: '#6366f1', width: 3.5 },
  arrow: { color: '#6366f1', width: 3.5 },
  arrow_bi: { color: '#6366f1', width: 3.5 },
  rect: { color: '#6366f1', width: 3.5 },
  rounded_rect: { color: '#6366f1', width: 3.5 },
  circle: { color: '#6366f1', width: 3.5 },
  triangle: { color: '#10b981', width: 3.5 },
  star: { color: '#f59e0b', width: 3.5 },
  decision_diamond: { color: '#f59e0b', width: 3.5 },
  tree_node: { color: '#10b981', width: 3.5 },
  sticky_note: { color: '#fef3c7', width: 2.5 },
  db_cylinder: { color: '#10b981', width: 3 },
  db_nosql: { color: '#34d399', width: 3 },
  cloud: { color: '#38bdf8', width: 3 },
  load_balancer: { color: '#f59e0b', width: 3 },
  message_queue: { color: '#a855f7', width: 3 },
  server_box: { color: '#818cf8', width: 3 },
  cache_mem: { color: '#f43f5e', width: 3 },
  dns_router: { color: '#38bdf8', width: 3 },
  firewall: { color: '#f43f5e', width: 3 },
  user_client: { color: '#3b82f6', width: 3 },
  mobile_client: { color: '#06b6d4', width: 3 },
  array_cells: { color: '#38bdf8', width: 3 },
  stack_lifo: { color: '#f59e0b', width: 3 },
  queue_fifo: { color: '#10b981', width: 3 },
  hashmap_table: { color: '#a855f7', width: 3 },
  two_pointers: { color: '#ec4899', width: 2.5 },
  cdn_edge: { color: '#06b6d4', width: 3 },
  object_storage: { color: '#f97316', width: 3 },
  auth_jwt: { color: '#eab308', width: 3 },
  websocket_gw: { color: '#6366f1', width: 3 },
  elasticsearch: { color: '#14b8a6', width: 3 },
  async_arrow: { color: '#a855f7', width: 2.5 },
  tradeoff_note: { color: '#facc15', width: 2.5 },
};

function distanceToLineSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

function getStrokeBounds(stroke: Stroke): { minX: number; minY: number; maxX: number; maxY: number } {
  if (stroke.text && stroke.geometry) {
    return { minX: stroke.geometry.x1, minY: stroke.geometry.y1 - 20, maxX: stroke.geometry.x1 + 100, maxY: stroke.geometry.y1 + 10 };
  }
  if (stroke.geometry) {
    const minX = Math.min(stroke.geometry.x1, stroke.geometry.x2);
    const maxX = Math.max(stroke.geometry.x1, stroke.geometry.x2);
    const minY = Math.min(stroke.geometry.y1, stroke.geometry.y2);
    const maxY = Math.max(stroke.geometry.y1, stroke.geometry.y2);
    return { minX, minY, maxX, maxY };
  }
  if (stroke.points && stroke.points.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of stroke.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }
  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function isStrokeInRect(stroke: Stroke, rect: { x1: number; y1: number; x2: number; y2: number }): boolean {
  const rMinX = Math.min(rect.x1, rect.x2);
  const rMaxX = Math.max(rect.x1, rect.x2);
  const rMinY = Math.min(rect.y1, rect.y2);
  const rMaxY = Math.max(rect.y1, rect.y2);
  const b = getStrokeBounds(stroke);
  return !(b.maxX < rMinX || b.minX > rMaxX || b.maxY < rMinY || b.minY > rMaxY);
}

function moveStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  const updated = { ...stroke };
  if (updated.geometry) {
    updated.geometry = {
      ...updated.geometry,
      x1: updated.geometry.x1 + dx,
      y1: updated.geometry.y1 + dy,
      x2: updated.geometry.x2 + dx,
      y2: updated.geometry.y2 + dy,
    };
  }
  if (updated.points && updated.points.length > 0) {
    updated.points = updated.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  return updated;
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

    if (stroke.tool === 'line' || stroke.tool === 'arrow' || stroke.tool === 'arrow_bi' || stroke.tool === 'async_arrow' || stroke.tool === 'two_pointers') {
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
  const [showShapesDrawer, setShowShapesDrawer] = useState(false);
  const [showDsaDrawer, setShowDsaDrawer] = useState(false);
  const [showArchDrawer, setShowArchDrawer] = useState(false);
  const [showBgDrawer, setShowBgDrawer] = useState(false);

  // Independent per-tool style dictionary
  const [toolStyles, setToolStyles] = useState<Record<string, { color: string; width: number }>>(() => {
    try {
      const saved = localStorage.getItem('synqto_diary_tool_styles');
      if (saved) return { ...DEFAULT_TOOL_STYLES, ...JSON.parse(saved) };
    } catch (e) {}
    return DEFAULT_TOOL_STYLES;
  });

  const activeColor = toolStyles[activeTool]?.color || DEFAULT_TOOL_STYLES[activeTool]?.color || '#6366f1';
  const activeWidth = toolStyles[activeTool]?.width || DEFAULT_TOOL_STYLES[activeTool]?.width || 4;

  const [bgColor, setBgColor] = useState<string>(whiteboardData?.bgColor || '#090d16');
  const [bgPattern, setBgPattern] = useState<string>(whiteboardData?.bgPattern || 'grid');

  const [strokes, setStrokes] = useState<Stroke[]>(whiteboardData?.strokes || []);
  const [undoStack, setUndoStack] = useState<Stroke[][]>([]);
  const [tempStrokes, setTempStrokes] = useState<{ stroke: Stroke; createdAt: number }[]>([]);

  // Selection & Transform State
  const [selectedStrokeIds, setSelectedStrokeIds] = useState<string[]>([]);
  const [selectionBox, setSelectionBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [isMovingSelection, setIsMovingSelection] = useState(false);
  const [moveStartPoint, setMoveStartPoint] = useState<Point | null>(null);
  const [clipboardStrokes, setClipboardStrokes] = useState<Stroke[]>([]);
  const initialSelectedStrokesRef = useRef<Stroke[]>([]);

  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [eraserPos, setEraserPos] = useState<Point | null>(null);

  // Text Tool Prompt State
  const [textModalPos, setTextModalPos] = useState<Point | null>(null);
  const [textInput, setTextInput] = useState('');

  // Calculate overall bounding box of currently selected strokes
  const getSelectedBounds = useCallback(() => {
    const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
    if (selected.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    selected.forEach((s) => {
      const b = getStrokeBounds(s);
      if (b.minX < minX) minX = b.minX;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxY > maxY) maxY = b.maxY;
    });
    return { minX: minX - 8, minY: minY - 8, maxX: maxX + 8, maxY: maxY + 8 };
  }, [selectedStrokeIds, strokes]);

  // Copy selected strokes
  const handleCopySelected = useCallback(() => {
    const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
    if (selected.length === 0) return;
    setClipboardStrokes(selected);
  }, [selectedStrokeIds, strokes]);

  // Paste copied strokes
  const handlePasteSelected = useCallback(() => {
    if (clipboardStrokes.length === 0) return;
    const newStrokes = clipboardStrokes.map((s) => ({
      ...moveStroke(s, 24, 24),
      id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: Date.now(),
    }));
    setUndoStack((prev) => [...prev, strokes]);
    const updated = [...strokes, ...newStrokes];
    setStrokes(updated);
    setSelectedStrokeIds(newStrokes.map((s) => s.id));
    setClipboardStrokes(newStrokes);
    onChange({ strokes: updated, bgColor, bgPattern });
  }, [clipboardStrokes, strokes, bgColor, bgPattern, onChange]);

  // Duplicate selected strokes
  const handleDuplicateSelected = useCallback(() => {
    const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
    if (selected.length === 0) return;
    const newStrokes = selected.map((s) => ({
      ...moveStroke(s, 24, 24),
      id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: Date.now(),
    }));
    setUndoStack((prev) => [...prev, strokes]);
    const updated = [...strokes, ...newStrokes];
    setStrokes(updated);
    setSelectedStrokeIds(newStrokes.map((s) => s.id));
    onChange({ strokes: updated, bgColor, bgPattern });
  }, [selectedStrokeIds, strokes, bgColor, bgPattern, onChange]);

  // Delete selected strokes
  const handleDeleteSelected = useCallback(() => {
    if (selectedStrokeIds.length === 0) return;
    setUndoStack((prev) => [...prev, strokes]);
    const remaining = strokes.filter((s) => !selectedStrokeIds.includes(s.id));
    setStrokes(remaining);
    setSelectedStrokeIds([]);
    onChange({ strokes: remaining, bgColor, bgPattern });
  }, [selectedStrokeIds, strokes, bgColor, bgPattern, onChange]);

  // Deselect
  const handleDeselect = useCallback(() => {
    setSelectedStrokeIds([]);
    setSelectionBox(null);
  }, []);

  // Keyboard Shortcuts for Selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedStrokeIds.length > 0) {
          e.preventDefault();
          handleCopySelected();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (clipboardStrokes.length > 0) {
          e.preventDefault();
          handlePasteSelected();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        if (selectedStrokeIds.length > 0) {
          e.preventDefault();
          handleDuplicateSelected();
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedStrokeIds.length > 0) {
          e.preventDefault();
          handleDeleteSelected();
        }
      } else if (e.key === 'Escape') {
        handleDeselect();
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (selectedStrokeIds.length > 0) {
          e.preventDefault();
          const dist = e.shiftKey ? 10 : 2;
          const dx = e.key === 'ArrowLeft' ? -dist : e.key === 'ArrowRight' ? dist : 0;
          const dy = e.key === 'ArrowUp' ? -dist : e.key === 'ArrowDown' ? dist : 0;
          const updated = strokes.map((s) => selectedStrokeIds.includes(s.id) ? moveStroke(s, dx, dy) : s);
          setStrokes(updated);
          onChange({ strokes: updated, bgColor, bgPattern });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedStrokeIds, clipboardStrokes, handleCopySelected, handlePasteSelected, handleDuplicateSelected, handleDeleteSelected, handleDeselect, strokes, bgColor, bgPattern, onChange]);

  // Update active tool's color
  const updateActiveToolColor = (newColor: string) => {
    setToolStyles((prev) => {
      const updated = {
        ...prev,
        [activeTool]: {
          ...(prev[activeTool] || { width: 4 }),
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

      if (bgPattern === 'isometric') {
        ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        const isoStep = 24;
        const tan30 = Math.tan((30 * Math.PI) / 180);
        for (let x = -w; x < w * 2; x += isoStep * 2) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x + h / tan30, h);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x - h / tan30, h);
          ctx.stroke();
        }
      } else if (bgPattern === 'ruled') {
        ctx.strokeStyle = isLight ? 'rgba(99, 102, 241, 0.22)' : 'rgba(99, 102, 241, 0.16)';
        ctx.lineWidth = 1;
        const step = 24;
        for (let y = 30; y < h; y += step) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
      } else if (bgPattern === 'plot') {
        const midX = Math.floor(w / 2);
        const midY = Math.floor(h / 2);
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, midY);
        ctx.lineTo(w, midY);
        ctx.moveTo(midX, 0);
        ctx.lineTo(midX, h);
        ctx.stroke();
      } else if (bgPattern === 'matrix') {
        ctx.strokeStyle = isLight ? 'rgba(99, 102, 241, 0.2)' : 'rgba(99, 102, 241, 0.12)';
        ctx.lineWidth = 1;
        const cell = 26;
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
      } else if (bgPattern === 'grid') {
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
      }
    },
    [bgColor, bgPattern, isLight]
  );

  // Render Single Stroke
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
        const midX = minX + w / 2;
        const midY = minY + h / 2;

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
        } else if (s.tool === 'arrow_bi') {
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
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 + headLen * Math.cos(angle - Math.PI / 6), y1 + headLen * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 + headLen * Math.cos(angle + Math.PI / 6), y1 + headLen * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
        } else if (s.tool === 'rect') {
          ctx.strokeRect(minX, minY, w, h);
        } else if (s.tool === 'rounded_rect') {
          ctx.beginPath();
          ctx.roundRect(minX, minY, Math.max(20, w), Math.max(20, h), 8);
          ctx.stroke();
        } else if (s.tool === 'circle') {
          ctx.beginPath();
          ctx.ellipse(minX + w / 2, minY + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (s.tool === 'triangle') {
          ctx.beginPath();
          ctx.moveTo(midX, minY);
          ctx.lineTo(minX + w, minY + h);
          ctx.lineTo(minX, minY + h);
          ctx.closePath();
          ctx.stroke();
        } else if (s.tool === 'decision_diamond') {
          ctx.beginPath();
          ctx.moveTo(midX, minY);
          ctx.lineTo(minX + w, midY);
          ctx.lineTo(midX, minY + h);
          ctx.lineTo(minX, midY);
          ctx.closePath();
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
        } else if (s.tool === 'code_box') {
          const boxW = Math.max(80, w);
          const boxH = Math.max(32, h);
          ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(minX, minY, boxW, boxH, 4);
          ctx.fill();
          ctx.stroke();
          if (label) {
            ctx.fillStyle = '#38bdf8';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, minX + boxW / 2, minY + boxH / 2);
          }
        }

        // DSA Primitives
        else if (s.tool === 'array_cells') {
          const numCells = 5;
          const cellW = Math.max(22, Math.floor(Math.max(100, w) / numCells));
          const cellH = Math.max(24, Math.min(40, h || 28));
          ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 23, 42, 0.9)';
          for (let i = 0; i < numCells; i++) {
            const cx = minX + i * cellW;
            ctx.fillRect(cx, minY, cellW, cellH);
            ctx.strokeRect(cx, minY, cellW, cellH);
            ctx.fillStyle = isLight ? '#64748b' : '#94a3b8';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(`[${i}]`, cx + cellW / 2, minY - 2);
            ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 11px monospace';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${i * 2 + 1}`, cx + cellW / 2, minY + cellH / 2);
            ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 23, 42, 0.9)';
          }
        } else if (s.tool === 'stack_lifo') {
          const stkW = Math.max(45, w);
          const stkH = Math.max(70, h);
          ctx.beginPath();
          ctx.moveTo(minX, minY);
          ctx.lineTo(minX, minY + stkH);
          ctx.lineTo(minX + stkW, minY + stkH);
          ctx.lineTo(minX + stkW, minY);
          ctx.stroke();
          const items = 3;
          const itemH = Math.floor((stkH - 8) / items);
          for (let i = 0; i < items; i++) {
            const iy = minY + stkH - (i + 1) * itemH;
            ctx.fillStyle = isLight ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.25)';
            ctx.fillRect(minX + 3, iy, stkW - 6, itemH - 2);
            ctx.strokeRect(minX + 3, iy, stkW - 6, itemH - 2);
            ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(i === items - 1 ? 'TOP' : `val_${i + 1}`, minX + stkW / 2, iy + itemH / 2);
          }
        } else if (s.tool === 'queue_fifo') {
          const qW = Math.max(75, w);
          const qH = Math.max(28, h);
          ctx.beginPath();
          ctx.moveTo(minX, minY);
          ctx.lineTo(minX + qW, minY);
          ctx.moveTo(minX, minY + qH);
          ctx.lineTo(minX + qW, minY + qH);
          ctx.stroke();
          const qItems = 3;
          const qItemW = Math.floor((qW - 8) / qItems);
          for (let i = 0; i < qItems; i++) {
            const qx = minX + 4 + i * qItemW;
            ctx.fillStyle = isLight ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.25)';
            ctx.fillRect(qx, minY + 3, qItemW - 2, qH - 6);
            ctx.strokeRect(qx, minY + 3, qItemW - 2, qH - 6);
            ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`e${i + 1}`, qx + qItemW / 2, minY + qH / 2);
          }
        } else if (s.tool === 'hashmap_table') {
          const hmW = Math.max(75, w);
          const hmH = Math.max(50, h);
          ctx.strokeRect(minX, minY, hmW, hmH);
          const rows = 3;
          const rH = hmH / rows;
          for (let i = 1; i < rows; i++) {
            ctx.beginPath();
            ctx.moveTo(minX, minY + i * rH);
            ctx.lineTo(minX + hmW, minY + i * rH);
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.moveTo(minX + 22, minY);
          ctx.lineTo(minX + 22, minY + hmH);
          ctx.stroke();
          for (let i = 0; i < rows; i++) {
            ctx.fillStyle = isLight ? '#64748b' : '#94a3b8';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${i}`, minX + 11, minY + i * rH + rH / 2);
            ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
            ctx.fillText(`k${i + 1} ➔ v${i + 1}`, minX + 26 + (hmW - 26) / 2, minY + i * rH + rH / 2);
          }
        } else if (s.tool === 'two_pointers') {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const headLen = Math.max(8, s.width * 2.5);
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
          if (label) {
            ctx.fillStyle = color;
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(label, x1, y1 - 4);
          }
        }

        // Architecture Nodes
        else if (s.tool === 'db_cylinder' || s.tool === 'db_nosql') {
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
          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.moveTo(midX, minY);
          ctx.lineTo(minX + w, midY);
          ctx.lineTo(minX + w / 2, minY + h);
          ctx.lineTo(minX, midY);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (s.tool === 'message_queue') {
          const mqW = Math.max(70, w);
          const mqH = Math.max(34, h);
          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, mqW, mqH, 6);
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
          ctx.fillStyle = isLight ? 'rgba(244, 63, 94, 0.1)' : 'rgba(244, 63, 94, 0.2)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 4);
          ctx.fill();
          ctx.stroke();
        } else if (s.tool === 'cdn_edge') {
          ctx.fillStyle = isLight ? 'rgba(6, 182, 212, 0.1)' : 'rgba(6, 182, 212, 0.2)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 12);
          ctx.fill();
          ctx.stroke();
        } else if (s.tool === 'object_storage') {
          ctx.fillStyle = isLight ? 'rgba(249, 115, 22, 0.1)' : 'rgba(249, 115, 22, 0.2)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 6);
          ctx.fill();
          ctx.stroke();
        } else if (s.tool === 'auth_jwt') {
          ctx.beginPath();
          ctx.moveTo(midX, minY);
          ctx.lineTo(minX + w, minY + h * 0.3);
          ctx.lineTo(midX, minY + h);
          ctx.lineTo(minX, minY + h * 0.3);
          ctx.closePath();
          ctx.fillStyle = isLight ? 'rgba(234, 179, 8, 0.15)' : 'rgba(234, 179, 8, 0.25)';
          ctx.fill();
          ctx.stroke();
        } else if (s.tool === 'tradeoff_note') {
          ctx.fillStyle = 'rgba(250, 204, 21, 0.18)';
          ctx.strokeStyle = '#facc15';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 4);
          ctx.fill();
          ctx.stroke();
        }

        if (label && label.trim() && s.tool !== 'two_pointers' && s.tool !== 'tree_node' && s.tool !== 'code_box') {
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
        const r = activeWidth * 2.2 || 24;
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

      // Selection Marquee Box
      if (selectionBox) {
        ctx.save();
        const minX = Math.min(selectionBox.x1, selectionBox.x2);
        const minY = Math.min(selectionBox.y1, selectionBox.y2);
        const selW = Math.abs(selectionBox.x2 - selectionBox.x1);
        const selH = Math.abs(selectionBox.y2 - selectionBox.y1);
        ctx.fillStyle = isLight ? 'rgba(99, 102, 241, 0.12)' : 'rgba(99, 102, 241, 0.2)';
        ctx.fillRect(minX, minY, selW, selH);
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(minX, minY, selW, selH);
        ctx.restore();
      }

      // Selected Strokes Bounding Box & Corner Handles
      if (selectedStrokeIds.length > 0) {
        const selectedStrokes = strokes.filter((s) => selectedStrokeIds.includes(s.id));
        if (selectedStrokes.length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          selectedStrokes.forEach((s) => {
            const b = getStrokeBounds(s);
            if (b.minX < minX) minX = b.minX;
            if (b.maxX > maxX) maxX = b.maxX;
            if (b.minY < minY) minY = b.minY;
            if (b.maxY > maxY) maxY = b.maxY;
          });
          const pad = 6;
          const bbX = minX - pad;
          const bbY = minY - pad;
          const bbW = maxX - minX + pad * 2;
          const bbH = maxY - minY + pad * 2;

          ctx.save();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(bbX, bbY, bbW, bbH);
          ctx.setLineDash([]);

          const handles = [
            { x: bbX, y: bbY },
            { x: bbX + bbW, y: bbY },
            { x: bbX, y: bbY + bbH },
            { x: bbX + bbW, y: bbY + bbH },
          ];
          handles.forEach((h) => {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(h.x - 3.5, h.y - 3.5, 7, 7);
            ctx.strokeStyle = '#0284c7';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(h.x - 3.5, h.y - 3.5, 7, 7);
          });
          ctx.restore();
        }
      }
    },
    [activeColor, activeTool, activeWidth, drawBackground, renderSingleStroke, strokes, tempStrokes, eraserPos, isLight, selectionBox, selectedStrokeIds]
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

  // Coordinates helper
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

  const isGeomTool = (tool: string) => [
    'line', 'arrow', 'arrow_bi', 'rect', 'rounded_rect', 'circle', 'triangle', 'star',
    'decision_diamond', 'tree_node', 'sticky_note', 'text', 'code_box',
    'db_cylinder', 'db_nosql', 'cloud', 'cdn_edge', 'object_storage', 'auth_jwt',
    'websocket_gw', 'elasticsearch', 'load_balancer', 'message_queue', 'server_box',
    'cache_mem', 'dns_router', 'firewall', 'user_client', 'mobile_client', 'async_arrow',
    'tradeoff_note', 'array_cells', 'two_pointers', 'stack_lifo', 'queue_fifo', 'hashmap_table'
  ].includes(tool);

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    const pt = getCoords(e);

    if (activeTool === 'select') {
      const selBounds = getSelectedBounds();
      if (selBounds && pt.x >= selBounds.minX && pt.x <= selBounds.maxX && pt.y >= selBounds.minY && pt.y <= selBounds.maxY) {
        setIsMovingSelection(true);
        setMoveStartPoint(pt);
        initialSelectedStrokesRef.current = strokes.filter((s) => selectedStrokeIds.includes(s.id)).map((s) => JSON.parse(JSON.stringify(s)));
        return;
      }

      const hit = [...strokes].reverse().find((s) => isStrokeIntersectingEraser(s, pt, 12));
      if (hit) {
        const isShift = (e as React.MouseEvent).shiftKey;
        if (isShift) {
          setSelectedStrokeIds((prev) => prev.includes(hit.id) ? prev.filter((id) => id !== hit.id) : [...prev, hit.id]);
        } else {
          setSelectedStrokeIds([hit.id]);
        }
        setIsMovingSelection(true);
        setMoveStartPoint(pt);
        initialSelectedStrokesRef.current = [JSON.parse(JSON.stringify(hit))];
        return;
      }

      setSelectedStrokeIds([]);
      setSelectionBox({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
      setStartPoint(pt);
      setIsDrawing(true);
      return;
    }

    if (activeTool === 'text') {
      setTextModalPos(pt);
      setTextInput('');
      return;
    }

    if (activeTool === 'eraser') {
      setIsDrawing(true);
      setEraserPos(pt);
      const radius = activeWidth * 2.2 || 24;
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

    if (activeTool === 'select') {
      if (isMovingSelection && moveStartPoint) {
        const dx = pt.x - moveStartPoint.x;
        const dy = pt.y - moveStartPoint.y;
        const moved = initialSelectedStrokesRef.current.map((s) => moveStroke(s, dx, dy));
        const updateMap = new Map(moved.map((s) => [s.id, s]));
        const updatedAll = strokes.map((s) => updateMap.get(s.id) || s);
        setStrokes(updatedAll);
        return;
      }
      if (isDrawing && startPoint) {
        const box = { x1: startPoint.x, y1: startPoint.y, x2: pt.x, y2: pt.y };
        setSelectionBox(box);
        const found = strokes.filter((s) => isStrokeInRect(s, box)).map((s) => s.id);
        setSelectedStrokeIds(found);
        return;
      }
      return;
    }

    if (activeTool === 'eraser') {
      setEraserPos(pt);
      if (isDrawing) {
        const radius = activeWidth * 2.2 || 24;
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
    const isGeom = isGeomTool(activeTool);

    if (isGeom && startPoint) {
      redraw(undefined, { x1: startPoint.x, y1: startPoint.y, x2: pt.x, y2: pt.y });
    } else {
      const updated = [...currentPoints, pt];
      setCurrentPoints(updated);
      redraw(updated);
    }
  };

  const handlePointerUp = (e: React.MouseEvent | React.TouchEvent) => {
    if (activeTool === 'select') {
      if (isMovingSelection && moveStartPoint) {
        const pt = getCoords(e);
        const dx = pt.x - moveStartPoint.x;
        const dy = pt.y - moveStartPoint.y;
        if (Math.hypot(dx, dy) > 2) {
          const moved = initialSelectedStrokesRef.current.map((s) => moveStroke(s, dx, dy));
          const updateMap = new Map(moved.map((s) => [s.id, s]));
          const updatedAll = strokes.map((s) => updateMap.get(s.id) || s);
          setUndoStack((prev) => [...prev, strokes]);
          setStrokes(updatedAll);
          onChange({ strokes: updatedAll, bgColor, bgPattern });
        }
        setIsMovingSelection(false);
        setMoveStartPoint(null);
      }
      if (isDrawing && startPoint) {
        setSelectionBox(null);
        setStartPoint(null);
        setIsDrawing(false);
      }
      return;
    }

    if (activeTool === 'eraser') {
      setIsDrawing(false);
      setEraserPos(null);
      redraw();
      return;
    }

    if (!isDrawing) return;
    setIsDrawing(false);
    const endPt = getCoords(e);
    const isGeom = isGeomTool(activeTool);
    const width = activeTool === 'highlighter' ? 22 : activeWidth;

    const newStroke: Stroke = {
      id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      tool: activeTool,
      color: activeColor,
      width,
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
          background: 'var(--bg-surface-elevated)',
          borderBottom: '1px solid var(--border-subtle)',
          flexWrap: 'wrap',
          gap: '4px',
          zIndex: 10,
        }}
      >
        {/* Drawing, Selection & Shape Tools */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
          {[
            { id: 'select', icon: MousePointer, label: 'Select & Move / Copy-Paste', defColor: '#6366f1' },
            { id: 'pen', icon: Pencil, label: 'Fine Pen (4px)', defColor: '#6366f1' },
            { id: 'brush', icon: PenTool, label: 'Brush Pen (8px)', defColor: '#06b6d4' },
            { id: 'highlighter', icon: Highlighter, label: 'Highlighter (22px)', defColor: '#f59e0b' },
            { id: 'temp_pen', icon: Clock, label: 'Temp Ink (3s)', defColor: '#38bdf8' },
            { id: 'eraser', icon: Eraser, label: 'Precision Eraser', defColor: '#ffffff' },
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
                title={`${t.label}`}
                style={{
                  background: isActive ? 'var(--primary-glow, rgba(99, 102, 241, 0.35))' : 'transparent',
                  borderColor: isActive ? 'var(--primary)' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderRadius: '4px',
                  padding: '3px 6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <Icon size={13} color={isActive ? toolColor : 'currentColor'} />
              </button>
            );
          })}

          <div style={{ width: '1px', height: '12px', background: 'var(--border-subtle)', margin: '0 2px' }} />

          {/* Drawer Toggles */}
          <button
            type="button"
            onClick={() => {
              setShowShapesDrawer(!showShapesDrawer);
              setShowDsaDrawer(false);
              setShowArchDrawer(false);
              setShowBgDrawer(false);
            }}
            style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '4px',
              border: '1px solid var(--border-subtle)',
              background: showShapesDrawer ? 'var(--primary-glow, rgba(99, 102, 241, 0.25))' : 'transparent',
              color: showShapesDrawer ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            🔷 Shapes {showShapesDrawer ? '▲' : '▼'}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowDsaDrawer(!showDsaDrawer);
              setShowShapesDrawer(false);
              setShowArchDrawer(false);
              setShowBgDrawer(false);
            }}
            style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '4px',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              background: showDsaDrawer ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
              color: showDsaDrawer ? '#38bdf8' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            🔲 DSA {showDsaDrawer ? '▲' : '▼'}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowArchDrawer(!showArchDrawer);
              setShowShapesDrawer(false);
              setShowDsaDrawer(false);
              setShowBgDrawer(false);
            }}
            style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '4px',
              border: '1px solid var(--border-subtle)',
              background: showArchDrawer ? 'var(--primary-glow, rgba(99, 102, 241, 0.25))' : 'transparent',
              color: showArchDrawer ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            🏛️ Arch {showArchDrawer ? '▲' : '▼'}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowBgDrawer(!showBgDrawer);
              setShowShapesDrawer(false);
              setShowDsaDrawer(false);
              setShowArchDrawer(false);
            }}
            style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '4px',
              border: '1px solid var(--border-subtle)',
              background: showBgDrawer ? 'var(--primary-glow, rgba(99, 102, 241, 0.25))' : 'transparent',
              color: showBgDrawer ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            🎨 Grid &amp; BG {showBgDrawer ? '▲' : '▼'}
          </button>
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
            title="Undo"
            style={{
              background: 'none',
              border: 'none',
              color: undoStack.length > 0 ? 'var(--text-primary)' : 'var(--text-dim)',
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
            title="Clear Sketchpad"
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

      {/* ─── Drawer: Shapes ─── */}
      {showShapesDrawer && (
        <div style={{ display: 'flex', gap: '3px', padding: '3px 8px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
          {[
            { id: 'line', label: 'Line 📏' },
            { id: 'arrow', label: 'Arrow ➡️' },
            { id: 'arrow_bi', label: 'Bi-Arrow ↔️' },
            { id: 'rect', label: 'Rect 🔲' },
            { id: 'rounded_rect', label: 'Rounded ▢' },
            { id: 'circle', label: 'Circle ⭕' },
            { id: 'triangle', label: 'Triangle ▲' },
            { id: 'decision_diamond', label: 'Diamond 💎' },
            { id: 'sticky_note', label: 'Sticky 📝' },
            { id: 'code_box', label: 'Code </>' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTool(t.id)}
              style={{
                fontSize: '9.5px',
                padding: '2px 6px',
                borderRadius: '3px',
                border: activeTool === t.id ? '1px solid var(--primary)' : '1px solid transparent',
                background: activeTool === t.id ? 'var(--primary-glow, rgba(99, 102, 241, 0.3))' : 'var(--bg-hover)',
                color: activeTool === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ─── Drawer: DSA Tools ─── */}
      {showDsaDrawer && (
        <div style={{ display: 'flex', gap: '3px', padding: '3px 8px', background: 'var(--bg-card)', borderBottom: '1px solid rgba(56, 189, 248, 0.3)', overflowX: 'auto' }}>
          {[
            { id: 'array_cells', label: 'Array [0..N]' },
            { id: 'two_pointers', label: 'Two Pointers (L/R)' },
            { id: 'stack_lifo', label: 'Stack (LIFO)' },
            { id: 'queue_fifo', label: 'Queue (FIFO)' },
            { id: 'tree_node', label: 'Tree Node' },
            { id: 'hashmap_table', label: 'HashMap Bucket' },
            { id: 'decision_diamond', label: 'Branch Diamond' },
            { id: 'code_box', label: 'Pseudocode Box' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTool(t.id)}
              style={{
                fontSize: '9.5px',
                padding: '2px 6px',
                borderRadius: '3px',
                border: activeTool === t.id ? '1px solid #38bdf8' : '1px solid transparent',
                background: activeTool === t.id ? 'rgba(56, 189, 248, 0.3)' : 'var(--bg-hover)',
                color: activeTool === t.id ? '#ffffff' : '#7dd3fc',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ─── Drawer: Architecture Tools ─── */}
      {showArchDrawer && (
        <div style={{ display: 'flex', gap: '3px', padding: '3px 8px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
          {[
            { id: 'db_cylinder', label: 'SQL DB' },
            { id: 'db_nosql', label: 'NoSQL' },
            { id: 'cache_mem', label: 'Redis' },
            { id: 'message_queue', label: 'Kafka' },
            { id: 'load_balancer', label: 'LB' },
            { id: 'server_box', label: 'App Server' },
            { id: 'cloud', label: 'API GW' },
            { id: 'cdn_edge', label: 'CDN Edge' },
            { id: 'object_storage', label: 'S3 Storage' },
            { id: 'auth_jwt', label: 'JWT Shield' },
            { id: 'tradeoff_note', label: '⚖️ CAP Card' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTool(t.id)}
              style={{
                fontSize: '9.5px',
                padding: '2px 6px',
                borderRadius: '3px',
                border: activeTool === t.id ? '1px solid var(--primary)' : '1px solid transparent',
                background: activeTool === t.id ? 'var(--primary-glow, rgba(99, 102, 241, 0.3))' : 'var(--bg-hover)',
                color: activeTool === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}



      {/* ─── Drawer: Background & Themes ─── */}
      {showBgDrawer && (
        <div style={{ display: 'flex', gap: '4px', padding: '4px 8px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
          {BG_PRESETS.map((bp) => (
            <button
              key={bp.id}
              type="button"
              onClick={() => {
                setBgColor(bp.color);
                setBgPattern(bp.pattern);
                onChange({ strokes, bgColor: bp.color, bgPattern: bp.pattern });
              }}
              style={{
                fontSize: '9px',
                padding: '2px 6px',
                borderRadius: '3px',
                border: bgColor === bp.color && bgPattern === bp.pattern ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                background: bgColor === bp.color && bgPattern === bp.pattern ? 'var(--primary-glow, rgba(99, 102, 241, 0.25))' : 'var(--bg-hover)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {bp.label}
            </button>
          ))}
        </div>
      )}

      {/* ─── Canvas Workspace ─── */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Floating Selection Action Bar for Copy, Duplicate, Paste, Delete & Deselect */}
        {selectedStrokeIds.length > 0 && (() => {
          const b = getSelectedBounds();
          if (!b) return null;
          const screenX = Math.max(10, Math.min((containerRef.current?.clientWidth || 400) - 240, b.minX));
          const screenY = Math.max(10, b.minY - 36);

          return (
            <div
              style={{
                position: 'absolute',
                left: `${screenX}px`,
                top: `${screenY}px`,
                zIndex: 60,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-medium, var(--border-subtle))',
                borderRadius: '6px',
                padding: '3px 6px',
                boxShadow: '0 4px 15px rgba(0, 0, 0, 0.4)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--primary)', paddingRight: '2px' }}>
                {selectedStrokeIds.length} sel
              </span>
              <button
                type="button"
                onClick={handleCopySelected}
                title="Copy Selection (Ctrl+C)"
                style={{
                  background: 'var(--bg-hover)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '4px',
                  color: 'var(--text-primary)',
                  fontSize: '9.5px',
                  padding: '2px 6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <Copy size={10} />
                <span>Copy</span>
              </button>
              <button
                type="button"
                onClick={handleDuplicateSelected}
                title="Duplicate Selection (Ctrl+D)"
                style={{
                  background: 'var(--bg-hover)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '4px',
                  color: 'var(--text-primary)',
                  fontSize: '9.5px',
                  padding: '2px 6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <Plus size={10} />
                <span>Dup</span>
              </button>
              {clipboardStrokes.length > 0 && (
                <button
                  type="button"
                  onClick={handlePasteSelected}
                  title="Paste (Ctrl+V)"
                  style={{
                    background: 'var(--bg-hover)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '4px',
                    color: 'var(--text-primary)',
                    fontSize: '9.5px',
                    padding: '2px 6px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px',
                  }}
                >
                  <Clipboard size={10} />
                  <span>Paste</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleDeleteSelected}
                title="Delete Selection (Del)"
                style={{
                  background: 'rgba(244, 63, 94, 0.15)',
                  border: '1px solid rgba(244, 63, 94, 0.35)',
                  borderRadius: '4px',
                  color: '#f43f5e',
                  fontSize: '9.5px',
                  padding: '2px 6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <Trash2 size={10} />
              </button>
              <button
                type="button"
                onClick={handleDeselect}
                title="Deselect (Esc)"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  padding: '2px 4px',
                  cursor: 'pointer',
                }}
              >
                <X size={11} />
              </button>
            </div>
          );
        })()}

        <canvas
          ref={canvasRef}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onTouchStart={handlePointerDown}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
          style={{ width: '100%', height: '100%', display: 'block', cursor: activeTool === 'select' ? 'default' : activeTool === 'text' ? 'text' : activeTool === 'eraser' ? 'cell' : 'crosshair' }}
        />

        {/* Inline Text Tool Modal */}
        {textModalPos && (
          <div
            style={{
              position: 'absolute',
              left: `${Math.min(textModalPos.x, (containerRef.current?.clientWidth || 300) - 180)}px`,
              top: `${Math.max(10, textModalPos.y - 35)}px`,
              zIndex: 50,
              background: 'var(--bg-surface-elevated)',
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
                background: 'var(--bg-hover)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '4px',
                color: activeColor,
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 6px',
                width: '120px',
                outline: 'none',
              }}
             aria-label="Type label"/>
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
