// ─── Collaborative & Personal Whiteboard Types, Tools, Backgrounds, System Design & Notebook ───

export type WhiteboardToolType =
  | 'pen'             // Standard fine pen
  | 'brush'           // Smooth pressure/brush stroke pen
  | 'highlighter'     // Semi-transparent colored marker
  | 'temp_pen'        // ⏳ Disappearing / Temporary Ink (auto-fading in 2-5s)
  | 'laser'           // Real-time laser pointer trail (fading)
  | 'torch'           // Spotlight / torch beam that highlights a region
  | 'eraser'          // Pixel & stroke eraser
  | 'line'            // Straight line
  | 'arrow'           // Directional arrow
  | 'arrow_bi'        // Bidirectional arrow (↔️)
  | 'rect'            // Box / rectangle
  | 'circle'          // Circle / node
  | 'decision_diamond'// Decision diamond (💎)
  | 'tree_node'       // Binary tree / graph node
  | 'sticky_note'     // 💬 Sticky note / Callout card
  | 'text'            // Text note / label
  // System Design Architecture Shapes:
  | 'db_cylinder'     // 🗄️ 3D Relational Database (SQL)
  | 'db_nosql'        // 🍃 Document / NoSQL Database
  | 'cloud'           // ☁️ Cloud / API Gateway / Cluster
  | 'load_balancer'   // ⚖️ Load Balancer
  | 'message_queue'   // 📨 Message Queue / Kafka partition buffer
  | 'server_box'      // 📦 Server / Microservice container
  | 'cache_mem'       // ⚡ In-Memory Cache / Redis block
  | 'dns_router'      // 🌐 DNS / Internet Router
  | 'firewall'        // 🔒 Firewall / Security Gateway
  | 'user_client'     // 👤 Desktop / Client Actor
  | 'mobile_client';  // 📱 Mobile / Tablet Client

export type WhiteboardBackgroundType =
  | 'grid'            // Standard graph / square coordinate grid
  | 'ruled'           // Notebook lined / ruled paper with margin
  | 'blank'           // Minimalist blank canvas
  | 'dotted'          // Dot matrix grid
  | 'plot'            // Cartesian (X, Y) 4-quadrant coordinate axes with tick marks
  | 'matrix'          // 2D DP array / matrix cell table
  | 'white_blank'     // Crisp classic white board
  | 'white_ruled';    // Light ruled notebook paper

export type WhiteboardSizeMode = 'full' | 'half' | 'popup' | 'custom';
export type WhiteboardPrivacyMode = 'collaborative' | 'personal';

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
    subLabel?: string;
  };
  text?: string;
  timestamp: number;
  expiresAt?: number; // For disappearing ink strokes
}

export interface TempDisappearingStroke {
  stroke: WhiteboardStroke;
  createdAt: number;
  fadeDurationMs: number;
  currentAlpha: number;
}

export interface LaserPointerPosition {
  peerId: string;
  nickname: string;
  color: string;
  x: number;
  y: number;
  timestamp: number;
}

export interface WhiteboardPage {
  id: string;
  title: string;
  strokes: WhiteboardStroke[];
  undoStack: WhiteboardStroke[];
  redoStack: WhiteboardStroke[];
  background: WhiteboardBackgroundType;
  bgColor: string; // Custom background color
  createdAt: number;
}

export interface WhiteboardNotebook {
  activePageId: string;
  pages: WhiteboardPage[];
}

export interface WhiteboardState {
  notebook: WhiteboardNotebook;
  background: WhiteboardBackgroundType;
  bgColor: string;
  sizeMode: WhiteboardSizeMode;
  privacyMode: WhiteboardPrivacyMode;
}
