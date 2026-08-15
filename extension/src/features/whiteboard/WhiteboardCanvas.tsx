// ─── Collaborative Whiteboard Canvas: Multi-Tools, Rich Backgrounds & Size Modes ───

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
  Maximize2,
  Minimize2,
  ExternalLink,
} from 'lucide-react';
import { WhiteboardService } from './whiteboard.service';
import {
  WhiteboardToolType,
  WhiteboardBackgroundType,
  WhiteboardSizeMode,
  WhiteboardStroke,
  Point,
  LaserPointerPosition,
} from './whiteboard.types';

const COLORS = [
  '#6366f1', // Indigo
  '#06b6d4', // Cyan
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#f43f5e', // Rose
  '#ffffff', // White
  '#0f172a', // Dark Slate (for white board)
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
  const [backgroundType, setBackgroundType] = useState<WhiteboardBackgroundType>(whiteboardService.getBackground());
  const [sizeMode, setSizeMode] = useState<WhiteboardSizeMode>('full');
  const [customHeight, setCustomHeight] = useState<number>(420);

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [startPoint, setStartPoint] = useState<Point | null>(null);

  // Laser Pointer & Torch Trail State
  const [laserTrails, setLaserTrails] = useState<{ x: number; y: number; color: string; alpha: number; timestamp: number }[]>([]);
  const [torchPos, setTorchPos] = useState<{ x: number; y: number } | null>(null);

  // Text Prompt Modal State
  const [textModalPos, setTextModalPos] = useState<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState('');

  // 1. Listen for background changes from peer or local
  useEffect(() => {
    return whiteboardService.onBackgroundChange((bg) => {
      setBackgroundType(bg);
    });
  }, [whiteboardService]);

  // 2. Listen for incoming laser pointer from peers
  useEffect(() => {
    return whiteboardService.onLaser((laser) => {
      setLaserTrails((prev) => [
        ...prev.slice(-40),
        { x: laser.x, y: laser.y, color: laser.color, alpha: 1.0, timestamp: Date.now() },
      ]);
    });
  }, [whiteboardService]);

  // 3. Fading animation loop for laser pointer trails
  useEffect(() => {
    const interval = setInterval(() => {
      setLaserTrails((prev) => {
        const now = Date.now();
        const filtered = prev
          .filter((pt) => now - pt.timestamp < 1200)
          .map((pt) => ({
            ...pt,
            alpha: Math.max(0, 1 - (now - pt.timestamp) / 1200),
          }));
        return filtered;
      });
    }, 40);

    return () => clearInterval(interval);
  }, []);

  // 4. Render canvas background pattern based on backgroundType
  const drawBackground = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, bg: WhiteboardBackgroundType) => {
    ctx.save();

    const isLightBg = bg === 'white_blank' || bg === 'white_ruled';

    // Base canvas fill
    ctx.fillStyle = isLightBg ? '#f8fafc' : '#090d16';
    ctx.fillRect(0, 0, w, h);

    if (bg === 'grid') {
      // ⬛ Standard Graph Grid
      ctx.strokeStyle = isLightBg ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.05)';
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
      // 📏 Ruled Notebook Paper with Margin Line
      const isDark = bg === 'ruled';
      ctx.strokeStyle = isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.2)';
      ctx.lineWidth = 1;
      const lineGap = 28;
      for (let y = 36; y < h; y += lineGap) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Vertical pink/red notebook margin line
      ctx.strokeStyle = isDark ? 'rgba(244, 63, 94, 0.35)' : 'rgba(244, 63, 94, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(48, 0);
      ctx.lineTo(48, h);
      ctx.stroke();
    } else if (bg === 'dotted') {
      // 🟦 Dot Matrix Grid
      ctx.fillStyle = isLightBg ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.18)';
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

      // Subtle background grid
      ctx.strokeStyle = isLightBg ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.03)';
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

      // Main X and Y axes
      ctx.strokeStyle = isLightBg ? '#334155' : '#818cf8';
      ctx.lineWidth = 2;

      // X Axis
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();

      // Y Axis
      ctx.beginPath();
      ctx.moveTo(midX, 0);
      ctx.lineTo(midX, h);
      ctx.stroke();

      // Axis Ticks
      ctx.strokeStyle = isLightBg ? '#64748b' : '#a5b4fc';
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

      // Origin label (0,0)
      ctx.fillStyle = isLightBg ? '#64748b' : '#c7d2fe';
      ctx.font = '10px monospace';
      ctx.fillText('(0,0)', midX + 6, midY - 6);
      ctx.fillText('+X', w - 24, midY - 6);
      ctx.fillText('+Y', midX + 6, 16);
    } else if (bg === 'matrix') {
      // 📐 2D DP Table / Matrix Grid with Index Header
      ctx.strokeStyle = isLightBg ? 'rgba(99, 102, 241, 0.25)' : 'rgba(99, 102, 241, 0.15)';
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

      // Draw Col and Row Indices 0, 1, 2...
      ctx.fillStyle = isLightBg ? '#6366f1' : '#a5b4fc';
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
  }, []);

  // 5. Redraw all canvas strokes, backgrounds, laser trails, and spotlight
  const redrawCanvas = useCallback(
    (strokes: WhiteboardStroke[], previewPoints?: Point[], previewGeometry?: any) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      const isLightBg = backgroundType === 'white_blank' || backgroundType === 'white_ruled';

      // 1. Background Pattern
      drawBackground(ctx, w, h, backgroundType);

      // 2. Render all strokes
      const renderStroke = (stroke: WhiteboardStroke) => {
        ctx.save();
        let drawColor = stroke.color;
        if (isLightBg && (drawColor === '#ffffff' || drawColor === '#fff')) {
          drawColor = '#0f172a';
        }

        ctx.strokeStyle = drawColor;
        ctx.fillStyle = drawColor;
        ctx.lineWidth = stroke.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = stroke.opacity;

        if (stroke.tool === 'eraser') {
          ctx.strokeStyle = isLightBg ? '#f8fafc' : '#090d16';
          ctx.fillStyle = isLightBg ? '#f8fafc' : '#090d16';
          ctx.lineWidth = stroke.width * 4;
        } else if (stroke.tool === 'brush') {
          ctx.lineCap = 'round';
          ctx.lineWidth = stroke.width * 1.5;
        }

        if (stroke.text && stroke.geometry) {
          // Text Note Tool
          ctx.font = `bold ${Math.max(12, stroke.width * 3)}px -apple-system, sans-serif`;
          ctx.fillText(stroke.text, stroke.geometry.x1, stroke.geometry.y1);
        } else if (stroke.geometry) {
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
            ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
          } else if (stroke.tool === 'circle') {
            const rx = Math.abs(x2 - x1) / 2;
            const ry = Math.abs(y2 - y1) / 2;
            ctx.beginPath();
            ctx.ellipse(Math.min(x1, x2) + rx, Math.min(y1, y2) + ry, rx, ry, 0, 0, Math.PI * 2);
            ctx.stroke();
          } else if (stroke.tool === 'tree_node') {
            const radius = Math.max(18, stroke.width * 4);
            ctx.beginPath();
            ctx.arc(x1, y1, radius, 0, Math.PI * 2);
            ctx.fillStyle = isLightBg ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
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

      // 3. Render Torch / Spotlight Beam
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

      // 4. Render Laser Pointer Fading Trails
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
    [activeTool, activeColor, activeWidth, backgroundType, drawBackground, laserTrails, torchPos]
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

  // Background Change Handler
  const handleSelectBackground = (bg: WhiteboardBackgroundType) => {
    setBackgroundType(bg);
    whiteboardService.setBackground(bg);
    if ((bg === 'white_blank' || bg === 'white_ruled') && activeColor === '#ffffff') {
      setActiveColor('#0f172a');
    }
  };

  // Open Standalone Popup Window
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
    link.download = `synqto-whiteboard-${backgroundType}-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  };

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: sizeMode === 'full' ? '100%' : sizeMode === 'half' ? '300px' : `${customHeight}px`,
        minHeight: '220px',
        maxHeight: sizeMode === 'full' ? '100%' : undefined,
        background: backgroundType.startsWith('white_') ? '#f8fafc' : '#090d16',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
        position: 'relative',
        transition: 'height 0.2s ease',
      }}
    >
      {/* 1. Main Top Toolbar: Drawing Tools & Size Chooser */}
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
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Pen */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'pen' ? 'active' : ''}`}
            onClick={() => setActiveTool('pen')}
            title="Fine Pen"
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

          {/* Brush Pen */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'brush' ? 'active' : ''}`}
            onClick={() => setActiveTool('brush')}
            title="Brush / Calligraphy Pen"
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              border: activeTool === 'brush' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'brush' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'brush' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <PenTool size={13} />
          </button>

          {/* Highlighter */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'highlighter' ? 'active' : ''}`}
            onClick={() => setActiveTool('highlighter')}
            title="Highlighter Marker"
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

          {/* Laser Pointer */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'laser' ? 'active' : ''}`}
            onClick={() => setActiveTool('laser')}
            title="🔴 Laser Pointer (Real-time P2P trail)"
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              border: activeTool === 'laser' ? '1px solid #ef4444' : '1px solid transparent',
              background: activeTool === 'laser' ? 'rgba(239, 68, 68, 0.25)' : 'transparent',
              color: activeTool === 'laser' ? '#fca5a5' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Flame size={13} color="#ef4444" />
          </button>

          {/* Torch / Spotlight */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'torch' ? 'active' : ''}`}
            onClick={() => setActiveTool('torch')}
            title="🔦 Spotlight / Torch Beam"
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              border: activeTool === 'torch' ? '1px solid #facc15' : '1px solid transparent',
              background: activeTool === 'torch' ? 'rgba(250, 204, 21, 0.25)' : 'transparent',
              color: activeTool === 'torch' ? '#fef08a' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Lightbulb size={13} color="#facc15" />
          </button>

          {/* Eraser */}
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

          {/* Text Note */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'text' ? 'active' : ''}`}
            onClick={() => setActiveTool('text')}
            title="📝 Text Label / Code Note"
            style={{
              padding: '4px 6px',
              borderRadius: '4px',
              border: activeTool === 'text' ? '1px solid var(--primary)' : '1px solid transparent',
              background: activeTool === 'text' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: activeTool === 'text' ? '#c7d2fe' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <Type size={13} />
          </button>

          {/* Line */}
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

          {/* Arrow */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'arrow' ? 'active' : ''}`}
            onClick={() => setActiveTool('arrow')}
            title="Directional Arrow"
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

          {/* Box */}
          <button
            type="button"
            className={`btn-icon ${activeTool === 'rect' ? 'active' : ''}`}
            onClick={() => setActiveTool('rect')}
            title="Box / Rectangle"
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

          {/* Circle */}
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

          {/* Binary Tree Node */}
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

        {/* Action Controls: Size Mode Switcher, Undo, Redo, Clear, Save */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          {/* Size Choice Pills */}
          <div style={{ display: 'flex', gap: '2px', alignItems: 'center', background: 'rgba(0,0,0,0.3)', padding: '2px 4px', borderRadius: '4px' }}>
            <button
              type="button"
              onClick={() => setSizeMode('full')}
              title="Full Screen Workspace"
              style={{
                fontSize: '9px',
                fontWeight: 600,
                padding: '2px 5px',
                borderRadius: '3px',
                background: sizeMode === 'full' ? 'var(--primary)' : 'transparent',
                color: sizeMode === 'full' ? '#fff' : 'var(--text-muted)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              🖥️ Full
            </button>

            <button
              type="button"
              onClick={() => setSizeMode('half')}
              title="Half Screen View"
              style={{
                fontSize: '9px',
                fontWeight: 600,
                padding: '2px 5px',
                borderRadius: '3px',
                background: sizeMode === 'half' ? 'var(--primary)' : 'transparent',
                color: sizeMode === 'half' ? '#fff' : 'var(--text-muted)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              🌗 Half
            </button>

            <button
              type="button"
              onClick={() => setSizeMode('custom')}
              title="Custom Resizable Height"
              style={{
                fontSize: '9px',
                fontWeight: 600,
                padding: '2px 5px',
                borderRadius: '3px',
                background: sizeMode === 'custom' ? 'var(--primary)' : 'transparent',
                color: sizeMode === 'custom' ? '#fff' : 'var(--text-muted)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              📐 Custom
            </button>

            <button
              type="button"
              onClick={handleOpenPopupStandaloneWindow}
              title="Launch Standalone Whiteboard Window"
              style={{
                fontSize: '9px',
                fontWeight: 600,
                padding: '2px 5px',
                borderRadius: '3px',
                background: 'rgba(255,255,255,0.06)',
                color: '#c7d2fe',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <ExternalLink size={9} style={{ marginRight: '2px' }} />
              <span>Popout</span>
            </button>
          </div>

          <div style={{ width: '1px', height: '14px', background: 'var(--border-subtle)', margin: '0 2px' }} />

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

      {/* 2. Sub-Toolbar: Background Choices & Color/Size Palette */}
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
        {/* Background Choices List (Grid, Ruled, Blank, Dotted, Plot, Matrix, White) */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>BG:</span>

          <button
            type="button"
            onClick={() => handleSelectBackground('grid')}
            title="Square Graph Grid"
            style={{
              fontSize: '9px',
              padding: '2px 5px',
              borderRadius: '3px',
              background: backgroundType === 'grid' ? 'var(--primary)' : 'rgba(255,255,255,0.06)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            ⬛ Grid
          </button>

          <button
            type="button"
            onClick={() => handleSelectBackground('ruled')}
            title="Notebook Ruled Paper with Margin"
            style={{
              fontSize: '9px',
              padding: '2px 5px',
              borderRadius: '3px',
              background: backgroundType === 'ruled' ? 'var(--primary)' : 'rgba(255,255,255,0.06)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            📏 Ruled
          </button>

          <button
            type="button"
            onClick={() => handleSelectBackground('plot')}
            title="Cartesian (X, Y) 4-Quadrant Coordinate Plot"
            style={{
              fontSize: '9px',
              padding: '2px 5px',
              borderRadius: '3px',
              background: backgroundType === 'plot' ? 'var(--primary)' : 'rgba(255,255,255,0.06)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            📈 Plot (X,Y)
          </button>

          <button
            type="button"
            onClick={() => handleSelectBackground('dotted')}
            title="Dot Matrix Grid"
            style={{
              fontSize: '9px',
              padding: '2px 5px',
              borderRadius: '3px',
              background: backgroundType === 'dotted' ? 'var(--primary)' : 'rgba(255,255,255,0.06)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            🟦 Dotted
          </button>

          <button
            type="button"
            onClick={() => handleSelectBackground('matrix')}
            title="2D DP Array / Matrix Table Grid"
            style={{
              fontSize: '9px',
              padding: '2px 5px',
              borderRadius: '3px',
              background: backgroundType === 'matrix' ? 'var(--primary)' : 'rgba(255,255,255,0.06)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            📐 Matrix
          </button>

          <button
            type="button"
            onClick={() => handleSelectBackground('blank')}
            title="Minimalist Blank Slate"
            style={{
              fontSize: '9px',
              padding: '2px 5px',
              borderRadius: '3px',
              background: backgroundType === 'blank' ? 'var(--primary)' : 'rgba(255,255,255,0.06)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            📄 Blank
          </button>

          <button
            type="button"
            onClick={() => handleSelectBackground('white_blank')}
            title="Crisp White Board"
            style={{
              fontSize: '9px',
              padding: '2px 5px',
              borderRadius: '3px',
              background: backgroundType === 'white_blank' ? 'var(--primary)' : 'rgba(255,255,255,0.06)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            ⬜ White
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

      {/* 3. Text Prompt Modal when Clicking Canvas with Text Tool */}
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

      {/* 4. Interactive Drawing Canvas */}
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
          cursor: activeTool === 'laser' ? 'crosshair' : activeTool === 'torch' ? 'none' : activeTool === 'text' ? 'text' : 'crosshair',
          touchAction: 'none',
        }}
      />

      {/* 5. Custom Height Drag Resize Bar (Only shown in 'custom' mode) */}
      {sizeMode === 'custom' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '3px 10px',
            background: 'rgba(15, 23, 42, 0.95)',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '9px',
            color: 'var(--text-muted)',
          }}
        >
          <span>Canvas Height: {customHeight}px</span>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setCustomHeight((h) => Math.max(240, h - 50))}
              style={{ background: 'none', border: 'none', color: '#c7d2fe', cursor: 'pointer', fontSize: '10px' }}
            >
              ➖ Smaller
            </button>
            <button
              type="button"
              onClick={() => setCustomHeight((h) => Math.min(800, h + 50))}
              style={{ background: 'none', border: 'none', color: '#c7d2fe', cursor: 'pointer', fontSize: '10px' }}
            >
              ➕ Larger
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
