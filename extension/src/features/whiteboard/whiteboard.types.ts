// ─── Collaborative Whiteboard Types & Stroke Definitions ───

export type WhiteboardToolType =
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'circle'
  | 'tree_node';

export interface Point {
  x: number;
  y: number;
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
  timestamp: number;
}

export interface WhiteboardState {
  strokes: WhiteboardStroke[];
  undoStack: WhiteboardStroke[];
  redoStack: WhiteboardStroke[];
}
