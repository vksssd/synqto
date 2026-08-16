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
  { label: 'S', size: 2 },
  { label: 'M', size: 4 },
  { label: 'L', size: 8 },
  { label: 'XL', size: 16 },
];

interface ToolStyle {
  color: string;
  width: number;
}

const DEFAULT_TOOL_STYLES: Record<string, ToolStyle> = {
  select: { color: '#6366f1', width: 3 },
  pen: { color: '#6366f1', width: 3 },
  brush: { color: '#06b6d4', width: 6 },
  highlighter: { color: '#f59e0b', width: 16 },
  temp_pen: { color: '#38bdf8', width: 3 },
  laser: { color: '#ef4444', width: 3 },
  torch: { color: '#facc15', width: 65 },
  eraser: { color: '#ffffff', width: 18 },
  text: { color: '#ffffff', width: 3 },
  code_box: { color: '#38bdf8', width: 2 },
  line: { color: '#6366f1', width: 3 },
  arrow: { color: '#6366f1', width: 3 },
  arrow_bi: { color: '#6366f1', width: 3 },
  rect: { color: '#6366f1', width: 3 },
  rounded_rect: { color: '#6366f1', width: 3 },
  circle: { color: '#6366f1', width: 3 },
  triangle: { color: '#10b981', width: 3 },
  star: { color: '#f59e0b', width: 3 },
  decision_diamond: { color: '#f59e0b', width: 3 },
  tree_node: { color: '#10b981', width: 3 },
  sticky_note: { color: '#fef3c7', width: 2 },
  db_cylinder: { color: '#10b981', width: 2.5 },
  db_nosql: { color: '#34d399', width: 2.5 },
  cloud: { color: '#38bdf8', width: 2.5 },
  load_balancer: { color: '#f59e0b', width: 2.5 },
  message_queue: { color: '#a855f7', width: 2.5 },
  server_box: { color: '#818cf8', width: 2.5 },
  cache_mem: { color: '#f43f5e', width: 2.5 },
  dns_router: { color: '#38bdf8', width: 2.5 },
  firewall: { color: '#f43f5e', width: 2.5 },
  user_client: { color: '#3b82f6', width: 2.5 },
  mobile_client: { color: '#06b6d4', width: 2.5 },
  // DSA Data Structure Visualizers:
  array_cells: { color: '#38bdf8', width: 2.5 },
  stack_lifo: { color: '#f59e0b', width: 2.5 },
  queue_fifo: { color: '#10b981', width: 2.5 },
  hashmap_table: { color: '#a855f7', width: 2.5 },
  two_pointers: { color: '#ec4899', width: 2 },
  // Extended Architecture Nodes:
  cdn_edge: { color: '#06b6d4', width: 2.5 },
  object_storage: { color: '#f97316', width: 2.5 },
  auth_jwt: { color: '#eab308', width: 2.5 },
  websocket_gw: { color: '#6366f1', width: 2.5 },
  elasticsearch: { color: '#14b8a6', width: 2.5 },
  async_arrow: { color: '#a855f7', width: 2 },
  tradeoff_note: { color: '#facc15', width: 2 },
};

// ── Geometric Collision Helpers for Precision Object Eraser ──
function distanceToLineSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
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

    if (stroke.tool === 'line' || stroke.tool === 'arrow' || stroke.tool === 'arrow_bi') {
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
  const [showPresetsDrawer, setShowPresetsDrawer] = useState(false);
  const [presetTab, setPresetTab] = useState<'dsa' | 'arch'>('dsa');
  const [showThemesDrawer, setShowThemesDrawer] = useState(false);

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

      ctx.restore();
    },
    [activeTool, activeColor, activeWidth, backgroundType, bgColor, drawBackground, isLightColor, laserTrails, renderSingleStroke, tempStrokes, torchPos, eraserPos, zoom, panOffset]
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
  ].includes(activeTool);

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (activeTool === 'select') {
      setIsPanning(true);
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
      setPanStart({ x: clientX - panOffset.x, y: clientY - panOffset.y });
      return;
    }

    const pt = getCanvasCoords(e);

    if (activeTool === 'text') {
      setTextModalPos(pt);
      setTextInput('');
      return;
    }

    if (activeTool === 'eraser') {
      setIsDrawing(true);
      setEraserPos(pt);
      const radius = activeWidth * 2.2 || 18;
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
    if (activeTool === 'select' && isPanning) {
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
      setPanOffset({ x: clientX - panStart.x, y: clientY - panStart.y });
      return;
    }

    const pt = getCanvasCoords(e);

    if (activeTool === 'eraser') {
      setEraserPos(pt);
      if (isDrawing) {
        const radius = activeWidth * 2.2 || 18;
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
    if (activeTool === 'select') {
      setIsPanning(false);
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
    const strokeWidth = activeTool === 'highlighter' ? 16 : activeWidth;

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

  // Quick Architecture & Algorithm Presets Stamping
  const handleStampPreset = (type: string) => {
    const cx = (containerRef.current?.clientWidth || 400) / 2 / zoom - panOffset.x / zoom;
    const cy = 180 / zoom - panOffset.y / zoom;

    // ─── DSA & Algorithm Presets ───
    if (type === 'two_pointers') {
      whiteboardService.addStroke('array_cells', '#38bdf8', 2.5, [], { x1: cx - 110, y1: cy, x2: cx + 110, y2: cy + 34 });
      whiteboardService.addStroke('two_pointers', '#ec4899', 2, [], { x1: cx - 90, y1: cy + 38, x2: cx - 90, y2: cy + 58, label: 'L (left=0)' });
      whiteboardService.addStroke('two_pointers', '#10b981', 2, [], { x1: cx + 70, y1: cy + 38, x2: cx + 70, y2: cy + 58, label: 'R (right=4)' });
      whiteboardService.addStroke('text', '#f59e0b', 3, [], { x1: cx - 100, y1: cy - 25, x2: cx - 100, y2: cy - 25 }, 'Target = nums[L] + nums[R]');
    } else if (type === 'bst') {
      whiteboardService.addStroke('tree_node', '#10b981', 3, [], { x1: cx, y1: cy, x2: cx, y2: cy, label: '50' });
      whiteboardService.addStroke('tree_node', '#06b6d4', 3, [], { x1: cx - 70, y1: cy + 65, x2: cx - 70, y2: cy + 65, label: '30' });
      whiteboardService.addStroke('tree_node', '#06b6d4', 3, [], { x1: cx + 70, y1: cy + 65, x2: cx + 70, y2: cy + 65, label: '70' });
      whiteboardService.addStroke('tree_node', '#818cf8', 2.5, [], { x1: cx - 105, y1: cy + 130, x2: cx - 105, y2: cy + 130, label: '20' });
      whiteboardService.addStroke('tree_node', '#818cf8', 2.5, [], { x1: cx - 35, y1: cy + 130, x2: cx - 35, y2: cy + 130, label: '40' });
      whiteboardService.addStroke('tree_node', '#818cf8', 2.5, [], { x1: cx + 35, y1: cy + 130, x2: cx + 35, y2: cy + 130, label: '60' });
      whiteboardService.addStroke('tree_node', '#818cf8', 2.5, [], { x1: cx + 105, y1: cy + 130, x2: cx + 105, y2: cy + 130, label: '80' });
      // Edges
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx - 12, y1: cy + 12, x2: cx - 55, y2: cy + 52 });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx + 12, y1: cy + 12, x2: cx + 55, y2: cy + 52 });
      whiteboardService.addStroke('arrow', '#6366f1', 1.5, [], { x1: cx - 75, y1: cy + 78, x2: cx - 95, y2: cy + 118 });
      whiteboardService.addStroke('arrow', '#6366f1', 1.5, [], { x1: cx - 65, y1: cy + 78, x2: cx - 45, y2: cy + 118 });
      whiteboardService.addStroke('arrow', '#6366f1', 1.5, [], { x1: cx + 65, y1: cy + 78, x2: cx + 45, y2: cy + 118 });
      whiteboardService.addStroke('arrow', '#6366f1', 1.5, [], { x1: cx + 75, y1: cy + 78, x2: cx + 95, y2: cy + 118 });
      whiteboardService.addStroke('text', '#34d399', 2.5, [], { x1: cx - 100, y1: cy - 25, x2: cx - 100, y2: cy - 25 }, 'BST Property: Left < Root < Right');
    } else if (type === 'floyd_cycle') {
      const startX = cx - 140;
      for (let i = 0; i < 4; i++) {
        const nx = startX + i * 65;
        whiteboardService.addStroke('rounded_rect', '#38bdf8', 2.5, [], { x1: nx, y1: cy, x2: nx + 45, y2: cy + 28, label: `Node ${i + 1}` });
        whiteboardService.addStroke('arrow', '#f59e0b', 2, [], { x1: nx + 45, y1: cy + 14, x2: nx + 65, y2: cy + 14 });
      }
      // Loop cycle nodes
      whiteboardService.addStroke('rounded_rect', '#ec4899', 2.5, [], { x1: startX + 260, y1: cy + 45, x2: startX + 305, y2: cy + 73, label: 'Node 5' });
      whiteboardService.addStroke('rounded_rect', '#ec4899', 2.5, [], { x1: startX + 195, y1: cy + 60, x2: startX + 240, y2: cy + 88, label: 'Node 6' });
      whiteboardService.addStroke('arrow', '#ec4899', 2, [], { x1: startX + 240, y1: cy + 28, x2: startX + 260, y2: cy + 45 });
      whiteboardService.addStroke('arrow', '#ec4899', 2, [], { x1: startX + 260, y1: cy + 65, x2: startX + 240, y2: cy + 75 });
      whiteboardService.addStroke('arrow', '#ec4899', 2, [], { x1: startX + 195, y1: cy + 70, x2: startX + 195, y2: cy + 28 });
      // Pointers
      whiteboardService.addStroke('two_pointers', '#10b981', 2, [], { x1: startX + 85, y1: cy - 25, x2: startX + 85, y2: cy - 5, label: '🐢 Slow' });
      whiteboardService.addStroke('two_pointers', '#f59e0b', 2, [], { x1: startX + 215, y1: cy - 25, x2: startX + 215, y2: cy - 5, label: '🐇 Fast' });
      whiteboardService.addStroke('text', '#38bdf8', 2.5, [], { x1: cx - 120, y1: cy - 40, x2: cx - 120, y2: cy - 40 }, "Floyd's Cycle Detection (Fast & Slow Pointers)");
    } else if (type === 'mono_stack') {
      whiteboardService.addStroke('array_cells', '#38bdf8', 2.5, [], { x1: cx - 140, y1: cy + 20, x2: cx - 20, y2: cy + 54 });
      whiteboardService.addStroke('stack_lifo', '#f59e0b', 2.5, [], { x1: cx + 30, y1: cy, x2: cx + 90, y2: cy + 90 });
      whiteboardService.addStroke('arrow', '#ec4899', 2, [], { x1: cx - 30, y1: cy + 25, x2: cx + 25, y2: cy + 35 });
      whiteboardService.addStroke('text', '#f59e0b', 2.5, [], { x1: cx - 120, y1: cy - 25, x2: cx - 120, y2: cy - 25 }, 'Monotonic Stack: Push if cur < top, else Pop & evaluate');
    } else if (type === 'dp_table') {
      whiteboardService.setBackground('matrix');
      whiteboardService.addStroke('text', '#38bdf8', 3, [], { x1: cx - 110, y1: cy - 30, x2: cx - 110, y2: cy - 30 }, 'DP[i][j] = DP[i-1][j] + DP[i][j-1]');
      whiteboardService.addStroke('tradeoff_note', '#facc15', 2, [], { x1: cx - 100, y1: cy + 30, x2: cx + 100, y2: cy + 90, label: 'Base Case: DP[0][j]=1, DP[i][0]=1' });
    } else if (type === 'trie') {
      whiteboardService.addStroke('tree_node', '#10b981', 3, [], { x1: cx, y1: cy, x2: cx, y2: cy, label: '*' });
      whiteboardService.addStroke('tree_node', '#38bdf8', 2.5, [], { x1: cx - 70, y1: cy + 60, x2: cx - 70, y2: cy + 60, label: 'c' });
      whiteboardService.addStroke('tree_node', '#38bdf8', 2.5, [], { x1: cx - 70, y1: cy + 120, x2: cx - 70, y2: cy + 120, label: 'a' });
      whiteboardService.addStroke('tree_node', '#ec4899', 2.5, [], { x1: cx - 105, y1: cy + 180, x2: cx - 105, y2: cy + 180, label: 't (end)' });
      whiteboardService.addStroke('tree_node', '#ec4899', 2.5, [], { x1: cx - 35, y1: cy + 180, x2: cx - 35, y2: cy + 180, label: 'r (end)' });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx - 10, y1: cy + 10, x2: cx - 60, y2: cy + 48 });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx - 70, y1: cy + 75, x2: cx - 70, y2: cy + 105 });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx - 75, y1: cy + 135, x2: cx - 95, y2: cy + 165 });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx - 65, y1: cy + 135, x2: cx - 45, y2: cy + 165 });
      whiteboardService.addStroke('text', '#38bdf8', 2.5, [], { x1: cx - 100, y1: cy - 25, x2: cx - 100, y2: cy - 25 }, 'Prefix Trie (Insert / Search / StartsWith)');
    } else if (type === 'graph_bfs') {
      whiteboardService.addStroke('tree_node', '#10b981', 3, [], { x1: cx - 90, y1: cy, x2: cx - 90, y2: cy, label: '1' });
      whiteboardService.addStroke('tree_node', '#38bdf8', 3, [], { x1: cx - 40, y1: cy + 50, x2: cx - 40, y2: cy + 50, label: '2' });
      whiteboardService.addStroke('tree_node', '#38bdf8', 3, [], { x1: cx - 40, y1: cy - 50, x2: cx - 40, y2: cy - 50, label: '3' });
      whiteboardService.addStroke('tree_node', '#818cf8', 3, [], { x1: cx + 20, y1: cy + 50, x2: cx + 20, y2: cy + 50, label: '4' });
      whiteboardService.addStroke('tree_node', '#818cf8', 3, [], { x1: cx + 20, y1: cy - 50, x2: cx + 20, y2: cy - 50, label: '5' });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx - 75, y1: cy + 10, x2: cx - 50, y2: cy + 38 });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx - 75, y1: cy - 10, x2: cx - 50, y2: cy - 38 });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx - 25, y1: cy + 50, x2: cx + 5, y2: cy + 50 });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx - 25, y1: cy - 50, x2: cx + 5, y2: cy - 50 });
      whiteboardService.addStroke('queue_fifo', '#10b981', 2, [], { x1: cx + 70, y1: cy - 20, x2: cx + 160, y2: cy + 15, label: 'Queue' });
      whiteboardService.addStroke('text', '#34d399', 2.5, [], { x1: cx - 110, y1: cy - 75, x2: cx - 110, y2: cy - 75 }, 'BFS Traversal (Visited Set + FIFO Queue)');
    } else if (type === 'min_heap') {
      whiteboardService.addStroke('tree_node', '#10b981', 3, [], { x1: cx, y1: cy, x2: cx, y2: cy, label: '10' });
      whiteboardService.addStroke('tree_node', '#38bdf8', 2.5, [], { x1: cx - 50, y1: cy + 50, x2: cx - 50, y2: cy + 50, label: '15' });
      whiteboardService.addStroke('tree_node', '#38bdf8', 2.5, [], { x1: cx + 50, y1: cy + 50, x2: cx + 50, y2: cy + 50, label: '20' });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx - 10, y1: cy + 10, x2: cx - 40, y2: cy + 40 });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx + 10, y1: cy + 10, x2: cx + 40, y2: cy + 40 });
      whiteboardService.addStroke('array_cells', '#f59e0b', 2.5, [], { x1: cx - 80, y1: cy + 90, x2: cx + 80, y2: cy + 120 });
      whiteboardService.addStroke('text', '#f59e0b', 2.5, [], { x1: cx - 100, y1: cy - 25, x2: cx - 100, y2: cy - 25 }, 'Min-Heap: Parent(i) <= Left(2i+1) & Right(2i+2)');
    } else if (type === 'intervals') {
      whiteboardService.addStroke('line', '#38bdf8', 4, [], { x1: cx - 120, y1: cy, x2: cx - 40, y2: cy, label: '[1, 4]' });
      whiteboardService.addStroke('line', '#ec4899', 4, [], { x1: cx - 70, y1: cy + 25, x2: cx + 20, y2: cy + 25, label: '[2, 6]' });
      whiteboardService.addStroke('line', '#10b981', 4, [], { x1: cx + 40, y1: cy, x2: cx + 110, y2: cy, label: '[8, 10]' });
      whiteboardService.addStroke('arrow', '#f59e0b', 2, [], { x1: cx - 30, y1: cy + 45, x2: cx - 30, y2: cy + 70 });
      whiteboardService.addStroke('line', '#10b981', 6, [], { x1: cx - 120, y1: cy + 85, x2: cx + 20, y2: cy + 85, label: 'Merged: [1, 6]' });
      whiteboardService.addStroke('text', '#38bdf8', 2.5, [], { x1: cx - 110, y1: cy - 25, x2: cx - 110, y2: cy - 25 }, 'Merge Overlapping Intervals (Sort by Start)');
    } else if (type === 'recursion_tree') {
      whiteboardService.addStroke('code_box', '#818cf8', 2, [], { x1: cx - 40, y1: cy, x2: cx + 40, y2: cy + 30, label: 'solve(N)' });
      whiteboardService.addStroke('code_box', '#38bdf8', 2, [], { x1: cx - 100, y1: cy + 60, x2: cx - 30, y2: cy + 90, label: 'solve(N/2)' });
      whiteboardService.addStroke('code_box', '#38bdf8', 2, [], { x1: cx + 30, y1: cy + 60, x2: cx + 100, y2: cy + 90, label: 'solve(N/2)' });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx - 20, y1: cy + 30, x2: cx - 60, y2: cy + 60 });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx + 20, y1: cy + 30, x2: cx + 60, y2: cy + 60 });
      whiteboardService.addStroke('text', '#34d399', 2.5, [], { x1: cx - 100, y1: cy - 25, x2: cx - 100, y2: cy - 25 }, 'Divide & Conquer: T(N) = 2T(N/2) + O(N)');
    }

    // ─── System Design Architecture Presets ───
    else if (type === 'url_shortener') {
      whiteboardService.addStroke('user_client', '#3b82f6', 2.5, [], { x1: cx - 140, y1: cy, x2: cx - 100, y2: cy + 40, label: 'Client' });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx - 100, y1: cy + 20, x2: cx - 70, y2: cy + 20 });
      whiteboardService.addStroke('load_balancer', '#f59e0b', 2.5, [], { x1: cx - 70, y1: cy - 5, x2: cx - 20, y2: cy + 45, label: 'LB' });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx - 20, y1: cy + 20, x2: cx + 10, y2: cy + 20 });
      whiteboardService.addStroke('server_box', '#818cf8', 2.5, [], { x1: cx + 10, y1: cy - 5, x2: cx + 80, y2: cy + 40, label: 'App Servers' });
      whiteboardService.addStroke('arrow', '#10b981', 2, [], { x1: cx + 80, y1: cy + 10, x2: cx + 115, y2: cy - 20 });
      whiteboardService.addStroke('cache_mem', '#f43f5e', 2.5, [], { x1: cx + 115, y1: cy - 45, x2: cx + 180, y2: cy - 5, label: 'Redis Cache' });
      whiteboardService.addStroke('arrow', '#10b981', 2, [], { x1: cx + 80, y1: cy + 30, x2: cx + 115, y2: cy + 50 });
      whiteboardService.addStroke('db_cylinder', '#10b981', 2.5, [], { x1: cx + 115, y1: cy + 30, x2: cx + 180, y2: cy + 85, label: 'SQL Shards' });
      whiteboardService.addStroke('tradeoff_note', '#facc15', 2, [], { x1: cx - 130, y1: cy + 70, x2: cx - 10, y2: cy + 120, label: 'Base62 (7 chars) | 100:1 Read Heavy' });
    } else if (type === 'rate_limiter') {
      whiteboardService.addStroke('user_client', '#3b82f6', 2.5, [], { x1: cx - 140, y1: cy, x2: cx - 100, y2: cy + 40, label: 'Client' });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx - 100, y1: cy + 20, x2: cx - 60, y2: cy + 20 });
      whiteboardService.addStroke('cloud', '#38bdf8', 2.5, [], { x1: cx - 60, y1: cy - 10, x2: cx + 10, y2: cy + 50, label: 'API Gateway' });
      whiteboardService.addStroke('arrow', '#f59e0b', 2, [], { x1: cx - 25, y1: cy + 50, x2: cx - 25, y2: cy + 85 });
      whiteboardService.addStroke('cache_mem', '#f43f5e', 2.5, [], { x1: cx - 60, y1: cy + 85, x2: cx + 10, y2: cy + 125, label: 'Redis Tokens' });
      whiteboardService.addStroke('arrow', '#10b981', 2, [], { x1: cx + 10, y1: cy + 20, x2: cx + 55, y2: cy + 20 });
      whiteboardService.addStroke('server_box', '#818cf8', 2.5, [], { x1: cx + 55, y1: cy - 5, x2: cx + 130, y2: cy + 40, label: 'Microservices' });
      whiteboardService.addStroke('tradeoff_note', '#facc15', 2, [], { x1: cx - 140, y1: cy + 70, x2: cx - 75, y2: cy + 120, label: 'Token Bucket | 429 Too Many Requests' });
    } else if (type === 'chat_system') {
      whiteboardService.addStroke('user_client', '#3b82f6', 2.5, [], { x1: cx - 140, y1: cy - 30, x2: cx - 100, y2: cy + 10, label: 'User A' });
      whiteboardService.addStroke('user_client', '#3b82f6', 2.5, [], { x1: cx - 140, y1: cy + 40, x2: cx - 100, y2: cy + 80, label: 'User B' });
      whiteboardService.addStroke('arrow_bi', '#6366f1', 2, [], { x1: cx - 100, y1: cy - 10, x2: cx - 50, y2: cy + 10 });
      whiteboardService.addStroke('arrow_bi', '#6366f1', 2, [], { x1: cx - 100, y1: cy + 50, x2: cx - 50, y2: cy + 30 });
      whiteboardService.addStroke('websocket_gw', '#6366f1', 2.5, [], { x1: cx - 50, y1: cy, x2: cx + 20, y2: cy + 50, label: 'WS Gateway' });
      whiteboardService.addStroke('arrow', '#a855f7', 2, [], { x1: cx + 20, y1: cy + 25, x2: cx + 60, y2: cy + 25 });
      whiteboardService.addStroke('message_queue', '#a855f7', 2.5, [], { x1: cx + 60, y1: cy + 5, x2: cx + 140, y2: cy + 45, label: 'Redis PubSub' });
      whiteboardService.addStroke('arrow', '#10b981', 2, [], { x1: cx + 100, y1: cy + 45, x2: cx + 100, y2: cy + 75 });
      whiteboardService.addStroke('db_nosql', '#34d399', 2.5, [], { x1: cx + 70, y1: cy + 75, x2: cx + 130, y2: cy + 135, label: 'Cassandra' });
      whiteboardService.addStroke('tradeoff_note', '#facc15', 2, [], { x1: cx - 140, y1: cy + 95, x2: cx - 40, y2: cy + 140, label: 'Persistent WebSocket + Heartbeat' });
    } else if (type === 'distributed_cache') {
      whiteboardService.addStroke('server_box', '#818cf8', 2.5, [], { x1: cx - 110, y1: cy, x2: cx - 40, y2: cy + 45, label: 'App Server' });
      whiteboardService.addStroke('arrow', '#f43f5e', 2, [], { x1: cx - 40, y1: cy + 20, x2: cx + 10, y2: cy + 20 });
      whiteboardService.addStroke('cache_mem', '#f43f5e', 2.5, [], { x1: cx + 10, y1: cy, x2: cx + 80, y2: cy + 45, label: 'Redis Cluster' });
      whiteboardService.addStroke('async_arrow', '#10b981', 2, [], { x1: cx + 80, y1: cy + 20, x2: cx + 120, y2: cy + 20 });
      whiteboardService.addStroke('db_cylinder', '#10b981', 2.5, [], { x1: cx + 120, y1: cy - 10, x2: cx + 180, y2: cy + 50, label: 'Postgres DB' });
      whiteboardService.addStroke('tradeoff_note', '#facc15', 2, [], { x1: cx - 100, y1: cy + 65, x2: cx + 60, y2: cy + 115, label: 'Cache-Aside (Read-Through) | LRU Eviction' });
    } else if (type === 'ecommerce_saga') {
      whiteboardService.addStroke('server_box', '#818cf8', 2.5, [], { x1: cx - 130, y1: cy, x2: cx - 60, y2: cy + 40, label: 'Order API' });
      whiteboardService.addStroke('arrow', '#a855f7', 2, [], { x1: cx - 60, y1: cy + 20, x2: cx - 15, y2: cy + 20 });
      whiteboardService.addStroke('message_queue', '#a855f7', 2.5, [], { x1: cx - 15, y1: cy, x2: cx + 65, y2: cy + 40, label: 'Kafka Bus' });
      whiteboardService.addStroke('arrow', '#10b981', 2, [], { x1: cx + 65, y1: cy + 10, x2: cx + 100, y2: cy - 20 });
      whiteboardService.addStroke('server_box', '#10b981', 2, [], { x1: cx + 100, y1: cy - 40, x2: cx + 165, y2: cy - 5, label: 'Payment' });
      whiteboardService.addStroke('arrow', '#10b981', 2, [], { x1: cx + 65, y1: cy + 30, x2: cx + 100, y2: cy + 55 });
      whiteboardService.addStroke('server_box', '#10b981', 2, [], { x1: cx + 100, y1: cy + 40, x2: cx + 165, y2: cy + 75, label: 'Inventory' });
      whiteboardService.addStroke('tradeoff_note', '#facc15', 2, [], { x1: cx - 120, y1: cy + 60, x2: cx + 20, y2: cy + 110, label: 'Choreographed Saga | Compensating Tx' });
    } else if (type === 'web_crawler') {
      whiteboardService.addStroke('message_queue', '#a855f7', 2.5, [], { x1: cx - 130, y1: cy, x2: cx - 50, y2: cy + 40, label: 'URL Frontier' });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx - 50, y1: cy + 20, x2: cx - 10, y2: cy + 20 });
      whiteboardService.addStroke('server_box', '#818cf8', 2.5, [], { x1: cx - 10, y1: cy, x2: cx + 55, y2: cy + 40, label: 'Fetcher Pool' });
      whiteboardService.addStroke('arrow', '#f59e0b', 2, [], { x1: cx + 55, y1: cy + 20, x2: cx + 90, y2: cy + 20 });
      whiteboardService.addStroke('object_storage', '#f97316', 2.5, [], { x1: cx + 90, y1: cy - 10, x2: cx + 150, y2: cy + 50, label: 'S3 Raw Docs' });
      whiteboardService.addStroke('tradeoff_note', '#facc15', 2, [], { x1: cx - 110, y1: cy + 60, x2: cx + 30, y2: cy + 110, label: 'Bloom Filter Dedup | Politeness Delay' });
    } else if (type === 'microservices_3tier') {
      whiteboardService.addStroke('cdn_edge', '#06b6d4', 2.5, [], { x1: cx - 140, y1: cy - 10, x2: cx - 85, y2: cy + 40, label: 'Cloudflare' });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx - 85, y1: cy + 15, x2: cx - 50, y2: cy + 15 });
      whiteboardService.addStroke('load_balancer', '#f59e0b', 2.5, [], { x1: cx - 50, y1: cy - 10, x2: cx + 5, y2: cy + 40, label: 'ALB Gateway' });
      whiteboardService.addStroke('arrow', '#6366f1', 2, [], { x1: cx + 5, y1: cy + 15, x2: cx + 40, y2: cy + 15 });
      whiteboardService.addStroke('server_box', '#818cf8', 2.5, [], { x1: cx + 40, y1: cy - 10, x2: cx + 110, y2: cy + 35, label: 'Microservices' });
      whiteboardService.addStroke('arrow', '#10b981', 2, [], { x1: cx + 110, y1: cy + 15, x2: cx + 135, y2: cy + 15 });
      whiteboardService.addStroke('db_cylinder', '#10b981', 2.5, [], { x1: cx + 135, y1: cy - 20, x2: cx + 190, y2: cy + 45, label: 'Primary DB' });
      whiteboardService.addStroke('tradeoff_note', '#facc15', 2, [], { x1: cx - 110, y1: cy + 65, x2: cx + 40, y2: cy + 115, label: 'Stateless Web Tier + Read Replicas + Redis' });
    } else if (type === 'search_analytics') {
      whiteboardService.addStroke('server_box', '#818cf8', 2.5, [], { x1: cx - 140, y1: cy, x2: cx - 75, y2: cy + 40, label: 'App Logs' });
      whiteboardService.addStroke('arrow', '#a855f7', 2, [], { x1: cx - 75, y1: cy + 20, x2: cx - 35, y2: cy + 20 });
      whiteboardService.addStroke('message_queue', '#a855f7', 2.5, [], { x1: cx - 35, y1: cy, x2: cx + 40, y2: cy + 40, label: 'Kafka Ingest' });
      whiteboardService.addStroke('arrow', '#14b8a6', 2, [], { x1: cx + 40, y1: cy + 20, x2: cx + 80, y2: cy + 20 });
      whiteboardService.addStroke('elasticsearch', '#14b8a6', 2.5, [], { x1: cx + 80, y1: cy - 5, x2: cx + 150, y2: cy + 45, label: 'Elasticsearch' });
      whiteboardService.addStroke('tradeoff_note', '#facc15', 2, [], { x1: cx - 100, y1: cy + 60, x2: cx + 60, y2: cy + 110, label: 'Inverted Index | Kibana Dashboards' });
    }

    setShowPresetsDrawer(false);
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
          background: 'rgba(15, 23, 42, 0.95)',
          borderBottom: '1px solid var(--border-subtle)',
          flexWrap: 'wrap',
          gap: '4px',
          flexShrink: 0,
        }}
      >
        {/* Left Tools: Freehand, Presenter & Essential Tools */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
          {[
            { id: 'select', icon: Hand, label: '🖐️ Pan Hand', defaultColor: '#6366f1' },
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
                  padding: '2px 5px',
                  borderRadius: '4px',
                  border: isActive ? '1px solid var(--primary)' : '1px solid transparent',
                  background: isActive ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
                  color: isActive ? '#ffffff' : 'var(--text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <Icon size={11} color={isActive ? toolColor : 'var(--text-muted)'} />
                {t.id !== 'eraser' && t.id !== 'torch' && t.id !== 'select' && (
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
              setShowPresetsDrawer(false);
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
              setShowPresetsDrawer(false);
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
              setShowPresetsDrawer(false);
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
              setShowPresetsDrawer(!showPresetsDrawer);
              setShowGeomDrawer(false);
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
              background: showPresetsDrawer ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
              color: showPresetsDrawer ? '#34d399' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            ⚡ Presets {showPresetsDrawer ? '▲' : '▼'}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowThemesDrawer(!showThemesDrawer);
              setShowGeomDrawer(false);
              setShowDsaDrawer(false);
              setShowArchDrawer(false);
              setShowPresetsDrawer(false);
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
                setPrivacyMode('collaborative');
                whiteboardService.setPrivacyMode('collaborative');
              }}
              title="👥 Collaborative Room Board (Synced across all peers and windows)"
              style={{
                fontSize: '8.5px',
                fontWeight: 700,
                padding: '2px 4px',
                borderRadius: '3px',
                background: privacyMode === 'collaborative' ? 'linear-gradient(135deg, #10b981, #06b6d4)' : 'transparent',
                color: privacyMode === 'collaborative' ? '#ffffff' : 'var(--text-muted)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              👥 Collab
            </button>
            <button
              type="button"
              onClick={() => {
                setPrivacyMode('personal');
                whiteboardService.setPrivacyMode('personal');
              }}
              title="🔒 Personal Scratchpad"
              style={{
                fontSize: '8.5px',
                fontWeight: 700,
                padding: '2px 4px',
                borderRadius: '3px',
                background: privacyMode === 'personal' ? 'linear-gradient(135deg, #f59e0b, #f43f5e)' : 'transparent',
                color: privacyMode === 'personal' ? '#ffffff' : 'var(--text-muted)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              🔒 Private
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

      {/* ─── 6. Drawer: Categorized DSA & System Design Presets (18 High-Yield Blueprints) ─── */}
      {showPresetsDrawer && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            padding: '4px 8px',
            background: 'rgba(6, 44, 36, 0.96)',
            borderBottom: '1px solid rgba(16, 185, 129, 0.35)',
            flexShrink: 0,
          }}
        >
          {/* Preset Category Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: '3px' }}>
              <button
                type="button"
                onClick={() => setPresetTab('dsa')}
                style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '4px',
                  border: 'none',
                  background: presetTab === 'dsa' ? '#10b981' : 'rgba(255,255,255,0.08)',
                  color: presetTab === 'dsa' ? '#ffffff' : '#a7f3d0',
                  cursor: 'pointer',
                }}
              >
                🔲 DSA &amp; Algorithms (10)
              </button>
              <button
                type="button"
                onClick={() => setPresetTab('arch')}
                style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '4px',
                  border: 'none',
                  background: presetTab === 'arch' ? '#10b981' : 'rgba(255,255,255,0.08)',
                  color: presetTab === 'arch' ? '#ffffff' : '#a7f3d0',
                  cursor: 'pointer',
                }}
              >
                🏛️ System Design (8)
              </button>
            </div>
            <span style={{ fontSize: '8.5px', color: '#6ee7b7' }}>1-Click Blueprint Stamp</span>
          </div>

          {/* Preset Buttons Grid */}
          <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '2px' }}>
            {presetTab === 'dsa' &&
              [
                { id: 'two_pointers', label: '👆 Two Pointers', desc: 'Array [2,7,11,15] with Left/Right pointers & Target check' },
                { id: 'bst', label: '🌲 BST Balanced Tree', desc: '3-level binary search tree with property validation' },
                { id: 'floyd_cycle', label: '🐢 Floyd Cycle (Fast/Slow)', desc: 'Linked list cycle with Slow (1x) & Fast (2x) pointers' },
                { id: 'mono_stack', label: '📥 Monotonic Stack', desc: 'Stack LIFO evaluation for Next Greater Element' },
                { id: 'dp_table', label: '📊 2D DP Recurrence', desc: '4x4 DP matrix with base cases and recurrence formulas' },
                { id: 'trie', label: '🌳 Prefix Trie', desc: 'Multi-branch prefix tree for insert/search/startsWith' },
                { id: 'graph_bfs', label: '🔵 Graph BFS + Queue', desc: '5-node graph with Visited hashset and FIFO queue' },
                { id: 'min_heap', label: '🏔️ Min-Heap / Priority Queue', desc: 'Heap tree with array indices (2i+1, 2i+2)' },
                { id: 'intervals', label: '📏 Overlapping Intervals', desc: 'Interval timeline sorting & merge strategy' },
                { id: 'recursion_tree', label: '🌿 Recursion Tree (D&C)', desc: 'Merge sort / Divide & Conquer recursion tree' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleStampPreset(p.id)}
                  title={p.desc}
                  style={{
                    fontSize: '9px',
                    fontWeight: 600,
                    padding: '3px 7px',
                    borderRadius: '4px',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    background: 'rgba(16, 185, 129, 0.25)',
                    color: '#ffffff',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.label}
                </button>
              ))}

            {presetTab === 'arch' &&
              [
                { id: 'url_shortener', label: '🔗 URL Shortener (TinyURL)', desc: 'Client -> LB -> App Servers -> Base62 KGS + Redis + SQL DB' },
                { id: 'rate_limiter', label: '🚦 API Rate Limiter', desc: 'API Gateway -> Token Bucket Redis -> Backend (429 Too Many Requests)' },
                { id: 'chat_system', label: '💬 Real-Time Chat (WhatsApp)', desc: 'WebSocket Gateway -> Redis PubSub -> Cassandra Messages' },
                { id: 'distributed_cache', label: '⚡ Distributed Cache', desc: 'App Server -> Redis Cluster -> Invalidation Worker -> PostgreSQL' },
                { id: 'ecommerce_saga', label: '🛒 E-Commerce Saga', desc: 'Order API -> Kafka Stream -> Payment + Inventory Workers' },
                { id: 'web_crawler', label: '🕷️ Distributed Web Crawler', desc: 'URL Frontier Queue -> Fetcher Workers -> DNS -> S3 Storage' },
                { id: 'microservices_3tier', label: '🏛️ 3-Tier Microservices', desc: 'CDN -> ALB -> Auth + User Services -> Master DB + Read Replicas' },
                { id: 'search_analytics', label: '🔍 Log & Search Cluster', desc: 'App Logs -> Kafka Ingest -> Elasticsearch -> Kibana' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleStampPreset(p.id)}
                  title={p.desc}
                  style={{
                    fontSize: '9px',
                    fontWeight: 600,
                    padding: '3px 7px',
                    borderRadius: '4px',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    background: 'rgba(16, 185, 129, 0.25)',
                    color: '#ffffff',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.label}
                </button>
              ))}
          </div>
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
            cursor: activeTool === 'select' ? (isPanning ? 'grabbing' : 'grab') : activeTool === 'text' ? 'text' : activeTool === 'eraser' ? 'cell' : 'crosshair',
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
