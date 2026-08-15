// ─── Collaborative Whiteboard Canvas: Multi-Page Notebook, Expanded Architecture Shapes, Custom Text & PDF Export ───

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
  FileText,
  StickyNote,
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
  { label: 'XL', size: 14 },
];

export const WhiteboardCanvas: React.FC = () => {
  const whiteboardService = WhiteboardService.getInstance();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [activeTool, setActiveTool] = useState<WhiteboardToolType>('pen');
  const [activeColor, setActiveColor] = useState<string>('#6366f1');
  const [activeWidth, setActiveWidth] = useState<number>(3);

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

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [startPoint, setStartPoint] = useState<Point | null>(null);

  // Laser Pointer & Torch Trail State
  const [laserTrails, setLaserTrails] = useState<{ x: number; y: number; color: string; alpha: number; timestamp: number }[]>([]);
  const [torchPos, setTorchPos] = useState<{ x: number; y: number } | null>(null);

  // Disappearing / Temporary Ink Strokes Pool
  const [tempStrokes, setTempStrokes] = useState<{ stroke: WhiteboardStroke; createdAt: number; durationMs: number }[]>([]);

  // Text Tool State (Click-to-place on canvas)
  const [textModalPos, setTextModalPos] = useState<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState('');

  // Collapsible drawers for toolbars
  const [showArchDrawer, setShowArchDrawer] = useState(false);
  const [showGeomDrawer, setShowGeomDrawer] = useState(false);
  const [showThemesDrawer, setShowThemesDrawer] = useState(false);

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
      // Red left margin line
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
      // 4-Quadrant Cartesian Axes
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

      // Main Axes
      ctx.strokeStyle = isLight ? '#4f46e5' : '#818cf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.moveTo(midX, 0);
      ctx.lineTo(midX, h);
      ctx.stroke();
    }

    ctx.restore();
  }, [isLightColor]);

  // 4. Vector Shape & Stroke Renderer (Clean - No forced text)
  const renderSingleStroke = useCallback(
    (ctx: CanvasRenderingContext2D, stroke: WhiteboardStroke, isLight: boolean, alphaOverride?: number) => {
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

      if (stroke.tool === 'eraser') {
        ctx.strokeStyle = isLight ? '#f8fafc' : '#090d16';
        ctx.fillStyle = isLight ? '#f8fafc' : '#090d16';
        ctx.lineWidth = stroke.width * 4;
      } else if (stroke.tool === 'brush') {
        ctx.lineCap = 'round';
        ctx.lineWidth = stroke.width * 1.5;
      } else if (stroke.tool === 'temp_pen') {
        ctx.shadowColor = drawColor;
        ctx.shadowBlur = 10;
      }

      if (stroke.text && stroke.geometry) {
        // User Text Stroke
        ctx.font = `bold ${Math.max(12, stroke.width * 3.5)}px -apple-system, sans-serif`;
        ctx.fillText(stroke.text, stroke.geometry.x1, stroke.geometry.y1);
      } else if (stroke.geometry) {
        const { x1, y1, x2, y2, label } = stroke.geometry;
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        const minX = Math.min(x1, x2);
        const minY = Math.min(y1, y2);

        // ── Basic Geometric Shapes ──
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
          // End arrow
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
          // Start arrow
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 + headLen * Math.cos(angle - Math.PI / 6), y1 + headLen * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 + headLen * Math.cos(angle + Math.PI / 6), y1 + headLen * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
        } else if (stroke.tool === 'rect') {
          ctx.strokeRect(minX, minY, width, height);
        } else if (stroke.tool === 'circle') {
          const rx = width / 2;
          const ry = height / 2;
          ctx.beginPath();
          ctx.ellipse(minX + rx, minY + ry, rx, ry, 0, 0, Math.PI * 2);
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
          ctx.roundRect(minX, minY, w, h, 4);
          ctx.fill();
          ctx.stroke();
          // Corner fold
          ctx.fillStyle = 'rgba(0,0,0,0.15)';
          ctx.beginPath();
          ctx.moveTo(minX + w - 14, minY);
          ctx.lineTo(minX + w, minY + 14);
          ctx.lineTo(minX + w - 14, minY + 14);
          ctx.closePath();
          ctx.fill();
        }

        // ── 🏛️ System Design Architecture Shapes (Clean Vector) ──
        else if (stroke.tool === 'db_cylinder') {
          // 🗄️ Relational DB Cylinder (SQL)
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

          // Top Ellipse cap
          ctx.beginPath();
          ctx.ellipse(minX + w / 2, minY + ry, w / 2, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (stroke.tool === 'db_nosql') {
          // 🍃 Document DB Cylinder with partition bands
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

          // 3 Partition Bands
          for (let i = 1; i <= 3; i++) {
            const bandY = minY + (h / 4) * i;
            ctx.beginPath();
            ctx.ellipse(minX + w / 2, bandY, w / 2, ry, 0, 0, Math.PI);
            ctx.stroke();
          }
        } else if (stroke.tool === 'cloud') {
          // ☁️ Cloud Gateway
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
          // ⚖️ Load Balancer Diamond
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

          // Balanced distribution split arrows
          ctx.strokeStyle = drawColor;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(midX, midY - 10);
          ctx.lineTo(midX, midY + 10);
          ctx.moveTo(midX - 10, midY);
          ctx.lineTo(midX + 10, midY);
          ctx.stroke();
        } else if (stroke.tool === 'message_queue') {
          // 📨 Message Queue / Kafka Buffer
          const w = Math.max(80, width);
          const h = Math.max(36, height);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 6);
          ctx.fill();
          ctx.stroke();

          // Queue Segment Dividers
          const segs = 4;
          for (let i = 1; i < segs; i++) {
            const sx = minX + (w / segs) * i;
            ctx.beginPath();
            ctx.moveTo(sx, minY);
            ctx.lineTo(sx, minY + h);
            ctx.stroke();
          }
        } else if (stroke.tool === 'server_box') {
          // 📦 Server Rack Container
          const w = Math.max(70, width);
          const h = Math.max(45, height);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 6);
          ctx.fill();
          ctx.stroke();

          // Server blade horizontal lines & LED
          ctx.beginPath();
          ctx.moveTo(minX + 8, minY + h * 0.5);
          ctx.lineTo(minX + w - 8, minY + h * 0.5);
          ctx.stroke();

          ctx.fillStyle = '#10b981';
          ctx.beginPath();
          ctx.arc(minX + 10, minY + 10, 2.5, 0, Math.PI * 2);
          ctx.fill();
        } else if (stroke.tool === 'cache_mem') {
          // ⚡ Redis Cache Memory Block
          const w = Math.max(65, width);
          const h = Math.max(38, height);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 4);
          ctx.fill();
          ctx.stroke();

          // Lightning Bolt Symbol
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
          // 🌐 DNS / Router Node
          const r = Math.max(22, width / 2);
          const cx = minX + r;
          const cy = minY + r;

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Crossed routing arrows
          ctx.beginPath();
          ctx.moveTo(cx - r * 0.5, cy);
          ctx.lineTo(cx + r * 0.5, cy);
          ctx.moveTo(cx, cy - r * 0.5);
          ctx.lineTo(cx, cy + r * 0.5);
          ctx.stroke();
        } else if (stroke.tool === 'firewall') {
          // 🔒 Security Shield / Firewall
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
          // 👤 User / Client Desktop Actor
          const w = Math.max(45, width);
          const h = Math.max(45, height);
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
          // 📱 Mobile Client Frame
          const w = Math.max(34, width);
          const h = Math.max(54, height);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 6);
          ctx.fill();
          ctx.stroke();

          // Screen bezel
          ctx.strokeRect(minX + 4, minY + 6, w - 8, h - 16);
          // Home button / bar
          ctx.beginPath();
          ctx.arc(minX + w / 2, minY + h - 5, 2, 0, Math.PI * 2);
          ctx.fill();
        }

        // Only draw label if user explicitly entered a label
        if (label && label.trim()) {
          ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, minX + width / 2, minY + height / 2);
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
    },
    []
  );

  // 5. Master Canvas Redraw
  const redrawCanvas = useCallback(
    (strokes: WhiteboardStroke[], previewPoints?: Point[], previewGeometry?: any) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      const isLight = isLightColor(bgColor);

      drawBackground(ctx, w, h, backgroundType, bgColor);
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
            width: activeTool === 'highlighter' ? 14 : activeWidth,
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
            width: activeTool === 'highlighter' ? 14 : activeWidth,
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
        ctx.fillRect(0, 0, w, h);

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
    },
    [activeTool, activeColor, activeWidth, backgroundType, bgColor, drawBackground, isLightColor, laserTrails, renderSingleStroke, tempStrokes, torchPos]
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
    const clientX = 'touches' in e && e.touches[0] ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e && e.touches[0] ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const isShapeTool = [
    'line',
    'arrow',
    'arrow_bi',
    'rect',
    'circle',
    'decision_diamond',
    'tree_node',
    'sticky_note',
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
    const pt = getCanvasCoords(e);

    if (activeTool === 'text') {
      setTextModalPos(pt);
      setTextInput('');
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
    const pt = getCanvasCoords(e);

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
    if (activeTool === 'torch') {
      setTorchPos(null);
      redrawCanvas(whiteboardService.getStrokes());
      return;
    }

    if (!isDrawing) return;
    setIsDrawing(false);

    const endPt = getCanvasCoords(e);
    const strokeWidth = activeTool === 'highlighter' ? 14 : activeWidth;

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
    if (isLightColor(col) && activeColor === '#ffffff') {
      setActiveColor('#0f172a');
    }
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

        {/* Action Right: Duplicate Page & Popout */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => whiteboardService.duplicatePage(notebook.activePageId)}
            title="Duplicate Active Page"
            style={{ fontSize: '9px', padding: '2px 5px', color: 'var(--text-muted)' }}
          >
            <Copy size={9} style={{ marginRight: '2px' }} />
            <span>Copy</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleOpenPopupStandaloneWindow}
            title="Popout Window"
            style={{ fontSize: '9px', padding: '2px 5px', color: 'var(--text-muted)' }}
          >
            <ExternalLink size={9} style={{ marginRight: '2px' }} />
            <span>Popout</span>
          </button>
        </div>
      </div>

      {/* ─── 2. Main Drawing Toolbar (Categorized, Uncluttered) ─── */}
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
        {/* Left Tools: Drawing, Shapes, Arch Drawers */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Primary Pens */}
          {[
            { id: 'pen', icon: Pencil, label: 'Fine Pen' },
            { id: 'brush', icon: PenTool, label: 'Brush' },
            { id: 'highlighter', icon: Highlighter, label: 'Highlighter' },
            { id: 'temp_pen', icon: Clock, label: '⏳ Temp Ink (3s)' },
            { id: 'laser', icon: Flame, label: '🔴 Laser' },
            { id: 'torch', icon: Lightbulb, label: '🔦 Torch' },
            { id: 'eraser', icon: Eraser, label: 'Eraser' },
            { id: 'text', icon: Type, label: '🔤 Text Label' },
          ].map((t) => {
            const Icon = t.icon;
            const isActive = activeTool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                className={`btn-icon ${isActive ? 'active' : ''}`}
                onClick={() => setActiveTool(t.id as any)}
                title={t.label}
                style={{
                  padding: '2px 4px',
                  borderRadius: '4px',
                  border: isActive ? '1px solid var(--primary)' : '1px solid transparent',
                  background: isActive ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
                  color: isActive ? '#c7d2fe' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                <Icon size={11} />
              </button>
            );
          })}

          <div style={{ width: '1px', height: '12px', background: 'var(--border-subtle)', margin: '0 2px' }} />

          {/* Drawer Toggles */}
          <button
            type="button"
            onClick={() => {
              setShowGeomDrawer(!showGeomDrawer);
              setShowArchDrawer(false);
              setShowThemesDrawer(false);
            }}
            style={{
              fontSize: '9px',
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: '4px',
              background: showGeomDrawer ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255,255,255,0.05)',
              border: showGeomDrawer ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.08)',
              color: showGeomDrawer ? '#ffffff' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            📐 Shapes {showGeomDrawer ? '▲' : '▼'}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowArchDrawer(!showArchDrawer);
              setShowGeomDrawer(false);
              setShowThemesDrawer(false);
            }}
            style={{
              fontSize: '9px',
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: '4px',
              background: showArchDrawer ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255,255,255,0.05)',
              border: showArchDrawer ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.08)',
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
              setShowArchDrawer(false);
              setShowGeomDrawer(false);
            }}
            style={{
              fontSize: '9px',
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: '4px',
              background: showThemesDrawer ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255,255,255,0.05)',
              border: showThemesDrawer ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.08)',
              color: showThemesDrawer ? '#ffffff' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            🎨 Themes {showThemesDrawer ? '▲' : '▼'}
          </button>
        </div>

        {/* Right Actions: Collab / Personal Mode, Undo/Redo, Clear, Save */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '1px', background: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
            <button
              type="button"
              onClick={() => {
                setPrivacyMode('collaborative');
                whiteboardService.setPrivacyMode('collaborative');
              }}
              title="👥 Collaborative Room Board"
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
            title="Undo"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
          >
            <RotateCcw size={11} />
          </button>

          <button
            type="button"
            onClick={() => whiteboardService.redo()}
            title="Redo"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
          >
            <RotateCw size={11} />
          </button>

          <button
            type="button"
            onClick={() => {
              if (confirm('Clear collaborative whiteboard canvas?')) {
                whiteboardService.clearAll();
              }
            }}
            title="Clear Canvas"
            style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '2px' }}
          >
            <Trash2 size={11} />
          </button>

          <button
            type="button"
            onClick={handleExportPNG}
            title="Save PNG"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
          >
            <Download size={11} />
          </button>
        </div>
      </div>

      {/* ─── 3. Drawer: Geometric & Flowchart Shapes ─── */}
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
            { id: 'circle', icon: Circle, label: 'Circle' },
            { id: 'decision_diamond', icon: HelpCircle, label: 'Diamond (Decision)' },
            { id: 'tree_node', icon: GitBranch, label: 'Tree / Graph Node' },
            { id: 'sticky_note', icon: StickyNote, label: 'Sticky Note Card' },
          ].map((t) => {
            const Icon = t.icon;
            const isActive = activeTool === t.id;
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
                <Icon size={10} />
                <span>{t.label.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── 4. Drawer: Architecture & Cloud Shapes ─── */}
      {showArchDrawer && (
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
          <span style={{ fontSize: '8.5px', color: 'var(--text-muted)', fontWeight: 600 }}>Arch:</span>
          {[
            { id: 'db_cylinder', icon: Database, label: 'SQL DB', color: '#10b981' },
            { id: 'db_nosql', icon: Database, label: 'NoSQL DB', color: '#34d399' },
            { id: 'cache_mem', icon: Zap, label: 'Redis Cache', color: '#f43f5e' },
            { id: 'message_queue', icon: Layers, label: 'Kafka Queue', color: '#a855f7' },
            { id: 'load_balancer', icon: Scale, label: 'Load Balancer', color: '#f59e0b' },
            { id: 'server_box', icon: Server, label: 'App Server', color: '#818cf8' },
            { id: 'cloud', icon: Cloud, label: 'Cloud Gateway', color: '#38bdf8' },
            { id: 'dns_router', icon: Globe, label: 'DNS / Router', color: '#38bdf8' },
            { id: 'firewall', icon: Shield, label: 'Firewall', color: '#f43f5e' },
            { id: 'user_client', icon: User, label: 'User Client', color: '#3b82f6' },
            { id: 'mobile_client', icon: Smartphone, label: 'Mobile Device', color: '#06b6d4' },
          ].map((t) => {
            const Icon = t.icon;
            const isActive = activeTool === t.id;
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
                  border: isActive ? `1px solid ${t.color}` : '1px solid transparent',
                  background: isActive ? `${t.color}33` : 'transparent',
                  color: isActive ? '#ffffff' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '9px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <Icon size={10} color={t.color} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── 5. Drawer: Themes & Swatches ─── */}
      {showThemesDrawer && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '3px 8px',
            background: 'rgba(0, 0, 0, 0.85)',
            borderBottom: '1px solid var(--border-subtle)',
            flexWrap: 'wrap',
            gap: '6px',
            flexShrink: 0,
          }}
        >
          {/* Background Textures */}
          <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
            <span style={{ fontSize: '8.5px', color: 'var(--text-muted)' }}>Texture:</span>
            {[
              { id: 'grid', label: 'Grid' },
              { id: 'ruled', label: 'Ruled' },
              { id: 'plot', label: 'Cartesian Plot' },
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

          {/* Pen Color Swatches */}
          <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
            <span style={{ fontSize: '8.5px', color: 'var(--text-muted)' }}>Ink:</span>
            {PEN_COLORS.map((c) => (
              <span
                key={c}
                onClick={() => setActiveColor(c)}
                style={{
                  width: '11px',
                  height: '11px',
                  borderRadius: '50%',
                  background: c,
                  cursor: 'pointer',
                  border: activeColor === c ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.2)',
                  transform: activeColor === c ? 'scale(1.2)' : 'none',
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* ─── 6. Master Canvas Drawing Workspace ─── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
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

        {/* Inline On-Canvas Text Input Tool Popover */}
        {textModalPos && (
          <div
            style={{
              position: 'absolute',
              left: `${Math.min(textModalPos.x, (containerRef.current?.clientWidth || 300) - 220)}px`,
              top: `${Math.max(10, textModalPos.y - 38)}px`,
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
