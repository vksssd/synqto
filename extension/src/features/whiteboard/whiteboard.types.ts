// ─── Collaborative Whiteboard Types, Tools, Backgrounds & Size Modes ───

export type WhiteboardToolType =
  | 'pen'           // Standard fine pen
  | 'brush'         // Smooth pressure/brush stroke pen
  | 'highlighter'   // Semi-transparent colored marker
  | 'laser'         // Real-time laser pointer trail (fading)
  | 'torch'         // Spotlight / torch beam that highlights a region
  | 'eraser'        // Pixel & stroke eraser
  | 'line'          // Straight line
  | 'arrow'         // Directional arrow
  | 'rect'          // Box / rectangle
  | 'circle'        // Circle / node
  | 'tree_node'     // Binary tree node with label
  | 'text';         // Text note / label

export type WhiteboardBackgroundType =
  | 'grid'          // Standard graph / square coordinate grid
  | 'ruled'         // Notebook lined / ruled paper with margin
  | 'blank'         // Minimalist dark slate
  | 'dotted'        // Dot matrix grid
  | 'plot'          // Cartesian (X, Y) 4-quadrant coordinate axes with tick marks
  | 'matrix'        // 2D DP array / matrix cell table
  | 'white_blank'   // Crisp classic white board
  | 'white_ruled';  // Light ruled notebook paper

export type WhiteboardSizeMode = 'full' | 'half' | 'popup' | 'custom';

export interface WhiteboardDimensions {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
  pressure?: number;
}

export interface WhiteboardStroke {
  id: string;
  peerId: string;
  nickname: string;
  tool: WhiteboardToolType;
  color: string;
  width: number;
  opacity: number;
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

export interface LaserPointerPosition {
  peerId: string;
  nickname: string;
  color: string;
  x: number;
  y: number;
  timestamp: number;
}

export interface WhiteboardState {
  strokes: WhiteboardStroke[];
  undoStack: WhiteboardStroke[];
  redoStack: WhiteboardStroke[];
  background: WhiteboardBackgroundType;
  sizeMode: WhiteboardSizeMode;
}
