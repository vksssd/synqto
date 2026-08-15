// ─── Collaborative Whiteboard Canvas: Notebook Pages, System Design Shapes, Disappearing Ink & Custom Colors ───

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
} from 'lucide-react';
import { WhiteboardService } from './whiteboard.service';
import {
  WhiteboardToolType,
  WhiteboardBackgroundType,
  WhiteboardSizeMode,
  WhiteboardPrivacyMode,
  WhiteboardStroke,
  WhiteboardPage,
  WhiteboardNotebook,
  Point,
  LaserPointerPosition,
} from './whiteboard.types';

const PEN_COLORS = [
  '#6366f1', // Indigo
  '#06b6d4', // Cyan
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#f43f5e', // Rose
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
  const [activeWidth, setActiveWidth] = useState<number>(4);

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

  // Text Prompt Modal State
  const [textModalPos, setTextModalPos] = useState<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState('');

  // Collapsible drawers for maximum canvas workspace
  const [showShapesDrawer, setShowShapesDrawer] = useState(false);
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

      // Laser fade
      setLaserTrails((prev) => {
        if (prev.length === 0) return prev;
        return prev
          .filter((pt) => now - pt.timestamp < 1200)
          .map((pt) => ({
            ...pt,
            alpha: Math.max(0, 1 - (now - pt.timestamp) / 1200),
          }));
      });

      // Disappearing ink fade
      setTempStrokes((prev) => {
        if (prev.length === 0) return prev;
        return prev.filter((item) => now - item.createdAt < item.durationMs);
      });
    }, 40);

    return () => clearInterval(interval);
  }, []);

  // 3. Helper to determine if background color is light
  const isLightColor = useCallback((hex: string) => {
    if (hex === '#ffffff' || hex === '#f8fafc' || hex === '#fef3c7') return true;
    return false;
  }, []);

  // 4. Background Pattern Renderer
  const drawBackground = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, bg: WhiteboardBackgroundType, color: string) => {
    ctx.save();
    const isLight = isLightColor(color);

    // Canvas base background fill
    ctx.fillStyle = color || (isLight ? '#f8fafc' : '#090d16');
    ctx.fillRect(0, 0, w, h);

    if (bg === 'grid') {
      // ⬛ Graph Grid
      ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.05)';
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
      // 📏 Ruled Notebook Paper
      ctx.strokeStyle = isLight ? 'rgba(99, 102, 241, 0.25)' : 'rgba(99, 102, 241, 0.16)';
      ctx.lineWidth = 1;
      const lineGap = 28;
      for (let y = 36; y < h; y += lineGap) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Vertical pink margin line
      ctx.strokeStyle = isLight ? 'rgba(244, 63, 94, 0.5)' : 'rgba(244, 63, 94, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(48, 0);
      ctx.lineTo(48, h);
      ctx.stroke();
    } else if (bg === 'dotted') {
      // 🟦 Dot Matrix Grid
      ctx.fillStyle = isLight ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.18)';
      const dotGap = 20;
      for (let x = 10; x < w; x += dotGap) {
        for (let y = 10; y < h; y += dotGap) {
          ctx.beginPath();
          ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (bg === 'plot') {
      // 📈 Cartesian (X, Y) 4-Quadrant Coordinate Axes & Ticks
      const midX = Math.floor(w / 2);
      const midY = Math.floor(h / 2);

      ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 1;
      const gridSize = 20;
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

      ctx.strokeStyle = isLight ? '#334155' : '#818cf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.moveTo(midX, 0);
      ctx.lineTo(midX, h);
      ctx.stroke();

      // Axis Ticks
      ctx.strokeStyle = isLight ? '#64748b' : '#a5b4fc';
      ctx.lineWidth = 1;
      for (let x = midX; x < w; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, midY - 3);
        ctx.lineTo(x, midY + 3);
        ctx.stroke();
      }
      for (let x = midX; x > 0; x -= 40) {
        ctx.beginPath();
        ctx.moveTo(x, midY - 3);
        ctx.lineTo(x, midY + 3);
        ctx.stroke();
      }
      for (let y = midY; y < h; y += 40) {
        ctx.beginPath();
        ctx.moveTo(midX - 3, y);
        ctx.lineTo(midX + 3, y);
        ctx.stroke();
      }
      for (let y = midY; y > 0; y -= 40) {
        ctx.beginPath();
        ctx.moveTo(midX - 3, y);
        ctx.lineTo(midX + 3, y);
        ctx.stroke();
      }

      ctx.fillStyle = isLight ? '#64748b' : '#c7d2fe';
      ctx.font = '10px monospace';
      ctx.fillText('(0,0)', midX + 6, midY - 6);
      ctx.fillText('+X', w - 24, midY - 6);
      ctx.fillText('+Y', midX + 6, 16);
    } else if (bg === 'matrix') {
      // 📐 2D DP Table
      ctx.strokeStyle = isLight ? 'rgba(99, 102, 241, 0.3)' : 'rgba(99, 102, 241, 0.15)';
      ctx.lineWidth = 1;
      const cell = 32;

      for (let x = 32; x < w; x += cell) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 32; y < h; y += cell) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      ctx.fillStyle = isLight ? '#4f46e5' : '#a5b4fc';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      let colIdx = 0;
      for (let x = 32 + cell / 2; x < w; x += cell) {
        ctx.fillText(String(colIdx++), x, 16);
      }
      let rowIdx = 0;
      for (let y = 32 + cell / 2; y < h; y += cell) {
        ctx.fillText(String(rowIdx++), 16, y);
      }
    }

    ctx.restore();
  }, [isLightColor]);

  // 5. System Design Shapes & Geometric Stroke Renderer
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
        // Text Note Tool
        ctx.font = `bold ${Math.max(12, stroke.width * 3)}px -apple-system, sans-serif`;
        ctx.fillText(stroke.text, stroke.geometry.x1, stroke.geometry.y1);
      } else if (stroke.geometry) {
        const { x1, y1, x2, y2 } = stroke.geometry;
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        const minX = Math.min(x1, x2);
        const minY = Math.min(y1, y2);

        // Basic Shapes
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
          ctx.strokeRect(minX, minY, width, height);
        } else if (stroke.tool === 'circle') {
          const rx = width / 2;
          const ry = height / 2;
          ctx.beginPath();
          ctx.ellipse(minX + rx, minY + ry, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (stroke.tool === 'tree_node') {
          const radius = Math.max(18, stroke.width * 4);
          ctx.beginPath();
          ctx.arc(x1, y1, radius, 0, Math.PI * 2);
          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 12px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(stroke.geometry.label || 'Node', x1, y1);
        }

        // 🏛️ System Design Shapes
        else if (stroke.tool === 'db_cylinder') {
          // 🗄️ 3D Database Cylinder
          const w = Math.max(50, width);
          const h = Math.max(60, height);
          const ry = Math.min(16, h * 0.2);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';

          // Body fill & stroke
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

          // Database text label
          ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(stroke.geometry.label || '🗄️ Database', minX + w / 2, minY + h / 2 + 4);
        } else if (stroke.tool === 'cloud') {
          // ☁️ Cloud / API Gateway Cluster
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

          ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(stroke.geometry.label || '☁️ Cloud Gateway', minX + w / 2, minY + h / 2 + 2);
        } else if (stroke.tool === 'load_balancer') {
          // ⚖️ Load Balancer Diamond
          const w = Math.max(60, width);
          const h = Math.max(60, height);
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

          ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('⚖️ LB', midX, midY);
        } else if (stroke.tool === 'message_queue') {
          // 📨 Message Queue / Kafka Buffer
          const w = Math.max(80, width);
          const h = Math.max(36, height);
          const rx = 12;

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

          ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('📨 Queue', minX + w / 2, minY + h / 2);
        } else if (stroke.tool === 'server_box') {
          // 📦 Server Container / Microservice Box
          const w = Math.max(70, width);
          const h = Math.max(45, height);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 6);
          ctx.fill();
          ctx.stroke();

          // Green LED status dot
          ctx.fillStyle = '#10b981';
          ctx.beginPath();
          ctx.arc(minX + 12, minY + 12, 3, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(stroke.geometry.label || '📦 App Server', minX + w / 2, minY + h / 2 + 3);
        } else if (stroke.tool === 'cache_mem') {
          // ⚡ Redis Cache Memory Block
          const w = Math.max(65, width);
          const h = Math.max(38, height);

          ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 4);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('⚡ Cache / Redis', minX + w / 2, minY + h / 2);
        } else if (stroke.tool === 'user_client') {
          // 👤 Client Actor
          const w = Math.max(50, width);
          const h = Math.max(50, height);
          const midX = minX + w / 2;

          ctx.beginPath();
          ctx.arc(midX, minY + 12, 8, 0, Math.PI * 2);
          ctx.moveTo(midX, minY + 20);
          ctx.lineTo(midX, minY + 36);
          ctx.lineTo(midX - 10, minY + 48);
          ctx.moveTo(midX, minY + 36);
          ctx.lineTo(midX + 10, minY + 48);
          ctx.moveTo(midX - 12, minY + 26);
          ctx.lineTo(midX + 12, minY + 26);
          ctx.stroke();

          ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('👤 Client', midX, minY + h + 8);
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

  // 6. Master Canvas Redraw
  const redrawCanvas = useCallback(
    (strokes: WhiteboardStroke[], previewPoints?: Point[], previewGeometry?: any) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      const isLight = isLightColor(bgColor);

      // 1. Background Pattern on selected BG Color
      drawBackground(ctx, w, h, backgroundType, bgColor);

      // 2. Render all strokes on active page
      strokes.forEach((s) => renderSingleStroke(ctx, s, isLight));

      // 3. Render Disappearing Temporary Ink Strokes
      const now = Date.now();
      tempStrokes.forEach((item) => {
        const elapsed = now - item.createdAt;
        const alpha = Math.max(0, 1 - elapsed / item.durationMs);
        renderSingleStroke(ctx, item.stroke, isLight, alpha);
      });

      // 4. Render Active Drag Preview
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

      // 5. Render Torch / Spotlight Beam
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
        ctx.shadowColor = '#fde047';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(torchPos.x, torchPos.y, 65, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 6. Render Laser Pointer Trails
      laserTrails.forEach((pt) => {
        ctx.save();
        ctx.globalAlpha = pt.alpha;
        ctx.fillStyle = pt.color || '#ef4444';
        ctx.shadowColor = pt.color || '#ef4444';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5 * pt.alpha, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    },
    [
      activeTool,
      activeColor,
      activeWidth,
      backgroundType,
      bgColor,
      drawBackground,
      isLightColor,
      laserTrails,
      renderSingleStroke,
      tempStrokes,
      torchPos,
    ]
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

  // Subscribe to stroke changes
  useEffect(() => {
    return whiteboardService.onStrokesChange((strokes) => {
      redrawCanvas(strokes);
    });
  }, [redrawCanvas, whiteboardService]);

  // Pointer Coordinates helper
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

  // Pointer Down
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

  // Pointer Move
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

    const isGeometry = [
      'line',
      'arrow',
      'rect',
      'circle',
      'tree_node',
      'db_cylinder',
      'cloud',
      'load_balancer',
      'message_queue',
      'server_box',
      'cache_mem',
      'user_client',
    ].includes(activeTool);

    if (isGeometry && startPoint) {
      redrawCanvas(whiteboardService.getStrokes(), undefined, {
        x1: startPoint.x,
        y1: startPoint.y,
        x2: pt.x,
        y2: pt.y,
        label:
          activeTool === 'tree_node'
            ? 'Node'
            : activeTool === 'db_cylinder'
            ? '🗄️ Database'
            : activeTool === 'cloud'
            ? '☁️ Cloud'
            : activeTool === 'server_box'
            ? '📦 Server'
            : undefined,
      });
    } else {
      const updated = [...currentPoints, pt];
      setCurrentPoints(updated);
      redrawCanvas(whiteboardService.getStrokes(), updated);
    }
  };

  // Pointer Up
  const handlePointerUp = (e: React.MouseEvent | React.TouchEvent) => {
    if (activeTool === 'torch') {
      setTorchPos(null);
      redrawCanvas(whiteboardService.getStrokes());
      return;
    }

    if (!isDrawing) return;
    setIsDrawing(false);

    const endPt = getCanvasCoords(e);
    const isGeometry = [
      'line',
      'arrow',
      'rect',
      'circle',
      'tree_node',
      'db_cylinder',
      'cloud',
      'load_balancer',
      'message_queue',
      'server_box',
      'cache_mem',
      'user_client',
    ].includes(activeTool);
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
          label:
            activeTool === 'tree_node'
              ? String(Math.floor(Math.random() * 50) + 1)
              : activeTool === 'db_cylinder'
              ? '🗄️ Database'
              : activeTool === 'cloud'
              ? '☁️ API Gateway'
              : activeTool === 'server_box'
              ? '📦 App Server'
              : undefined,
        }
      );
    } else if (currentPoints.length > 0) {
      whiteboardService.addStroke(activeTool, activeColor, strokeWidth, currentPoints);
    }

    setCurrentPoints([]);
    setStartPoint(null);
  };

  // Add Text Note
  const handleConfirmTextNote = () => {
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

          {/* Add Page Button */}
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

      {/* ─── 2. Main Drawing Toolbar (Ultra-Streamlined) ─── */}
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
        {/* Primary Pens & Geometry Tools */}
        <div style={{ display: 'flex', gap: '2px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Fine Pen */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'pen' ? 'active' : ''}`}
            onClick={() => setActiveTool('pen')}
            title="Fine Pen"
            style={{
              padding: '2px 4px',
              borderRadius: '4px',
              border: activeTool === 'pen' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'pen' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'pen' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Pencil size={11} />
          </button>

          {/* Brush Pen */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'brush' ? 'active' : ''}`}
            onClick={() => setActiveTool('brush')}
            title="Brush Pen"
            style={{
              padding: '2px 4px',
              borderRadius: '4px',
              border: activeTool === 'brush' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'brush' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'brush' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <PenTool size={11} />
          </button>

          {/* Highlighter */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'highlighter' ? 'active' : ''}`}
            onClick={() => setActiveTool('highlighter')}
            title="Highlighter"
            style={{
              padding: '2px 4px',
              borderRadius: '4px',
              border: activeTool === 'highlighter' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'highlighter' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'highlighter' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Highlighter size={11} />
          </button>

          {/* ⏳ Disappearing Ink */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'temp_pen' ? 'active' : ''}`}
            onClick={() => setActiveTool('temp_pen')}
            title="⏳ Temporary / Disappearing Ink (Fades in 3s)"
            style={{
              padding: '2px 4px',
              borderRadius: '4px',
              border: activeTool === 'temp_pen' ? '1px solid #38bdf8' : '1px solid transparent',
              background: activeTool === 'temp_pen' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
              color: activeTool === 'temp_pen' ? '#7dd3fc' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Clock size={11} color="#38bdf8" />
          </button>

          {/* Laser Pointer */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'laser' ? 'active' : ''}`}
            onClick={() => setActiveTool('laser')}
            title="🔴 Laser Pointer"
            style={{
              padding: '2px 4px',
              borderRadius: '4px',
              border: activeTool === 'laser' ? '1px solid #ef4444' : '1px solid transparent',
              background: activeTool === 'laser' ? 'rgba(239, 68, 68, 0.25)' : 'transparent',
              color: activeTool === 'laser' ? '#fca5a5' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Flame size={11} color="#ef4444" />
          </button>

          {/* Spotlight Torch */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'torch' ? 'active' : ''}`}
            onClick={() => setActiveTool('torch')}
            title="🔦 Spotlight Torch"
            style={{
              padding: '2px 4px',
              borderRadius: '4px',
              border: activeTool === 'torch' ? '1px solid #facc15' : '1px solid transparent',
              background: activeTool === 'torch' ? 'rgba(250, 204, 21, 0.25)' : 'transparent',
              color: activeTool === 'torch' ? '#fef08a' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Lightbulb size={11} color="#facc15" />
          </button>

          {/* Eraser */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'eraser' ? 'active' : ''}`}
            onClick={() => setActiveTool('eraser')}
            title="Eraser"
            style={{
              padding: '2px 4px',
              borderRadius: '4px',
              border: activeTool === 'eraser' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'eraser' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'eraser' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Eraser size={11} />
          </button>

          <div style={{ width: '1px', height: '12px', background: 'var(--border-subtle)', margin: '0 1px' }} />

          {/* Text Note */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'text' ? 'active' : ''}`}
            onClick={() => setActiveTool('text')}
            title="Text Note"
            style={{
              padding: '2px 4px',
              borderRadius: '4px',
              border: activeTool === 'text' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'text' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'text' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Type size={11} />
          </button>

          {/* Arrow */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'arrow' ? 'active' : ''}`}
            onClick={() => setActiveTool('arrow')}
            title="Arrow"
            style={{
              padding: '2px 4px',
              borderRadius: '4px',
              border: activeTool === 'arrow' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'arrow' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'arrow' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <MoveRight size={11} />
          </button>

          {/* Box */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'rect' ? 'active' : ''}`}
            onClick={() => setActiveTool('rect')}
            title="Box"
            style={{
              padding: '2px 4px',
              borderRadius: '4px',
              border: activeTool === 'rect' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'rect' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'rect' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Square size={11} />
          </button>

          {/* Tree Node */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'tree_node' ? 'active' : ''}`}
            onClick={() => setActiveTool('tree_node')}
            title="Tree Node"
            style={{
              padding: '2px 4px',
              borderRadius: '4px',
              border: activeTool === 'tree_node' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'tree_node' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'tree_node' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <GitBranch size={11} />
          </button>

          <div style={{ width: '1px', height: '12px', background: 'var(--border-subtle)', margin: '0 1px' }} />

          {/* Drawer Toggles */}
          <button
            type="button"
            onClick={() => {
              setShowShapesDrawer(!showShapesDrawer);
              setShowThemesDrawer(false);
            }}
            style={{
              fontSize: '9px',
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: '4px',
              background: showShapesDrawer ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255,255,255,0.05)',
              border: showShapesDrawer ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.08)',
              color: showShapesDrawer ? '#ffffff' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            🏛️ Arch {showShapesDrawer ? '▲' : '▼'}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowThemesDrawer(!showThemesDrawer);
              setShowShapesDrawer(false);
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

        {/* Action Controls: Privacy Mode, Undo, Clear, Save */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          {/* Privacy Mode */}
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

      {/* ─── 3. Collapsible Drawer: System Design Architecture Shapes ─── */}
      {showShapesDrawer && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '3px 8px',
            background: 'rgba(0, 0, 0, 0.75)',
            borderBottom: '1px solid var(--border-subtle)',
            overflowX: 'auto',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '8.5px', color: 'var(--text-muted)', fontWeight: 600 }}>Arch Shapes:</span>
          {/* Database */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'db_cylinder' ? 'active' : ''}`}
            onClick={() => setActiveTool('db_cylinder')}
            title="🗄️ Database Cylinder"
            style={{
              padding: '2px 5px',
              borderRadius: '4px',
              border: activeTool === 'db_cylinder' ? '1px solid #10b981' : '1px solid transparent',
              background: activeTool === 'db_cylinder' ? 'rgba(16, 185, 129, 0.25)' : 'transparent',
              color: activeTool === 'db_cylinder' ? '#6ee7b7' : 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '9px',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            <Database size={10} color="#10b981" />
            <span>DB</span>
          </button>

          {/* Cloud */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'cloud' ? 'active' : ''}`}
            onClick={() => setActiveTool('cloud')}
            title="☁️ Cloud Gateway"
            style={{
              padding: '2px 5px',
              borderRadius: '4px',
              border: activeTool === 'cloud' ? '1px solid #38bdf8' : '1px solid transparent',
              background: activeTool === 'cloud' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
              color: activeTool === 'cloud' ? '#7dd3fc' : 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '9px',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            <Cloud size={10} color="#38bdf8" />
            <span>Cloud</span>
          </button>

          {/* Load Balancer */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'load_balancer' ? 'active' : ''}`}
            onClick={() => setActiveTool('load_balancer')}
            title="⚖️ Load Balancer"
            style={{
              padding: '2px 5px',
              borderRadius: '4px',
              border: activeTool === 'load_balancer' ? '1px solid #f59e0b' : '1px solid transparent',
              background: activeTool === 'load_balancer' ? 'rgba(245, 158, 11, 0.25)' : 'transparent',
              color: activeTool === 'load_balancer' ? '#fcd34d' : 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '9px',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            <Scale size={10} color="#f59e0b" />
            <span>LB</span>
          </button>

          {/* Message Queue */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'message_queue' ? 'active' : ''}`}
            onClick={() => setActiveTool('message_queue')}
            title="📨 Message Queue / Kafka Buffer"
            style={{
              padding: '2px 5px',
              borderRadius: '4px',
              border: activeTool === 'message_queue' ? '1px solid #a855f7' : '1px solid transparent',
              background: activeTool === 'message_queue' ? 'rgba(168, 85, 247, 0.25)' : 'transparent',
              color: activeTool === 'message_queue' ? '#d8b4fe' : 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '9px',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            <Layers size={10} color="#a855f7" />
            <span>Queue</span>
          </button>

          {/* Server Container */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'server_box' ? 'active' : ''}`}
            onClick={() => setActiveTool('server_box')}
            title="📦 App Server Container"
            style={{
              padding: '2px 5px',
              borderRadius: '4px',
              border: activeTool === 'server_box' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'server_box' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'server_box' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '9px',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            <Server size={10} color="#818cf8" />
            <span>Server</span>
          </button>

          {/* Cache */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'cache_mem' ? 'active' : ''}`}
            onClick={() => setActiveTool('cache_mem')}
            title="⚡ In-Memory Cache / Redis"
            style={{
              padding: '2px 5px',
              borderRadius: '4px',
              border: activeTool === 'cache_mem' ? '1px solid #f43f5e' : '1px solid transparent',
              background: activeTool === 'cache_mem' ? 'rgba(244, 63, 94, 0.25)' : 'transparent',
              color: activeTool === 'cache_mem' ? '#fda4af' : 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '9px',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            <Zap size={10} color="#f43f5e" />
            <span>Cache</span>
          </button>

          {/* Client Actor */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'user_client' ? 'active' : ''}`}
            onClick={() => setActiveTool('user_client')}
            title="👤 Client Actor"
            style={{
              padding: '2px 5px',
              borderRadius: '4px',
              border: activeTool === 'user_client' ? '1px solid #3b82f6' : '1px solid transparent',
              background: activeTool === 'user_client' ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
              color: activeTool === 'user_client' ? '#93c5fd' : 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '9px',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            <User size={10} color="#3b82f6" />
            <span>Client</span>
          </button>
        </div>
      )}

      {/* ─── 4. Collapsible Drawer: Background Themes, BG Colors & Color Palette ─── */}
      {showThemesDrawer && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '3px 8px',
            background: 'rgba(0, 0, 0, 0.75)',
            borderBottom: '1px solid var(--border-subtle)',
            flexWrap: 'wrap',
            gap: '4px',
            flexShrink: 0,
          }}
        >
          {/* Background Patterns & Background Color Swatches */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '8.5px', color: 'var(--text-muted)', fontWeight: 600 }}>Pattern:</span>
            {[
              { id: 'grid', label: 'Grid' },
              { id: 'ruled', label: 'Ruled' },
              { id: 'plot', label: 'Plot' },
              { id: 'dotted', label: 'Dots' },
              { id: 'matrix', label: 'Matrix' },
              { id: 'blank', label: 'Blank' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectBackground(p.id as any)}
                style={{
                  fontSize: '8.5px',
                  padding: '1px 4px',
                  borderRadius: '3px',
                  background: backgroundType === p.id ? 'var(--primary)' : 'rgba(255,255,255,0.06)',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {p.label}
              </button>
            ))}

            <div style={{ width: '1px', height: '10px', background: 'var(--border-subtle)', margin: '0 1px' }} />

            <span style={{ fontSize: '8.5px', color: 'var(--text-muted)', fontWeight: 600 }}>BG:</span>
            {BG_COLORS.map((bg) => (
              <button
                key={bg.color}
                type="button"
                onClick={() => handleSelectBgColor(bg.color)}
                title={bg.label}
                style={{
                  width: '11px',
                  height: '11px',
                  borderRadius: '3px',
                  background: bg.color,
                  border: bgColor === bg.color ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.25)',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </div>

          {/* Pen Colors & Sizes */}
          <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
              {PEN_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setActiveColor(c)}
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: c,
                    border: activeColor === c ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              ))}
            </div>

            <div style={{ display: 'flex', gap: '1px', alignItems: 'center' }}>
              {PEN_SIZES.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setActiveWidth(p.size)}
                  style={{
                    fontSize: '8px',
                    fontWeight: 700,
                    padding: '1px 3px',
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
      )}

      {/* ─── 5. Interactive HTML5 Full-Workspace Canvas ─── */}
      <div style={{ flex: 1, width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
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
            display: 'block',
            width: '100%',
            height: '100%',
            cursor:
              activeTool === 'eraser'
                ? 'cell'
                : activeTool === 'laser' || activeTool === 'torch'
                ? 'crosshair'
                : activeTool === 'text'
                ? 'text'
                : 'crosshair',
          }}
        />
      </div>

      {/* ─── 4. Text Prompt Modal ─── */}
      {textModalPos && (
        <div
          style={{
            position: 'absolute',
            top: `${Math.min(textModalPos.y, 250)}px`,
            left: `${Math.min(textModalPos.x, 220)}px`,
            zIndex: 100,
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid var(--primary)',
            borderRadius: '6px',
            padding: '6px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.8)',
            display: 'flex',
            gap: '4px',
          }}
        >
          <input
            type="text"
            className="input-glass"
            placeholder="Type text note..."
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirmTextNote();
              if (e.key === 'Escape') setTextModalPos(null);
            }}
            style={{ fontSize: '11px', padding: '4px 6px', width: '140px' }}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleConfirmTextNote}
            style={{ fontSize: '10px', padding: '2px 6px' }}
          >
            Add
          </button>
        </div>
      )}

      {/* ─── 5. HTML5 Canvas ─── */}
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
          cursor:
            activeTool === 'laser' || activeTool === 'temp_pen'
              ? 'crosshair'
              : activeTool === 'torch'
              ? 'none'
              : activeTool === 'text'
              ? 'text'
              : 'crosshair',
          touchAction: 'none',
        }}
      />
    </div>
  );
};
