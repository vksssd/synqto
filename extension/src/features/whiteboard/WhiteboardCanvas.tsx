// ─── Collaborative Whiteboard Canvas: Multi-Page Notebook, Presets, Object Eraser & Real-Time Sync ───

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
  Flame,
  Lightbulb,
  Type,
  PenTool,
  Clock,
  Database,
  Cloud,
  Scale,
  Layers,
  Server,
  Zap,
  User,
  Plus,
  Copy,
  Clipboard,
  MousePointer,
  X,
  ExternalLink,
  Edit2,
  Shield,
  Smartphone,
  Globe,
  HelpCircle,
  StickyNote,
  Triangle,
  Star,
  Code,
  LayoutGrid,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Hand,
  Check,
  Share2,
} from 'lucide-react';
import { WhiteboardService } from './whiteboard.service';
import {
  WhiteboardToolType,
  WhiteboardBackgroundType,
  WhiteboardSizeMode,
  WhiteboardPrivacyMode,
  WhiteboardStroke,
  WhiteboardNotebook,
  Point,
} from './whiteboard.types';

const PEN_COLORS = [
  '#6366f1', // Indigo
  '#06b6d4', // Cyan
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#f43f5e', // Rose
  '#a855f7', // Purple
  '#ffffff', // White
  '#0f172a', // Dark Slate
];

const BG_COLORS = [
  { color: '#090d16', label: 'Dark Obsidian' },
  { color: '#0f172a', label: 'Midnight Slate' },
  { color: '#062c24', label: 'Deep Forest' },
  { color: '#fef3c7', label: 'Vintage Sepia' },
  { color: '#ffffff', label: 'Pure White' },
  { color: '#f8fafc', label: 'Soft Cream' },
  { color: '#1e1035', label: 'Deep Violet' },
];

const PEN_SIZES = [
  { label: 'S', size: 3 },
  { label: 'M', size: 5 },
  { label: 'L', size: 9 },
  { label: 'XL', size: 18 },
];

interface ToolStyle {
  color: string;
  width: number;
}

const DEFAULT_TOOL_STYLES: Record<string, ToolStyle> = {
  select: { color: '#6366f1', width: 3 },
  hand: { color: '#6366f1', width: 3 },
  pen: { color: '#6366f1', width: 4 },
  brush: { color: '#06b6d4', width: 8 },
  highlighter: { color: '#f59e0b', width: 22 },
  temp_pen: { color: '#38bdf8', width: 4 },
  laser: { color: '#ef4444', width: 4 },
  torch: { color: '#facc15', width: 75 },
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
  // DSA Data Structure Visualizers:
  array_cells: { color: '#38bdf8', width: 3 },
  stack_lifo: { color: '#f59e0b', width: 3 },
  queue_fifo: { color: '#10b981', width: 3 },
  hashmap_table: { color: '#a855f7', width: 3 },
  two_pointers: { color: '#ec4899', width: 2.5 },
  // Extended Architecture Nodes:
  cdn_edge: { color: '#06b6d4', width: 3 },
  object_storage: { color: '#f97316', width: 3 },
  auth_jwt: { color: '#eab308', width: 3 },
  websocket_gw: { color: '#6366f1', width: 3 },
  elasticsearch: { color: '#14b8a6', width: 3 },
  async_arrow: { color: '#a855f7', width: 2.5 },
  tradeoff_note: { color: '#facc15', width: 2.5 },
};

// ── Geometric Collision & Bounding Box Helpers ──
function distanceToLineSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

function getStrokeBounds(stroke: WhiteboardStroke): { minX: number; minY: number; maxX: number; maxY: number } {
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

function isStrokeInRect(stroke: WhiteboardStroke, rect: { x1: number; y1: number; x2: number; y2: number }): boolean {
  const rMinX = Math.min(rect.x1, rect.x2);
  const rMaxX = Math.max(rect.x1, rect.x2);
  const rMinY = Math.min(rect.y1, rect.y2);
  const rMaxY = Math.max(rect.y1, rect.y2);
  const b = getStrokeBounds(stroke);
  return !(b.maxX < rMinX || b.minX > rMaxX || b.maxY < rMinY || b.minY > rMaxY);
}

function moveStroke(stroke: WhiteboardStroke, dx: number, dy: number): WhiteboardStroke {
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

function isStrokeIntersectingEraser(stroke: WhiteboardStroke, eraserPt: Point, radius: number): boolean {
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

export const WhiteboardCanvas: React.FC = () => {
  const whiteboardService = WhiteboardService.getInstance();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [activeTool, setActiveTool] = useState<WhiteboardToolType>('pen');

  // Independent per-tool style dictionary (each pen remembers its own color and size)
  const [toolStyles, setToolStyles] = useState<Record<string, ToolStyle>>(() => {
    try {
      const saved = localStorage.getItem('synqto_wb_tool_styles');
      if (saved) return { ...DEFAULT_TOOL_STYLES, ...JSON.parse(saved) };
    } catch (e) {}
    return DEFAULT_TOOL_STYLES;
  });

  const activeColor = toolStyles[activeTool]?.color || DEFAULT_TOOL_STYLES[activeTool]?.color || '#6366f1';
  const activeWidth = toolStyles[activeTool]?.width || DEFAULT_TOOL_STYLES[activeTool]?.width || 3;

  // Background pattern & background color
  const [backgroundType, setBackgroundType] = useState<WhiteboardBackgroundType>(whiteboardService.getBackground());
  const [bgColor, setBgColor] = useState<string>(whiteboardService.getBgColor());

  // Notebook Pages State
  const [notebook, setNotebook] = useState<WhiteboardNotebook>(whiteboardService.getActiveNotebook());
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editingPageTitle, setEditingPageTitle] = useState<string>('');

  // Sizing & Privacy Mode
  const [sizeMode, setSizeMode] = useState<WhiteboardSizeMode>('full');
  const [privacyMode, setPrivacyMode] = useState<WhiteboardPrivacyMode>(whiteboardService.getPrivacyMode());
  const [customHeight, setCustomHeight] = useState<number>(420);

  // Zoom & Pan Viewport State
  const [zoom, setZoom] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [startPoint, setStartPoint] = useState<Point | null>(null);

  // Laser Pointer, Torch, and Eraser Position Indicators
  const [laserTrails, setLaserTrails] = useState<{ x: number; y: number; color: string; alpha: number; timestamp: number }[]>([]);
  const [torchPos, setTorchPos] = useState<{ x: number; y: number } | null>(null);
  const [eraserPos, setEraserPos] = useState<{ x: number; y: number } | null>(null);

  // Selection, Moving & Sectioning State
  const [selectedStrokeIds, setSelectedStrokeIds] = useState<string[]>([]);
  const [selectionBox, setSelectionBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [isMovingSelection, setIsMovingSelection] = useState(false);
  const [moveStartPoint, setMoveStartPoint] = useState<Point | null>(null);
  const [clipboardStrokes, setClipboardStrokes] = useState<WhiteboardStroke[]>([]);
  const initialSelectedStrokesRef = useRef<WhiteboardStroke[]>([]);

  // Toast / Notification for Undo on Clear / Copy
  const [undoToast, setUndoToast] = useState<string | null>(null);
  const [copiedToast, setCopiedToast] = useState(false);

  // Disappearing / Temporary Ink Strokes Pool
  const [tempStrokes, setTempStrokes] = useState<{ stroke: WhiteboardStroke; createdAt: number; durationMs: number }[]>([]);

  // Text Tool State
  const [textModalPos, setTextModalPos] = useState<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState('');

  // Collapsible drawers for toolbars
  const [showArchDrawer, setShowArchDrawer] = useState(false);
  const [showDsaDrawer, setShowDsaDrawer] = useState(false);
  const [showGeomDrawer, setShowGeomDrawer] = useState(false);
  const [showThemesDrawer, setShowThemesDrawer] = useState(false);

  // Calculate overall bounding box of currently selected strokes
  const getSelectedBounds = useCallback(() => {
    const strokes = whiteboardService.getStrokes();
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
  }, [selectedStrokeIds, whiteboardService]);

  // Copy selected strokes to clipboard
  const handleCopySelected = useCallback(() => {
    const strokes = whiteboardService.getStrokes();
    const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
    if (selected.length === 0) return;
    setClipboardStrokes(selected);
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 2000);
  }, [selectedStrokeIds, whiteboardService]);

  // Paste copied strokes
  const handlePasteSelected = useCallback(() => {
    if (clipboardStrokes.length === 0) return;
    const newStrokes = clipboardStrokes.map((s) => ({
      ...moveStroke(s, 24, 24),
      id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
    }));
    whiteboardService.addStrokes(newStrokes);
    setSelectedStrokeIds(newStrokes.map((s) => s.id));
    setClipboardStrokes(newStrokes);
  }, [clipboardStrokes, whiteboardService]);

  // Duplicate selected strokes
  const handleDuplicateSelected = useCallback(() => {
    const strokes = whiteboardService.getStrokes();
    const selected = strokes.filter((s) => selectedStrokeIds.includes(s.id));
    if (selected.length === 0) return;
    const newStrokes = selected.map((s) => ({
      ...moveStroke(s, 24, 24),
      id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
    }));
    whiteboardService.addStrokes(newStrokes);
    setSelectedStrokeIds(newStrokes.map((s) => s.id));
  }, [selectedStrokeIds, whiteboardService]);

  // Delete selected strokes
  const handleDeleteSelected = useCallback(() => {
    if (selectedStrokeIds.length === 0) return;
    whiteboardService.deleteStrokes(selectedStrokeIds);
    setSelectedStrokeIds([]);
  }, [selectedStrokeIds, whiteboardService]);

  // Deselect
  const handleDeselect = useCallback(() => {
    setSelectedStrokeIds([]);
    setSelectionBox(null);
  }, []);

  // Update active tool's independent color
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
        localStorage.setItem('synqto_wb_tool_styles', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  // Update active tool's independent stroke width
  const updateActiveToolWidth = (newWidth: number) => {
    setToolStyles((prev) => {
      const updated = {
        ...prev,
        [activeTool]: {
          ...(prev[activeTool] || { color: '#6366f1' }),
          width: newWidth,
        },
      };
      try {
        localStorage.setItem('synqto_wb_tool_styles', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  // 1. Subscribe to service listeners
  useEffect(() => {
    const unsubBg = whiteboardService.onBackgroundChange((bg) => setBackgroundType(bg));
    const unsubBgColor = whiteboardService.onBgColorChange((col) => setBgColor(col));
    const unsubPriv = whiteboardService.onPrivacyModeChange((m) => setPrivacyMode(m));
    const unsubNotebook = whiteboardService.onNotebookChange((nb) => setNotebook({ ...nb }));
    const unsubLaser = whiteboardService.onLaser((laser) => {
      setLaserTrails((prev) => [
        ...prev.slice(-40),
        { x: laser.x, y: laser.y, color: laser.color, alpha: 1.0, timestamp: Date.now() },
      ]);
    });
    const unsubTemp = whiteboardService.onTempStroke((stroke, durationMs) => {
      setTempStrokes((prev) => [...prev, { stroke, createdAt: Date.now(), durationMs }]);
    });

    return () => {
      unsubBg();
      unsubBgColor();
      unsubPriv();
      unsubNotebook();
      unsubLaser();
      unsubTemp();
    };
  }, [whiteboardService]);

  // Keyboard shortcuts for Section Selection, Copy, Paste, Duplicate, Delete, Deselect & Nudge
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
          const strokes = whiteboardService.getStrokes();
          const updated = strokes
            .filter((s) => selectedStrokeIds.includes(s.id))
            .map((s) => moveStroke(s, dx, dy));
          whiteboardService.updateStrokes(updated);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedStrokeIds, clipboardStrokes, handleCopySelected, handlePasteSelected, handleDuplicateSelected, handleDeleteSelected, handleDeselect, whiteboardService]);

  // 2. Animation loop for Laser trails & Disappearing Ink
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();

      setLaserTrails((prev) => {
        if (prev.length === 0) return prev;
        return prev
          .filter((pt) => now - pt.timestamp < 1200)
          .map((pt) => ({
            ...pt,
            alpha: Math.max(0, 1 - (now - pt.timestamp) / 1200),
          }));
      });

      setTempStrokes((prev) => {
        if (prev.length === 0) return prev;
        return prev.filter((item) => now - item.createdAt < item.durationMs);
      });
    }, 40);

    return () => clearInterval(interval);
  }, []);

  const isLightColor = useCallback((hex: string) => {
    return hex === '#ffffff' || hex === '#f8fafc' || hex === '#fef3c7';
  }, []);

  // 3. Background Pattern Renderer
  const drawBackground = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, bg: WhiteboardBackgroundType, color: string) => {
    ctx.save();
    const isLight = isLightColor(color);

    ctx.fillStyle = color || (isLight ? '#f8fafc' : '#090d16');
    ctx.fillRect(0, 0, w, h);

    if (bg === 'grid') {
      ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.04)';
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
    } else if (bg === 'ruled' || bg === 'white_ruled') {
      ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.09)' : 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      const lineStep = 28;
      for (let y = 35; y < h; y += lineStep) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(40, 0);
      ctx.lineTo(40, h);
      ctx.stroke();
    } else if (bg === 'dotted') {
      ctx.fillStyle = isLight ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.12)';
      const dotSpacing = 20;
      for (let x = 10; x < w; x += dotSpacing) {
        for (let y = 10; y < h; y += dotSpacing) {
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (bg === 'plot') {
      const midX = w / 2;
      const midY = h / 2;

      ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.03)';
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

      ctx.strokeStyle = isLight ? '#4f46e5' : '#818cf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.moveTo(midX, 0);
      ctx.lineTo(midX, h);
      ctx.stroke();
    } else if (bg === 'matrix') {
      ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      const cellSize = 40;
      for (let x = 20; x < w; x += cellSize) {
        for (let y = 20; y < h; y += cellSize) {
          ctx.strokeRect(x, y, cellSize, cellSize);
        }
      }
    } else if (bg === 'isometric') {
      ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      const isoStep = 30;
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
    }

    ctx.restore();
  }, [isLightColor]);

  // 4. Vector Shape & Stroke Renderer (Clean Vector & Smooth Bezier Curves)
  const renderSingleStroke = useCallback(
    (ctx: CanvasRenderingContext2D, stroke: WhiteboardStroke, isLight: boolean, alphaOverride?: number) => {
      if (stroke.tool === 'eraser') return;

      ctx.save();
      let drawColor = stroke.color;
      if (isLight && (drawColor === '#ffffff' || drawColor === '#fff')) {
        drawColor = '#0f172a';
      }

      ctx.strokeStyle = drawColor;
      ctx.fillStyle = drawColor;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = alphaOverride !== undefined ? alphaOverride : stroke.opacity;

      if (stroke.tool === 'brush') {
        ctx.lineCap = 'round';
        ctx.lineWidth = stroke.width * 1.4;
      } else if (stroke.tool === 'temp_pen') {
        ctx.shadowColor = drawColor;
        ctx.shadowBlur = 8;
      }

      if (stroke.text && stroke.geometry) {
        ctx.font = `bold ${Math.max(12, stroke.width * 3.5)}px -apple-system, sans-serif`;
        ctx.fillText(stroke.text, stroke.geometry.x1, stroke.geometry.y1);
      } else if (stroke.geometry) {
        const { x1, y1, x2, y2, label } = stroke.geometry;
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        const minX = Math.min(x1, x2);
        const minY = Math.min(y1, y2);

        // ── Geometric Shapes ──
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
        } else if (stroke.tool === 'arrow_bi') {
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
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 + headLen * Math.cos(angle - Math.PI / 6), y1 + headLen * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 + headLen * Math.cos(angle + Math.PI / 6), y1 + headLen * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
        } else if (stroke.tool === 'rect') {
          ctx.strokeRect(minX, minY, width, height);
        } else if (stroke.tool === 'rounded_rect') {
          ctx.beginPath();
          ctx.roundRect(minX, minY, width, height, 10);
          ctx.stroke();
        } else if (stroke.tool === 'circle') {
          const rx = width / 2;
          const ry = height / 2;
          ctx.beginPath();
          ctx.ellipse(minX + rx, minY + ry, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (stroke.tool === 'triangle') {
          ctx.beginPath();
          ctx.moveTo(minX + width / 2, minY);
          ctx.lineTo(minX + width, minY + height);
          ctx.lineTo(minX, minY + height);
          ctx.closePath();
          ctx.stroke();
        } else if (stroke.tool === 'star') {
          const cx = minX + width / 2;
          const cy = minY + height / 2;
          const spikes = 5;
          const outerRadius = Math.min(width, height) / 2;
          const innerRadius = outerRadius / 2;
          let rot = (Math.PI / 2) * 3;
          let x = cx;
          let y = cy;
          const step = Math.PI / spikes;

          ctx.beginPath();
          ctx.moveTo(cx, cy - outerRadius);
          for (let i = 0; i < spikes; i++) {
            x = cx + Math.cos(rot) * outerRadius;
            y = cy + Math.sin(rot) * outerRadius;
            ctx.lineTo(x, y);
            rot += step;

            x = cx + Math.cos(rot) * innerRadius;
            y = cy + Math.sin(rot) * innerRadius;
            ctx.lineTo(x, y);
            rot += step;
          }
          ctx.lineTo(cx, cy - outerRadius);
          ctx.closePath();
          ctx.stroke();
        } else if (stroke.tool === 'decision_diamond') {
          const midX = minX + width / 2;
          const midY = minY + height / 2;
          ctx.beginPath();
          ctx.moveTo(midX, minY);
          ctx.lineTo(minX + width, midY);
          ctx.lineTo(midX, minY + height);
          ctx.lineTo(minX, midY);
          ctx.closePath();
          ctx.stroke();
        } else if (stroke.tool === 'tree_node') {
          const radius = Math.max(16, stroke.width * 4);
          ctx.beginPath();
          ctx.arc(x1, y1, radius, 0, Math.PI * 2);
          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.fill();
          ctx.stroke();
        } else if (stroke.tool === 'sticky_note') {
          const w = Math.max(70, width);
          const h = Math.max(60, height);
          ctx.fillStyle = isLight ? '#fef3c7' : 'rgba(254, 243, 199, 0.9)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 6);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = 'rgba(0,0,0,0.15)';
          ctx.beginPath();
          ctx.moveTo(minX + w - 14, minY);
          ctx.lineTo(minX + w, minY + 14);
          ctx.lineTo(minX + w - 14, minY + 14);
          ctx.closePath();
          ctx.fill();
        } else if (stroke.tool === 'code_box') {
          const w = Math.max(90, width);
          const h = Math.max(50, height);
          ctx.fillStyle = isLight ? '#1e293b' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 6);
          ctx.fill();
          ctx.strokeStyle = '#38bdf8';
          ctx.stroke();

          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(minX + 8, minY + 8, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(minX + 16, minY + 8, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#10b981';
          ctx.beginPath();
          ctx.arc(minX + 24, minY + 8, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // ── System Design Architecture Shapes ──
        else if (stroke.tool === 'db_cylinder') {
          const w = Math.max(50, width);
          const h = Math.max(60, height);
          const ry = Math.min(14, h * 0.2);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.ellipse(minX + w / 2, minY + ry, w / 2, ry, 0, Math.PI, 0);
          ctx.lineTo(minX + w, minY + h - ry);
          ctx.ellipse(minX + w / 2, minY + h - ry, w / 2, ry, 0, 0, Math.PI);
          ctx.lineTo(minX, minY + ry);
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.ellipse(minX + w / 2, minY + ry, w / 2, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (stroke.tool === 'db_nosql') {
          const w = Math.max(50, width);
          const h = Math.max(65, height);
          const ry = Math.min(12, h * 0.18);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.ellipse(minX + w / 2, minY + ry, w / 2, ry, 0, Math.PI, 0);
          ctx.lineTo(minX + w, minY + h - ry);
          ctx.ellipse(minX + w / 2, minY + h - ry, w / 2, ry, 0, 0, Math.PI);
          ctx.lineTo(minX, minY + ry);
          ctx.fill();
          ctx.stroke();

          for (let i = 1; i <= 3; i++) {
            const bandY = minY + (h / 4) * i;
            ctx.beginPath();
            ctx.ellipse(minX + w / 2, bandY, w / 2, ry, 0, 0, Math.PI);
            ctx.stroke();
          }
        } else if (stroke.tool === 'cloud') {
          const w = Math.max(70, width);
          const h = Math.max(45, height);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.moveTo(minX + w * 0.2, minY + h * 0.7);
          ctx.bezierCurveTo(minX, minY + h * 0.7, minX, minY + h * 0.3, minX + w * 0.25, minY + h * 0.3);
          ctx.bezierCurveTo(minX + w * 0.2, minY, minX + w * 0.6, minY, minX + w * 0.65, minY + h * 0.25);
          ctx.bezierCurveTo(minX + w * 0.9, minY + h * 0.1, minX + w, minY + h * 0.5, minX + w * 0.85, minY + h * 0.7);
          ctx.bezierCurveTo(minX + w, minY + h * 0.95, minX + w * 0.7, minY + h, minX + w * 0.5, minY + h * 0.9);
          ctx.bezierCurveTo(minX + w * 0.3, minY + h, minX + w * 0.1, minY + h * 0.9, minX + w * 0.2, minY + h * 0.7);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (stroke.tool === 'load_balancer') {
          const w = Math.max(55, width);
          const h = Math.max(55, height);
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

          ctx.strokeStyle = drawColor;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(midX, midY - 10);
          ctx.lineTo(midX, midY + 10);
          ctx.moveTo(midX - 10, midY);
          ctx.lineTo(midX + 10, midY);
          ctx.stroke();
        } else if (stroke.tool === 'message_queue') {
          const w = Math.max(80, width);
          const h = Math.max(36, height);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 6);
          ctx.fill();
          ctx.stroke();

          const segs = 4;
          for (let i = 1; i < segs; i++) {
            const sx = minX + (w / segs) * i;
            ctx.beginPath();
            ctx.moveTo(sx, minY);
            ctx.lineTo(sx, minY + h);
            ctx.stroke();
          }
        } else if (stroke.tool === 'server_box') {
          const w = Math.max(70, width);
          const h = Math.max(45, height);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 6);
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(minX + 8, minY + h * 0.5);
          ctx.lineTo(minX + w - 8, minY + h * 0.5);
          ctx.stroke();

          ctx.fillStyle = '#10b981';
          ctx.beginPath();
          ctx.arc(minX + 10, minY + 10, 2.5, 0, Math.PI * 2);
          ctx.fill();
        } else if (stroke.tool === 'cache_mem') {
          const w = Math.max(65, width);
          const h = Math.max(38, height);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 4);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#f59e0b';
          const cx = minX + w / 2;
          const cy = minY + h / 2;
          ctx.beginPath();
          ctx.moveTo(cx + 2, cy - 10);
          ctx.lineTo(cx - 6, cy + 1);
          ctx.lineTo(cx, cy + 1);
          ctx.lineTo(cx - 2, cy + 10);
          ctx.lineTo(cx + 6, cy - 1);
          ctx.lineTo(cx, cy - 1);
          ctx.closePath();
          ctx.fill();
        } else if (stroke.tool === 'dns_router') {
          const r = Math.max(22, width / 2);
          const cx = minX + r;
          const cy = minY + r;

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(cx - r * 0.5, cy);
          ctx.lineTo(cx + r * 0.5, cy);
          ctx.moveTo(cx, cy - r * 0.5);
          ctx.lineTo(cx, cy + r * 0.5);
          ctx.stroke();
        } else if (stroke.tool === 'firewall') {
          const w = Math.max(50, width);
          const h = Math.max(60, height);
          const midX = minX + w / 2;

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.moveTo(minX + 6, minY + 6);
          ctx.lineTo(minX + w - 6, minY + 6);
          ctx.lineTo(minX + w - 6, minY + h * 0.5);
          ctx.bezierCurveTo(minX + w - 6, minY + h * 0.85, midX, minY + h, midX, minY + h);
          ctx.bezierCurveTo(midX, minY + h, minX + 6, minY + h * 0.85, minX + 6, minY + h * 0.5);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (stroke.tool === 'user_client') {
          const w = Math.max(45, width);
          const midX = minX + w / 2;

          ctx.beginPath();
          ctx.arc(midX, minY + 10, 7, 0, Math.PI * 2);
          ctx.moveTo(midX, minY + 17);
          ctx.lineTo(midX, minY + 32);
          ctx.lineTo(midX - 8, minY + 44);
          ctx.moveTo(midX, minY + 32);
          ctx.lineTo(midX + 8, minY + 44);
          ctx.moveTo(midX - 10, minY + 22);
          ctx.lineTo(midX + 10, minY + 22);
          ctx.stroke();
        } else if (stroke.tool === 'mobile_client') {
          const w = Math.max(34, width);
          const h = Math.max(54, height);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 6);
          ctx.fill();
          ctx.stroke();

          ctx.strokeRect(minX + 4, minY + 6, w - 8, h - 16);
          ctx.beginPath();
          ctx.arc(minX + w / 2, minY + h - 5, 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (stroke.tool === 'array_cells') {
          const w = Math.max(140, width);
          const h = Math.max(34, height);
          const cells = 5;
          const cellW = w / cells;

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 4);
          ctx.fill();
          ctx.stroke();

          for (let i = 1; i < cells; i++) {
            ctx.beginPath();
            ctx.moveTo(minX + i * cellW, minY);
            ctx.lineTo(minX + i * cellW, minY + h);
            ctx.stroke();
          }

          ctx.fillStyle = isLight ? '#64748b' : '#94a3b8';
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          for (let i = 0; i < cells; i++) {
            ctx.fillText(`[${i}]`, minX + i * cellW + cellW / 2, minY - 4);
          }
        } else if (stroke.tool === 'stack_lifo') {
          const w = Math.max(55, width);
          const h = Math.max(80, height);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.moveTo(minX, minY);
          ctx.lineTo(minX, minY + h);
          ctx.lineTo(minX + w, minY + h);
          ctx.lineTo(minX + w, minY);
          ctx.stroke();

          const items = 3;
          for (let i = 1; i <= items; i++) {
            const sy = minY + h - (h / 4) * i;
            ctx.beginPath();
            ctx.moveTo(minX + 3, sy);
            ctx.lineTo(minX + w - 3, sy);
            ctx.stroke();
          }

          ctx.fillStyle = '#f59e0b';
          ctx.font = 'bold 8px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('TOP (LIFO)', minX + w / 2, minY - 4);
        } else if (stroke.tool === 'queue_fifo') {
          const w = Math.max(90, width);
          const h = Math.max(34, height);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.moveTo(minX, minY);
          ctx.lineTo(minX + w, minY);
          ctx.moveTo(minX, minY + h);
          ctx.lineTo(minX + w, minY + h);
          ctx.stroke();

          for (let i = 1; i <= 3; i++) {
            const sx = minX + (w / 4) * i;
            ctx.beginPath();
            ctx.moveTo(sx, minY + 3);
            ctx.lineTo(sx, minY + h - 3);
            ctx.stroke();
          }

          ctx.fillStyle = '#10b981';
          ctx.font = 'bold 8px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('OUT ⬅️', minX - 14, minY + h / 2 + 3);
          ctx.fillText('⬅️ IN', minX + w + 14, minY + h / 2 + 3);
        } else if (stroke.tool === 'hashmap_table') {
          const w = Math.max(100, width);
          const h = Math.max(65, height);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 4);
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(minX, minY + 16);
          ctx.lineTo(minX + w, minY + 16);
          ctx.moveTo(minX + w * 0.45, minY);
          ctx.lineTo(minX + w * 0.45, minY + h);
          ctx.stroke();

          ctx.fillStyle = '#a855f7';
          ctx.font = 'bold 8.5px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Key', minX + w * 0.22, minY + 11);
          ctx.fillText('Value', minX + w * 0.72, minY + 11);
        } else if (stroke.tool === 'two_pointers') {
          const ptrW = 16;
          const ptrH = 20;
          const cx = minX + width / 2;

          ctx.fillStyle = drawColor;
          ctx.beginPath();
          ctx.moveTo(cx, minY);
          ctx.lineTo(cx - ptrW / 2, minY + ptrH);
          ctx.lineTo(cx + ptrW / 2, minY + ptrH);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          if (label) {
            ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(label, cx, minY + ptrH + 12);
          }
        } else if (stroke.tool === 'cdn_edge') {
          const w = Math.max(60, width);
          const h = Math.max(50, height);
          const cx = minX + w / 2;
          const cy = minY + h / 2;

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.strokeStyle = '#06b6d4';
          ctx.beginPath();
          ctx.arc(cx, cy, Math.min(w, h) * 0.25, -Math.PI * 0.4, Math.PI * 0.4);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx, cy, Math.min(w, h) * 0.4, -Math.PI * 0.4, Math.PI * 0.4);
          ctx.stroke();
        } else if (stroke.tool === 'object_storage') {
          const w = Math.max(50, width);
          const h = Math.max(55, height);
          const cx = minX + w / 2;

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.moveTo(minX + 6, minY + 14);
          ctx.lineTo(minX + 10, minY + h);
          ctx.lineTo(minX + w - 10, minY + h);
          ctx.lineTo(minX + w - 6, minY + 14);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.ellipse(cx, minY + 14, (w - 12) / 2, 7, 0, 0, Math.PI * 2);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(cx, minY + 12, (w - 16) / 2, Math.PI, 0);
          ctx.stroke();
        } else if (stroke.tool === 'auth_jwt') {
          const w = Math.max(46, width);
          const h = Math.max(54, height);
          const midX = minX + w / 2;

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.moveTo(minX + 4, minY + 4);
          ctx.lineTo(minX + w - 4, minY + 4);
          ctx.lineTo(minX + w - 4, minY + h * 0.5);
          ctx.bezierCurveTo(minX + w - 4, minY + h * 0.85, midX, minY + h, midX, minY + h);
          ctx.bezierCurveTo(midX, minY + h, minX + 4, minY + h * 0.85, minX + 4, minY + h * 0.5);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#eab308';
          ctx.beginPath();
          ctx.arc(midX, minY + 18, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(midX - 2, minY + 20);
          ctx.lineTo(midX - 3, minY + 28);
          ctx.lineTo(midX + 3, minY + 28);
          ctx.lineTo(midX + 2, minY + 20);
          ctx.closePath();
          ctx.fill();
        } else if (stroke.tool === 'websocket_gw') {
          const w = Math.max(60, width);
          const h = Math.max(45, height);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 6);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#6366f1';
          const cx = minX + w / 2;
          const cy = minY + h / 2;
          ctx.beginPath();
          ctx.moveTo(cx - 6, cy - 10);
          ctx.lineTo(cx - 12, cy + 1);
          ctx.lineTo(cx - 7, cy + 1);
          ctx.lineTo(cx - 9, cy + 10);
          ctx.lineTo(cx - 3, cy - 1);
          ctx.lineTo(cx - 8, cy - 1);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(cx + 6, cy - 10);
          ctx.lineTo(cx, cy + 1);
          ctx.lineTo(cx + 5, cy + 1);
          ctx.lineTo(cx + 3, cy + 10);
          ctx.lineTo(cx + 9, cy - 1);
          ctx.lineTo(cx + 4, cy - 1);
          ctx.closePath();
          ctx.fill();
        } else if (stroke.tool === 'elasticsearch') {
          const w = Math.max(60, width);
          const h = Math.max(45, height);
          const cx = minX + w / 2;
          const cy = minY + h / 2;

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 6);
          ctx.fill();
          ctx.stroke();

          ctx.strokeStyle = '#14b8a6';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx - 3, cy - 3, 7, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx + 2, cy + 2);
          ctx.lineTo(cx + 8, cy + 8);
          ctx.stroke();
        } else if (stroke.tool === 'async_arrow') {
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.restore();

          const angle = Math.atan2(y2 - y1, x2 - x1);
          const headLen = Math.max(10, stroke.width * 3);
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
        } else if (stroke.tool === 'tradeoff_note') {
          const w = Math.max(110, width);
          const h = Math.max(55, height);

          ctx.fillStyle = isLight ? '#fef9c3' : 'rgba(254, 240, 138, 0.15)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 6);
          ctx.fill();
          ctx.strokeStyle = '#facc15';
          ctx.stroke();

          ctx.fillStyle = '#ca8a04';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('⚖️ Trade-off / CAP', minX + w / 2, minY + 12);
        }

        if (label && label.trim()) {
          ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, minX + width / 2, minY + height / 2);
        }
      } else if (stroke.points && stroke.points.length > 0) {
        if (stroke.points.length === 1) {
          ctx.beginPath();
          ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
          for (let i = 1; i < stroke.points.length - 1; i++) {
            const midX = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
            const midY = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
            ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, midX, midY);
          }
          ctx.lineTo(stroke.points[stroke.points.length - 1].x, stroke.points[stroke.points.length - 1].y);
          ctx.stroke();
        }
      }

      ctx.restore();
    },
    []
  );

  // 5. Master Canvas Redraw (with Zoom and Pan support)
  const redrawCanvas = useCallback(
    (strokes: WhiteboardStroke[], previewPoints?: Point[], previewGeometry?: any) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const isLight = isLightColor(bgColor);

      ctx.save();
      // Clear entire canvas frame
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Apply Zoom & Pan Transform
      ctx.translate(panOffset.x, panOffset.y);
      ctx.scale(zoom, zoom);

      drawBackground(ctx, w / zoom + Math.abs(panOffset.x) * 2, h / zoom + Math.abs(panOffset.y) * 2, backgroundType, bgColor);
      strokes.forEach((s) => renderSingleStroke(ctx, s, isLight));

      const now = Date.now();
      tempStrokes.forEach((item) => {
        const elapsed = now - item.createdAt;
        const alpha = Math.max(0, 1 - elapsed / item.durationMs);
        renderSingleStroke(ctx, item.stroke, isLight, alpha);
      });

      if (previewGeometry) {
        renderSingleStroke(
          ctx,
          {
            id: 'preview',
            peerId: 'local',
            nickname: 'You',
            tool: activeTool,
            color: activeColor,
            width: activeTool === 'highlighter' ? 16 : activeWidth,
            opacity: activeTool === 'highlighter' ? 0.35 : 1.0,
            points: [],
            geometry: previewGeometry,
            timestamp: Date.now(),
          },
          isLight
        );
      } else if (previewPoints && previewPoints.length > 1) {
        renderSingleStroke(
          ctx,
          {
            id: 'preview',
            peerId: 'local',
            nickname: 'You',
            tool: activeTool,
            color: activeColor,
            width: activeTool === 'highlighter' ? 16 : activeWidth,
            opacity: activeTool === 'highlighter' ? 0.35 : 1.0,
            points: previewPoints,
            timestamp: Date.now(),
          },
          isLight
        );
      }

      // Spotlight Torch
      if (activeTool === 'torch' && torchPos) {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(0, 0, w / zoom, h / zoom);

        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(torchPos.x, torchPos.y, 65, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(253, 224, 71, 0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(torchPos.x, torchPos.y, 65, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Eraser Radius Indicator
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

      // Laser Trails
      laserTrails.forEach((pt) => {
        ctx.save();
        ctx.globalAlpha = pt.alpha;
        ctx.fillStyle = pt.color || '#ef4444';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5 * pt.alpha, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // Selection Box (Marquee Drag)
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

      // Selected Strokes Highlight Bounding Box & Handles
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

      ctx.restore();
    },
    [activeTool, activeColor, activeWidth, backgroundType, bgColor, drawBackground, isLightColor, laserTrails, renderSingleStroke, tempStrokes, torchPos, eraserPos, zoom, panOffset, selectionBox, selectedStrokeIds]
  );

  // Resize listener
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = (sizeMode === 'half' ? 300 : sizeMode === 'custom' ? customHeight : rect.height) * dpr;

      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);

      redrawCanvas(whiteboardService.getStrokes());
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [redrawCanvas, whiteboardService, sizeMode, customHeight]);

  // Subscribe to strokes
  useEffect(() => {
    return whiteboardService.onStrokesChange((strokes) => {
      redrawCanvas(strokes);
    });
  }, [redrawCanvas, whiteboardService]);

  const getCanvasCoords = (e: React.MouseEvent | React.TouchEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    let clientX = 0;
    let clientY = 0;

    if ('touches' in e) {
      const touch = e.touches[0] || (e.changedTouches && e.changedTouches[0]);
      if (touch) {
        clientX = touch.clientX;
        clientY = touch.clientY;
      }
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    // Convert to un-zoomed, un-panned canvas coordinate space
    return {
      x: (clientX - rect.left - panOffset.x) / zoom,
      y: (clientY - rect.top - panOffset.y) / zoom,
    };
  };

  const isShapeTool = [
    'line',
    'arrow',
    'arrow_bi',
    'rect',
    'rounded_rect',
    'circle',
    'triangle',
    'star',
    'decision_diamond',
    'tree_node',
    'sticky_note',
    'code_box',
    'db_cylinder',
    'db_nosql',
    'cloud',
    'load_balancer',
    'message_queue',
    'server_box',
    'cache_mem',
    'dns_router',
    'firewall',
    'user_client',
    'mobile_client',
    'array_cells',
    'stack_lifo',
    'queue_fifo',
    'hashmap_table',
    'two_pointers',
    'cdn_edge',
    'object_storage',
    'auth_jwt',
    'websocket_gw',
    'elasticsearch',
    'async_arrow',
    'tradeoff_note',
  ].includes(activeTool);

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (activeTool === 'hand') {
      setIsPanning(true);
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
      setPanStart({ x: clientX - panOffset.x, y: clientY - panOffset.y });
      return;
    }

    const pt = getCanvasCoords(e);

    if (activeTool === 'select') {
      const strokes = whiteboardService.getStrokes();
      const selBounds = getSelectedBounds();

      // Check if clicking inside current selection bounding box to drag/move
      if (selBounds && pt.x >= selBounds.minX && pt.x <= selBounds.maxX && pt.y >= selBounds.minY && pt.y <= selBounds.maxY) {
        setIsMovingSelection(true);
        setMoveStartPoint(pt);
        initialSelectedStrokesRef.current = strokes.filter((s) => selectedStrokeIds.includes(s.id)).map((s) => JSON.parse(JSON.stringify(s)));
        return;
      }

      // Check if clicked directly on any stroke
      const hitStroke = [...strokes].reverse().find((s) => isStrokeIntersectingEraser(s, pt, 12));
      if (hitStroke) {
        const isShift = (e as React.MouseEvent).shiftKey;
        if (isShift) {
          setSelectedStrokeIds((prev) => prev.includes(hitStroke.id) ? prev.filter((id) => id !== hitStroke.id) : [...prev, hitStroke.id]);
        } else {
          setSelectedStrokeIds([hitStroke.id]);
        }
        setIsMovingSelection(true);
        setMoveStartPoint(pt);
        initialSelectedStrokesRef.current = [JSON.parse(JSON.stringify(hitStroke))];
        return;
      }

      // Clicked on empty space: start marquee selection box
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
      const strokes = whiteboardService.getStrokes();
      const toDelete = strokes.filter((s) => isStrokeIntersectingEraser(s, pt, radius)).map((s) => s.id);
      if (toDelete.length > 0) {
        whiteboardService.deleteStrokes(toDelete);
      }
      redrawCanvas(whiteboardService.getStrokes());
      return;
    }

    if (activeTool === 'laser') {
      whiteboardService.broadcastLaser(pt.x, pt.y);
      return;
    }

    if (activeTool === 'torch') {
      setTorchPos(pt);
      redrawCanvas(whiteboardService.getStrokes());
      return;
    }

    setIsDrawing(true);
    setStartPoint(pt);
    setCurrentPoints([pt]);
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (activeTool === 'hand' && isPanning) {
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
      setPanOffset({ x: clientX - panStart.x, y: clientY - panStart.y });
      return;
    }

    const pt = getCanvasCoords(e);

    if (activeTool === 'select') {
      if (isMovingSelection && moveStartPoint) {
        const dx = pt.x - moveStartPoint.x;
        const dy = pt.y - moveStartPoint.y;
        const moved = initialSelectedStrokesRef.current.map((s) => moveStroke(s, dx, dy));
        const updateMap = new Map(moved.map((s) => [s.id, s]));
        const updatedAll = whiteboardService.getStrokes().map((s) => updateMap.get(s.id) || s);
        redrawCanvas(updatedAll);
        return;
      }
      if (isDrawing && startPoint) {
        const box = { x1: startPoint.x, y1: startPoint.y, x2: pt.x, y2: pt.y };
        setSelectionBox(box);
        const found = whiteboardService.getStrokes().filter((s) => isStrokeInRect(s, box)).map((s) => s.id);
        setSelectedStrokeIds(found);
        redrawCanvas(whiteboardService.getStrokes());
        return;
      }
      return;
    }

    if (activeTool === 'eraser') {
      setEraserPos(pt);
      if (isDrawing) {
        const radius = activeWidth * 2.2 || 24;
        const strokes = whiteboardService.getStrokes();
        const toDelete = strokes.filter((s) => isStrokeIntersectingEraser(s, pt, radius)).map((s) => s.id);
        if (toDelete.length > 0) {
          whiteboardService.deleteStrokes(toDelete);
        }
      }
      redrawCanvas(whiteboardService.getStrokes());
      return;
    }

    if (activeTool === 'laser') {
      whiteboardService.broadcastLaser(pt.x, pt.y);
      return;
    }

    if (activeTool === 'torch') {
      setTorchPos(pt);
      redrawCanvas(whiteboardService.getStrokes());
      return;
    }

    if (!isDrawing) return;

    if (isShapeTool && startPoint) {
      redrawCanvas(whiteboardService.getStrokes(), undefined, {
        x1: startPoint.x,
        y1: startPoint.y,
        x2: pt.x,
        y2: pt.y,
      });
    } else {
      const updated = [...currentPoints, pt];
      setCurrentPoints(updated);
      redrawCanvas(whiteboardService.getStrokes(), updated);
    }
  };

  const handlePointerUp = (e: React.MouseEvent | React.TouchEvent) => {
    if (activeTool === 'hand') {
      setIsPanning(false);
      return;
    }

    if (activeTool === 'select') {
      if (isMovingSelection && moveStartPoint) {
        const pt = getCanvasCoords(e);
        const dx = pt.x - moveStartPoint.x;
        const dy = pt.y - moveStartPoint.y;
        if (Math.hypot(dx, dy) > 2) {
          const moved = initialSelectedStrokesRef.current.map((s) => moveStroke(s, dx, dy));
          whiteboardService.updateStrokes(moved);
        }
        setIsMovingSelection(false);
        setMoveStartPoint(null);
      }
      if (isDrawing && startPoint) {
        setSelectionBox(null);
        setStartPoint(null);
        setIsDrawing(false);
      }
      redrawCanvas(whiteboardService.getStrokes());
      return;
    }

    if (activeTool === 'eraser') {
      setIsDrawing(false);
      setEraserPos(null);
      redrawCanvas(whiteboardService.getStrokes());
      return;
    }

    if (activeTool === 'torch') {
      setTorchPos(null);
      redrawCanvas(whiteboardService.getStrokes());
      return;
    }

    if (!isDrawing) return;
    setIsDrawing(false);

    const endPt = getCanvasCoords(e);
    const strokeWidth = activeTool === 'highlighter' ? 22 : activeWidth;

    if (isShapeTool && startPoint) {
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
        }
      );
    } else if (currentPoints.length > 0) {
      whiteboardService.addStroke(activeTool, activeColor, strokeWidth, currentPoints);
    }

    setCurrentPoints([]);
    setStartPoint(null);
  };

  // Add Text Note on Canvas
  const handleConfirmText = () => {
    if (!textModalPos || !textInput.trim()) {
      setTextModalPos(null);
      return;
    }

    whiteboardService.addStroke(
      'text',
      activeColor,
      activeWidth,
      [],
      { x1: textModalPos.x, y1: textModalPos.y, x2: textModalPos.x, y2: textModalPos.y },
      textInput.trim()
    );

    setTextModalPos(null);
    setTextInput('');
  };

  // Background Pattern Selector
  const handleSelectBackground = (bg: WhiteboardBackgroundType) => {
    setBackgroundType(bg);
    whiteboardService.setBackground(bg);
  };

  // Background Color Selector
  const handleSelectBgColor = (col: string) => {
    setBgColor(col);
    whiteboardService.setBgColor(col);
  };

  // Standalone Popup Window Popout
  const handleOpenPopupStandaloneWindow = () => {
    if (typeof chrome !== 'undefined' && chrome.windows) {
      chrome.windows.create({
        url: chrome.runtime.getURL('sidepanel.html?view=whiteboard'),
        type: 'popup',
        width: 960,
        height: 720,
      });
    } else {
      window.open(window.location.href, '_blank', 'width=960,height=720');
    }
  };

  // Clear Canvas with instant Undo Banner
  const handleClearCanvas = () => {
    const strokeCount = whiteboardService.getStrokes().length;
    if (strokeCount === 0) return;
    whiteboardService.clearAll();
    setUndoToast(`Canvas cleared (${strokeCount} items removed)`);
    setTimeout(() => {
      setUndoToast(null);
    }, 5000);
  };

  // Export PNG
  const handleExportPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `synqto-notebook-${backgroundType}-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  };

  // Copy Canvas Image to Clipboard
  const handleCopyClipboard = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.toBlob(async (blob) => {
        if (blob && navigator.clipboard?.write) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          setCopiedToast(true);
          setTimeout(() => setCopiedToast(false), 2500);
        }
      });
    } catch (e) {
      console.warn('Clipboard copy not supported in this context', e);
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: bgColor || '#090d16',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* ─── 1. Multi-Page Notebook Navigation Bar ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '3px 8px',
          background: 'rgba(15, 23, 42, 0.98)',
          borderBottom: '1px solid var(--border-subtle)',
          overflowX: 'auto',
          gap: '4px',
          flexShrink: 0,
        }}
      >
        {/* Page Tabs */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          {notebook.pages.map((p) => {
            const isActive = notebook.activePageId === p.id;
            return (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 7px',
                  borderRadius: '4px',
                  background: isActive ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.35), rgba(139, 92, 246, 0.35))' : 'rgba(255,255,255,0.03)',
                  border: isActive ? '1px solid var(--primary)' : '1px solid transparent',
                  cursor: 'pointer',
                  color: isActive ? '#ffffff' : 'var(--text-muted)',
                  fontSize: '9.5px',
                  fontWeight: isActive ? 700 : 500,
                  whiteSpace: 'nowrap',
                }}
                onClick={() => whiteboardService.switchPage(p.id)}
              >
                {editingPageId === p.id ? (
                  <input
                    type="text"
                    value={editingPageTitle}
                    autoFocus
                    onChange={(e) => setEditingPageTitle(e.target.value)}
                    onBlur={() => {
                      whiteboardService.renamePage(p.id, editingPageTitle);
                      setEditingPageId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        whiteboardService.renamePage(p.id, editingPageTitle);
                        setEditingPageId(null);
                      }
                    }}
                    style={{
                      fontSize: '9px',
                      background: 'rgba(0,0,0,0.5)',
                      color: '#fff',
                      border: '1px solid var(--primary)',
                      borderRadius: '2px',
                      padding: '1px 3px',
                      width: '90px',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingPageId(p.id);
                      setEditingPageTitle(p.title);
                    }}
                  >
                    📄 {p.title}
                  </span>
                )}

                {isActive && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingPageId(p.id);
                      setEditingPageTitle(p.title);
                    }}
                    title="Rename Page Title"
                    style={{ background: 'none', border: 'none', color: '#c7d2fe', padding: 0, cursor: 'pointer' }}
                  >
                    <Edit2 size={9} />
                  </button>
                )}

                {notebook.pages.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      whiteboardService.deletePage(p.id);
                    }}
                    title="Delete Page"
                    style={{ background: 'none', border: 'none', color: '#f87171', padding: 0, cursor: 'pointer' }}
                  >
                    <X size={9} />
                  </button>
                )}
              </div>
            );
          })}

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => whiteboardService.addPage()}
            title="Add New Notebook Page"
            style={{ fontSize: '9.5px', padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '2px' }}
          >
            <Plus size={10} />
            <span>Page</span>
          </button>
        </div>

        {/* Action Right: Presets, Copy, Popout & Sync Status */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          <span
            style={{
              fontSize: '8.5px',
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: '4px',
              background: privacyMode === 'collaborative' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
              border: `1px solid ${privacyMode === 'collaborative' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.4)'}`,
              color: privacyMode === 'collaborative' ? '#34d399' : '#fbbf24',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
            }}
            title={privacyMode === 'collaborative' ? 'Real-time Synced across Draw Tab, Popups, Content Widgets & Mesh' : 'Private Offline Scratchpad'}
          >
            <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: privacyMode === 'collaborative' ? '#10b981' : '#f59e0b' }} />
            {privacyMode === 'collaborative' ? 'Synced ⚡' : 'Private 🔒'}
          </span>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => whiteboardService.duplicatePage(notebook.activePageId)}
            title="Duplicate Active Page"
            style={{ fontSize: '9px', padding: '2px 5px', color: 'var(--text-muted)' }}
          >
            <Copy size={9} style={{ marginRight: '2px' }} />
            <span>Duplicate</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleOpenPopupStandaloneWindow}
            title="Popout to Standalone Window"
            style={{ fontSize: '9px', padding: '2px 5px', color: 'var(--text-muted)' }}
          >
            <ExternalLink size={9} style={{ marginRight: '2px' }} />
            <span>Popout</span>
          </button>
        </div>
      </div>

      {/* ─── 2. Main Drawing Toolbar (Tools, Shapes, Presets, Eraser & Sync) ─── */}
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
          flexShrink: 0,
        }}
      >
        {/* Left Tools: Freehand, Selection, Presenter & Essential Tools */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
          {[
            { id: 'select', icon: MousePointer, label: '↖️ Select & Move / Copy-Paste (Ctrl+C/V/D)', defaultColor: '#6366f1' },
            { id: 'hand', icon: Hand, label: '🖐️ Pan Hand (Drag Canvas)', defaultColor: '#6366f1' },
            { id: 'pen', icon: Pencil, label: 'Fine Pen (Smooth)', defaultColor: '#6366f1' },
            { id: 'brush', icon: PenTool, label: 'Brush Pen', defaultColor: '#06b6d4' },
            { id: 'highlighter', icon: Highlighter, label: 'Highlighter', defaultColor: '#f59e0b' },
            { id: 'temp_pen', icon: Clock, label: '⏳ Temp Ink (3s)', defaultColor: '#38bdf8' },
            { id: 'laser', icon: Flame, label: '🔴 Laser Presenter', defaultColor: '#ef4444' },
            { id: 'torch', icon: Lightbulb, label: '🔦 Spotlight Torch', defaultColor: '#facc15' },
            { id: 'eraser', icon: Eraser, label: '🧹 Precision Object Eraser', defaultColor: '#ffffff' },
            { id: 'text', icon: Type, label: '🔤 Text Note', defaultColor: '#ffffff' },
            { id: 'code_box', icon: Code, label: '💻 Code Box', defaultColor: '#38bdf8' },
          ].map((t) => {
            const Icon = t.icon;
            const isActive = activeTool === t.id;
            const toolColor = toolStyles[t.id]?.color || t.defaultColor;

            return (
              <button
                key={t.id}
                type="button"
                className={`btn-icon ${isActive ? 'active' : ''}`}
                onClick={() => setActiveTool(t.id as any)}
                title={`${t.label}`}
                style={{
                  padding: '3px 6px',
                  borderRadius: '4px',
                  border: isActive ? '1px solid var(--primary)' : '1px solid transparent',
                  background: isActive ? 'var(--primary-glow, rgba(99, 102, 241, 0.25))' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <Icon size={13} color={isActive ? toolColor : 'currentColor'} />
                {t.id !== 'eraser' && t.id !== 'torch' && t.id !== 'select' && t.id !== 'hand' && (
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: toolColor,
                      display: 'inline-block',
                    }}
                  />
                )}
              </button>
            );
          })}

          <div style={{ width: '1px', height: '12px', background: 'var(--border-subtle)', margin: '0 2px' }} />

          {/* Drawer Toggles */}
          <button
            type="button"
            onClick={() => {
              setShowGeomDrawer(!showGeomDrawer);
              setShowDsaDrawer(false);
              setShowArchDrawer(false);
              setShowThemesDrawer(false);
            }}
            style={{
              padding: '2px 6px',
              fontSize: '9.5px',
              fontWeight: 600,
              borderRadius: '4px',
              border: '1px solid var(--border-subtle)',
              background: showGeomDrawer ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
              color: showGeomDrawer ? '#ffffff' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            🔷 Shapes {showGeomDrawer ? '▲' : '▼'}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowDsaDrawer(!showDsaDrawer);
              setShowGeomDrawer(false);
              setShowArchDrawer(false);
              setShowThemesDrawer(false);
            }}
            style={{
              padding: '2px 6px',
              fontSize: '9.5px',
              fontWeight: 600,
              borderRadius: '4px',
              border: '1px solid var(--border-subtle)',
              background: showDsaDrawer ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
              color: showDsaDrawer ? '#38bdf8' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            🔲 DSA Tools {showDsaDrawer ? '▲' : '▼'}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowArchDrawer(!showArchDrawer);
              setShowGeomDrawer(false);
              setShowDsaDrawer(false);
              setShowThemesDrawer(false);
            }}
            style={{
              padding: '2px 6px',
              fontSize: '9.5px',
              fontWeight: 600,
              borderRadius: '4px',
              border: '1px solid var(--border-subtle)',
              background: showArchDrawer ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
              color: showArchDrawer ? '#ffffff' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            🏛️ Architecture {showArchDrawer ? '▲' : '▼'}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowThemesDrawer(!showThemesDrawer);
              setShowGeomDrawer(false);
              setShowDsaDrawer(false);
              setShowArchDrawer(false);
            }}
            style={{
              padding: '2px 6px',
              fontSize: '9.5px',
              fontWeight: 600,
              borderRadius: '4px',
              border: '1px solid var(--border-subtle)',
              background: showThemesDrawer ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
              color: showThemesDrawer ? '#ffffff' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            🎨 Style & Grid {showThemesDrawer ? '▲' : '▼'}
          </button>
        </div>

        {/* Right Actions: Collab Mode, Undo/Redo, Clear, Copy, Save */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '1px', background: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              onClick={() => {
                setPrivacyMode('personal');
                whiteboardService.setPrivacyMode('personal');
              }}
              title="🔒 Private Scratchpad (Offline, Independent)"
              style={{
                fontSize: '8.5px',
                fontWeight: 700,
                padding: '2px 5px',
                borderRadius: '3px',
                background: privacyMode === 'personal' ? 'linear-gradient(135deg, #f59e0b, #f43f5e)' : 'transparent',
                color: privacyMode === 'personal' ? '#ffffff' : 'var(--text-muted)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              🔒 Private
            </button>
            <button
              type="button"
              onClick={() => {
                setPrivacyMode('collaborative');
                whiteboardService.setPrivacyMode('collaborative');
              }}
              title="👥 Collaborative Room Board (Synced across all peers and windows)"
              style={{
                fontSize: '8.5px',
                fontWeight: 700,
                padding: '2px 5px',
                borderRadius: '3px',
                background: privacyMode === 'collaborative' ? 'linear-gradient(135deg, #10b981, #06b6d4)' : 'transparent',
                color: privacyMode === 'collaborative' ? '#ffffff' : 'var(--text-muted)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              👥 Collab
            </button>
          </div>

          <div style={{ width: '1px', height: '12px', background: 'var(--border-subtle)', margin: '0 1px' }} />

          <button
            type="button"
            onClick={() => whiteboardService.undo()}
            title="Undo (Ctrl+Z)"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
          >
            <RotateCcw size={11} />
          </button>

          <button
            type="button"
            onClick={() => whiteboardService.redo()}
            title="Redo (Ctrl+Y)"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
          >
            <RotateCw size={11} />
          </button>

          <button
            type="button"
            onClick={handleClearCanvas}
            title="Clear Page (Can be Undone)"
            style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '2px' }}
          >
            <Trash2 size={11} />
          </button>

          <button
            type="button"
            onClick={handleCopyClipboard}
            title="Copy Canvas Image to Clipboard"
            style={{ background: 'none', border: 'none', color: copiedToast ? '#10b981' : 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
          >
            {copiedToast ? <Check size={11} /> : <Share2 size={11} />}
          </button>

          <button
            type="button"
            onClick={handleExportPNG}
            title="Save PNG Image"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
          >
            <Download size={11} />
          </button>
        </div>
      </div>

      {/* ─── 3. Drawer: Geometric Shapes ─── */}
      {showGeomDrawer && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '3px 8px',
            background: 'rgba(0, 0, 0, 0.85)',
            borderBottom: '1px solid var(--border-subtle)',
            overflowX: 'auto',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '8.5px', color: 'var(--text-muted)', fontWeight: 600 }}>Shapes:</span>
          {[
            { id: 'line', icon: Minus, label: 'Line' },
            { id: 'arrow', icon: MoveRight, label: 'Arrow (➡️)' },
            { id: 'arrow_bi', icon: MoveRight, label: 'Bi-Arrow (↔️)' },
            { id: 'rect', icon: Square, label: 'Rectangle' },
            { id: 'rounded_rect', icon: Square, label: 'Rounded Rect' },
            { id: 'circle', icon: Circle, label: 'Circle' },
            { id: 'triangle', icon: Triangle, label: 'Triangle (▲)' },
            { id: 'star', icon: Star, label: 'Star (⭐)' },
            { id: 'decision_diamond', icon: HelpCircle, label: 'Diamond (💎)' },
            { id: 'sticky_note', icon: StickyNote, label: 'Sticky Note' },
            { id: 'text', icon: Type, label: 'Text Label' },
            { id: 'code_box', icon: Code, label: 'Code Snippet' },
          ].map((t) => {
            const Icon = t.icon;
            const isActive = activeTool === t.id;
            const toolColor = toolStyles[t.id]?.color || '#6366f1';
            return (
              <button
                key={t.id}
                type="button"
                className={`btn-icon ${isActive ? 'active' : ''}`}
                onClick={() => setActiveTool(t.id as any)}
                title={t.label}
                style={{
                  padding: '2px 5px',
                  borderRadius: '4px',
                  border: isActive ? '1px solid var(--primary)' : '1px solid transparent',
                  background: isActive ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
                  color: isActive ? '#c7d2fe' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '9px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <Icon size={10} color={isActive ? toolColor : 'var(--text-muted)'} />
                <span>{t.label.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── 4. Drawer: DSA Data Structure Visualizers ─── */}
      {showDsaDrawer && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '3px 8px',
            background: 'rgba(8, 28, 44, 0.95)',
            borderBottom: '1px solid rgba(56, 189, 248, 0.3)',
            overflowX: 'auto',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '8.5px', color: '#7dd3fc', fontWeight: 700 }}>🔲 DSA:</span>
          {[
            { id: 'array_cells', icon: LayoutGrid, label: 'Array Cells [0..N]', color: '#38bdf8' },
            { id: 'two_pointers', icon: MoveRight, label: 'Two Pointers (L/R)', color: '#ec4899' },
            { id: 'stack_lifo', icon: Layers, label: 'Stack (LIFO)', color: '#f59e0b' },
            { id: 'queue_fifo', icon: MoveRight, label: 'Queue (FIFO)', color: '#10b981' },
            { id: 'tree_node', icon: GitBranch, label: 'Tree/BST Node', color: '#34d399' },
            { id: 'hashmap_table', icon: Database, label: 'HashMap Bucket', color: '#a855f7' },
            { id: 'decision_diamond', icon: HelpCircle, label: 'Condition/Branch', color: '#f59e0b' },
            { id: 'code_box', icon: Code, label: 'Pseudocode Box', color: '#38bdf8' },
          ].map((t) => {
            const Icon = t.icon;
            const isActive = activeTool === t.id;
            const toolColor = toolStyles[t.id]?.color || t.color;
            return (
              <button
                key={t.id}
                type="button"
                className={`btn-icon ${isActive ? 'active' : ''}`}
                onClick={() => setActiveTool(t.id as any)}
                title={t.label}
                style={{
                  padding: '2px 5px',
                  borderRadius: '4px',
                  border: isActive ? `1px solid ${toolColor}` : '1px solid transparent',
                  background: isActive ? `${toolColor}33` : 'transparent',
                  color: isActive ? '#ffffff' : '#7dd3fc',
                  cursor: 'pointer',
                  fontSize: '9px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  whiteSpace: 'nowrap',
                }}
              >
                <Icon size={10} color={toolColor} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── 5. Drawer: Architecture & System Design Shapes ─── */}
      {showArchDrawer && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '3px 8px',
            background: 'rgba(0, 0, 0, 0.9)',
            borderBottom: '1px solid var(--border-subtle)',
            overflowX: 'auto',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '8.5px', color: 'var(--text-muted)', fontWeight: 600 }}>Arch:</span>
          {[
            { id: 'db_cylinder', icon: Database, label: 'SQL DB', color: '#10b981' },
            { id: 'db_nosql', icon: Database, label: 'NoSQL DB', color: '#34d399' },
            { id: 'cache_mem', icon: Zap, label: 'Redis Cache', color: '#f43f5e' },
            { id: 'message_queue', icon: Layers, label: 'Kafka Queue', color: '#a855f7' },
            { id: 'load_balancer', icon: Scale, label: 'Load Balancer', color: '#f59e0b' },
            { id: 'server_box', icon: Server, label: 'App Server', color: '#818cf8' },
            { id: 'cloud', icon: Cloud, label: 'API Gateway', color: '#38bdf8' },
            { id: 'cdn_edge', icon: Globe, label: 'CDN Edge', color: '#06b6d4' },
            { id: 'object_storage', icon: Database, label: 'S3 Storage', color: '#f97316' },
            { id: 'auth_jwt', icon: Shield, label: 'Auth Service', color: '#eab308' },
            { id: 'websocket_gw', icon: Zap, label: 'WebSocket GW', color: '#6366f1' },
            { id: 'elasticsearch', icon: Database, label: 'Elasticsearch', color: '#14b8a6' },
            { id: 'dns_router', icon: Globe, label: 'DNS Router', color: '#38bdf8' },
            { id: 'firewall', icon: Shield, label: 'Firewall', color: '#f43f5e' },
            { id: 'user_client', icon: User, label: 'Client', color: '#3b82f6' },
            { id: 'mobile_client', icon: Smartphone, label: 'Mobile App', color: '#06b6d4' },
            { id: 'async_arrow', icon: MoveRight, label: 'Async Event ⇢', color: '#a855f7' },
            { id: 'tradeoff_note', icon: StickyNote, label: '⚖️ CAP Trade-off', color: '#facc15' },
          ].map((t) => {
            const Icon = t.icon;
            const isActive = activeTool === t.id;
            const toolColor = toolStyles[t.id]?.color || t.color;
            return (
              <button
                key={t.id}
                type="button"
                className={`btn-icon ${isActive ? 'active' : ''}`}
                onClick={() => setActiveTool(t.id as any)}
                title={t.label}
                style={{
                  padding: '2px 5px',
                  borderRadius: '4px',
                  border: isActive ? `1px solid ${toolColor}` : '1px solid transparent',
                  background: isActive ? `${toolColor}33` : 'transparent',
                  color: isActive ? '#ffffff' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '9px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  whiteSpace: 'nowrap',
                }}
              >
                <Icon size={10} color={toolColor} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      )}



      {/* ─── 7. Drawer: Independent Tool Styling & Background Themes ─── */}
      {showThemesDrawer && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 8px',
            background: 'rgba(0, 0, 0, 0.9)',
            borderBottom: '1px solid var(--border-subtle)',
            flexWrap: 'wrap',
            gap: '6px',
            flexShrink: 0,
          }}
        >
          {/* Active Tool Ink Color Selector */}
          <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
            <span style={{ fontSize: '8.5px', color: '#c7d2fe', fontWeight: 600 }}>
              Color for <span style={{ color: 'var(--primary)', textTransform: 'capitalize' }}>{activeTool.replace('_', ' ')}</span>:
            </span>
            {PEN_COLORS.map((c) => (
              <span
                key={c}
                onClick={() => updateActiveToolColor(c)}
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: c,
                  cursor: 'pointer',
                  border: activeColor === c ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.2)',
                  transform: activeColor === c ? 'scale(1.2)' : 'none',
                  display: 'inline-block',
                }}
              />
            ))}
          </div>

          {/* Active Tool Stroke Width Selector */}
          <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
            <span style={{ fontSize: '8.5px', color: 'var(--text-muted)' }}>Width:</span>
            {PEN_SIZES.map((sz) => (
              <button
                key={sz.label}
                type="button"
                onClick={() => updateActiveToolWidth(sz.size)}
                style={{
                  padding: '1px 5px',
                  fontSize: '8.5px',
                  fontWeight: 600,
                  borderRadius: '3px',
                  border: activeWidth === sz.size ? '1px solid var(--primary)' : '1px solid transparent',
                  background: activeWidth === sz.size ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255,255,255,0.04)',
                  color: activeWidth === sz.size ? '#fff' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {sz.label}
              </button>
            ))}
          </div>

          {/* Background Textures */}
          <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
            <span style={{ fontSize: '8.5px', color: 'var(--text-muted)' }}>Texture:</span>
            {[
              { id: 'grid', label: 'Grid' },
              { id: 'isometric', label: '3D Iso' },
              { id: 'ruled', label: 'Ruled' },
              { id: 'plot', label: 'Plot' },
              { id: 'matrix', label: 'DP Table' },
              { id: 'dotted', label: 'Dots' },
              { id: 'blank', label: 'Blank' },
            ].map((bg) => (
              <button
                key={bg.id}
                type="button"
                onClick={() => handleSelectBackground(bg.id as any)}
                style={{
                  padding: '1px 5px',
                  fontSize: '8.5px',
                  borderRadius: '3px',
                  border: backgroundType === bg.id ? '1px solid var(--primary)' : '1px solid transparent',
                  background: backgroundType === bg.id ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
                  color: backgroundType === bg.id ? '#fff' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {bg.label}
              </button>
            ))}
          </div>

          {/* Background Color Swatches */}
          <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
            <span style={{ fontSize: '8.5px', color: 'var(--text-muted)' }}>BG:</span>
            {BG_COLORS.map((bg) => (
              <span
                key={bg.color}
                onClick={() => handleSelectBgColor(bg.color)}
                title={bg.label}
                style={{
                  width: '11px',
                  height: '11px',
                  borderRadius: '50%',
                  background: bg.color,
                  cursor: 'pointer',
                  border: bgColor === bg.color ? '2px solid var(--primary)' : '1px solid rgba(255,255,255,0.2)',
                  display: 'inline-block',
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* ─── Undo / Copy Toast Notification ─── */}
      {undoToast && (
        <div
          style={{
            position: 'absolute',
            bottom: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '6px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
            fontSize: '11px',
            color: '#ffffff',
          }}
        >
          <span>{undoToast}</span>
          <button
            type="button"
            onClick={() => {
              whiteboardService.undo();
              setUndoToast(null);
            }}
            className="btn btn-primary btn-sm"
            style={{ fontSize: '10px', padding: '2px 8px' }}
          >
            ↩️ Undo
          </button>
          <button
            type="button"
            onClick={() => setUndoToast(null)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px' }}
          >
            ×
          </button>
        </div>
      )}

      {/* ─── 7. Master Canvas Drawing Workspace ─── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Floating Selection Action Bar for Copy, Duplicate, Paste, Delete & Deselect */}
        {selectedStrokeIds.length > 0 && (() => {
          const b = getSelectedBounds();
          if (!b) return null;
          const screenX = Math.max(10, Math.min((containerRef.current?.clientWidth || 400) - 240, b.minX * zoom + panOffset.x));
          const screenY = Math.max(10, b.minY * zoom + panOffset.y - 36);

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
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            cursor: activeTool === 'hand' ? (isPanning ? 'grabbing' : 'grab') : activeTool === 'select' ? 'default' : activeTool === 'text' ? 'text' : activeTool === 'eraser' ? 'cell' : 'crosshair',
          }}
        />

        {/* Floating Zoom & Pan Mini-Controls Bar */}
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            right: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            padding: '2px 4px',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
            zIndex: 40,
          }}
        >
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3.0, z + 0.15))}
            title="Zoom In"
            style={{ background: 'none', border: 'none', color: '#c7d2fe', cursor: 'pointer', padding: '2px' }}
          >
            <ZoomIn size={12} />
          </button>
          <span style={{ fontSize: '9px', fontWeight: 700, color: '#ffffff', minWidth: '28px', textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}
            title="Zoom Out"
            style={{ background: 'none', border: 'none', color: '#c7d2fe', cursor: 'pointer', padding: '2px' }}
          >
            <ZoomOut size={12} />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1.0);
              setPanOffset({ x: 0, y: 0 });
            }}
            title="Reset Zoom & Pan (100%)"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
          >
            <Maximize2 size={10} />
          </button>
        </div>

        {/* Inline On-Canvas Text Input Tool Popover */}
        {textModalPos && (
          <div
            style={{
              position: 'absolute',
              left: `${Math.min(textModalPos.x * zoom + panOffset.x, (containerRef.current?.clientWidth || 300) - 220)}px`,
              top: `${Math.max(10, textModalPos.y * zoom + panOffset.y - 38)}px`,
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
              placeholder="Type label text..."
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
                width: '140px',
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
