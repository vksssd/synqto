// ─── Synqto Diary Embedded Whiteboard Sketchpad Component ───
// Full Feature Parity: DSA Visualizers, Architecture Nodes, 18 Presets, 3D Isometric & Independent Styles

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
  Code,
  Shield,
  Smartphone,
  Globe,
  StickyNote,
  Triangle,
  Star,
  LayoutGrid,
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
  pen: { color: '#6366f1', width: 3 },
  brush: { color: '#06b6d4', width: 6 },
  highlighter: { color: '#f59e0b', width: 16 },
  temp_pen: { color: '#38bdf8', width: 3 },
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
  array_cells: { color: '#38bdf8', width: 2.5 },
  stack_lifo: { color: '#f59e0b', width: 2.5 },
  queue_fifo: { color: '#10b981', width: 2.5 },
  hashmap_table: { color: '#a855f7', width: 2.5 },
  two_pointers: { color: '#ec4899', width: 2 },
  cdn_edge: { color: '#06b6d4', width: 2.5 },
  object_storage: { color: '#f97316', width: 2.5 },
  auth_jwt: { color: '#eab308', width: 2.5 },
  websocket_gw: { color: '#6366f1', width: 2.5 },
  elasticsearch: { color: '#14b8a6', width: 2.5 },
  async_arrow: { color: '#a855f7', width: 2 },
  tradeoff_note: { color: '#facc15', width: 2 },
};

function distanceToLineSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const l2 = (x2 - x1) * (x2 - x1) + (py - y1) * (y2 - y1);
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

    if (stroke.tool === 'line' || stroke.tool === 'arrow' || stroke.tool === 'arrow_bi' || stroke.tool === 'two_pointers') {
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
  const [showPresetsDrawer, setShowPresetsDrawer] = useState(false);
  const [showBgDrawer, setShowBgDrawer] = useState(false);
  const [presetTab, setPresetTab] = useState<'dsa' | 'arch'>('dsa');

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

  const handleStampPreset = (type: string) => {
    const cx = (containerRef.current?.clientWidth || 400) / 2;
    const cy = (containerRef.current?.clientHeight || 300) / 2;
    const newStrokes: Stroke[] = [];

    const addStk = (tool: string, color: string, width: number, geom?: any, label?: string) => {
      newStrokes.push({
        id: `stamp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        tool,
        color,
        width,
        points: [],
        geometry: geom ? { ...geom, label } : undefined,
        timestamp: Date.now(),
      });
    };

    if (type === 'two_pointers') {
      addStk('array_cells', '#38bdf8', 2.5, { x1: cx - 110, y1: cy, x2: cx + 110, y2: cy + 34 });
      addStk('two_pointers', '#ec4899', 2, { x1: cx - 90, y1: cy + 38, x2: cx - 90, y2: cy + 58 }, 'L (left=0)');
      addStk('two_pointers', '#10b981', 2, { x1: cx + 70, y1: cy + 38, x2: cx + 70, y2: cy + 58 }, 'R (right=4)');
    } else if (type === 'bst') {
      addStk('tree_node', '#10b981', 3, { x1: cx, y1: cy, x2: cx, y2: cy }, '50');
      addStk('tree_node', '#06b6d4', 3, { x1: cx - 60, y1: cy + 55, x2: cx - 60, y2: cy + 55 }, '30');
      addStk('tree_node', '#06b6d4', 3, { x1: cx + 60, y1: cy + 55, x2: cx + 60, y2: cy + 55 }, '70');
      addStk('arrow', '#6366f1', 2, { x1: cx - 10, y1: cy + 10, x2: cx - 45, y2: cy + 45 });
      addStk('arrow', '#6366f1', 2, { x1: cx + 10, y1: cy + 10, x2: cx + 45, y2: cy + 45 });
    } else if (type === 'url_shortener') {
      addStk('user_client', '#3b82f6', 2.5, { x1: cx - 120, y1: cy, x2: cx - 85, y2: cy + 35 }, 'Client');
      addStk('arrow', '#6366f1', 2, { x1: cx - 85, y1: cy + 17, x2: cx - 60, y2: cy + 17 });
      addStk('load_balancer', '#f59e0b', 2.5, { x1: cx - 60, y1: cy - 5, x2: cx - 15, y2: cy + 38 }, 'LB');
      addStk('arrow', '#6366f1', 2, { x1: cx - 15, y1: cy + 17, x2: cx + 10, y2: cy + 17 });
      addStk('server_box', '#818cf8', 2.5, { x1: cx + 10, y1: cy - 5, x2: cx + 65, y2: cy + 35 }, 'App Srv');
      addStk('arrow', '#10b981', 2, { x1: cx + 65, y1: cy + 8, x2: cx + 90, y2: cy - 15 });
      addStk('cache_mem', '#f43f5e', 2.5, { x1: cx + 90, y1: cy - 35, x2: cx + 145, y2: cy - 5 }, 'Redis');
      addStk('arrow', '#10b981', 2, { x1: cx + 65, y1: cy + 24, x2: cx + 90, y2: cy + 40 });
      addStk('db_cylinder', '#10b981', 2.5, { x1: cx + 90, y1: cy + 25, x2: cx + 145, y2: cy + 70 }, 'SQL DB');
    }

    setUndoStack((prev) => [...prev, strokes]);
    const updated = [...strokes, ...newStrokes];
    setStrokes(updated);
    onChange({ strokes: updated, bgColor, bgPattern });
    setShowPresetsDrawer(false);
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
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
          {[
            { id: 'pen', icon: Pencil, label: 'Pen', defColor: '#6366f1' },
            { id: 'temp_pen', icon: Clock, label: 'Temp Ink (3s)', defColor: '#38bdf8' },
            { id: 'eraser', icon: Eraser, label: 'Eraser', defColor: '#ffffff' },
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
                title={`${t.label} (Remembers style)`}
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
              setShowPresetsDrawer(false);
              setShowBgDrawer(false);
            }}
            style={{
              fontSize: '10px',
              padding: '2px 5px',
              borderRadius: '4px',
              border: '1px solid var(--border-subtle)',
              background: showShapesDrawer ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: showShapesDrawer ? '#ffffff' : 'var(--text-muted)',
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
              setShowPresetsDrawer(false);
              setShowBgDrawer(false);
            }}
            style={{
              fontSize: '10px',
              padding: '2px 5px',
              borderRadius: '4px',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              background: showDsaDrawer ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
              color: showDsaDrawer ? '#38bdf8' : 'var(--text-muted)',
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
              setShowPresetsDrawer(false);
              setShowBgDrawer(false);
            }}
            style={{
              fontSize: '10px',
              padding: '2px 5px',
              borderRadius: '4px',
              border: '1px solid var(--border-subtle)',
              background: showArchDrawer ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: showArchDrawer ? '#ffffff' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            🏛️ Arch {showArchDrawer ? '▲' : '▼'}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowPresetsDrawer(!showPresetsDrawer);
              setShowShapesDrawer(false);
              setShowDsaDrawer(false);
              setShowArchDrawer(false);
              setShowBgDrawer(false);
            }}
            style={{
              fontSize: '10px',
              padding: '2px 5px',
              borderRadius: '4px',
              border: '1px solid rgba(16, 185, 129, 0.35)',
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
              setShowBgDrawer(!showBgDrawer);
              setShowShapesDrawer(false);
              setShowDsaDrawer(false);
              setShowArchDrawer(false);
              setShowPresetsDrawer(false);
            }}
            style={{
              fontSize: '10px',
              padding: '2px 5px',
              borderRadius: '4px',
              border: '1px solid var(--border-subtle)',
              background: showBgDrawer ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: showBgDrawer ? '#ffffff' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            🎨 Grid & BG {showBgDrawer ? '▲' : '▼'}
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
        <div style={{ display: 'flex', gap: '3px', padding: '3px 8px', background: 'rgba(0,0,0,0.85)', borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
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
                padding: '2px 5px',
                borderRadius: '3px',
                border: activeTool === t.id ? '1px solid var(--primary)' : '1px solid transparent',
                background: activeTool === t.id ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255,255,255,0.05)',
                color: '#ffffff',
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
        <div style={{ display: 'flex', gap: '3px', padding: '3px 8px', background: 'rgba(8, 28, 44, 0.95)', borderBottom: '1px solid rgba(56, 189, 248, 0.3)', overflowX: 'auto' }}>
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
                padding: '2px 5px',
                borderRadius: '3px',
                border: activeTool === t.id ? '1px solid #38bdf8' : '1px solid transparent',
                background: activeTool === t.id ? 'rgba(56, 189, 248, 0.3)' : 'rgba(255,255,255,0.05)',
                color: '#7dd3fc',
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
        <div style={{ display: 'flex', gap: '3px', padding: '3px 8px', background: 'rgba(0,0,0,0.9)', borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
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
                padding: '2px 5px',
                borderRadius: '3px',
                border: activeTool === t.id ? '1px solid var(--primary)' : '1px solid transparent',
                background: activeTool === t.id ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255,255,255,0.05)',
                color: '#ffffff',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ─── Drawer: Presets ─── */}
      {showPresetsDrawer && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '4px 8px', background: 'rgba(6, 44, 36, 0.96)', borderBottom: '1px solid rgba(16, 185, 129, 0.35)' }}>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              type="button"
              onClick={() => setPresetTab('dsa')}
              style={{
                fontSize: '9px',
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: '3px',
                border: 'none',
                background: presetTab === 'dsa' ? '#10b981' : 'rgba(255,255,255,0.08)',
                color: presetTab === 'dsa' ? '#ffffff' : '#a7f3d0',
                cursor: 'pointer',
              }}
            >
              🔲 DSA Presets
            </button>
            <button
              type="button"
              onClick={() => setPresetTab('arch')}
              style={{
                fontSize: '9px',
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: '3px',
                border: 'none',
                background: presetTab === 'arch' ? '#10b981' : 'rgba(255,255,255,0.08)',
                color: presetTab === 'arch' ? '#ffffff' : '#a7f3d0',
                cursor: 'pointer',
              }}
            >
              🏛️ System Design
            </button>
          </div>
          <div style={{ display: 'flex', gap: '3px', overflowX: 'auto', paddingBottom: '2px' }}>
            {presetTab === 'dsa' ? (
              <>
                <button type="button" onClick={() => handleStampPreset('two_pointers')} style={{ fontSize: '9px', padding: '2px 5px', borderRadius: '3px', background: 'rgba(16,185,129,0.25)', border: '1px solid rgba(16,185,129,0.4)', color: '#ffffff', cursor: 'pointer', whiteSpace: 'nowrap' }}>👆 Two Pointers</button>
                <button type="button" onClick={() => handleStampPreset('bst')} style={{ fontSize: '9px', padding: '2px 5px', borderRadius: '3px', background: 'rgba(16,185,129,0.25)', border: '1px solid rgba(16,185,129,0.4)', color: '#ffffff', cursor: 'pointer', whiteSpace: 'nowrap' }}>🌲 BST Tree</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => handleStampPreset('url_shortener')} style={{ fontSize: '9px', padding: '2px 5px', borderRadius: '3px', background: 'rgba(16,185,129,0.25)', border: '1px solid rgba(16,185,129,0.4)', color: '#ffffff', cursor: 'pointer', whiteSpace: 'nowrap' }}>🔗 TinyURL Architecture</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── Drawer: Background & Themes ─── */}
      {showBgDrawer && (
        <div style={{ display: 'flex', gap: '4px', padding: '4px 8px', background: 'rgba(0,0,0,0.85)', borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
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
                border: bgColor === bp.color && bgPattern === bp.pattern ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.1)',
                background: bgColor === bp.color && bgPattern === bp.pattern ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255,255,255,0.04)',
                color: '#ffffff',
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
