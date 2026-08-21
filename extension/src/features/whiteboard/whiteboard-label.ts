import type { WhiteboardToolType } from './whiteboard.types';

const LABELABLE_TOOLS = new Set<WhiteboardToolType>([
  'line', 'arrow', 'arrow_bi', 'rect', 'rounded_rect', 'circle', 'triangle', 'star',
  'decision_diamond', 'tree_node', 'sticky_note', 'code_box',
  'array_cells', 'stack_lifo', 'queue_fifo', 'hashmap_table', 'two_pointers',
  'db_cylinder', 'db_nosql', 'cloud', 'load_balancer', 'message_queue', 'server_box',
  'cache_mem', 'cdn_edge', 'object_storage', 'auth_jwt', 'websocket_gw',
  'elasticsearch', 'dns_router', 'firewall', 'user_client', 'mobile_client',
  'async_arrow', 'tradeoff_note',
]);

export interface WhiteboardGeometryObject {
  tool: string;
  width?: number;
  text?: string;
  geometry?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    label?: string;
    [key: string]: unknown;
  };
}

export interface WhiteboardRenderedBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Several architecture and DSA tools deliberately render with a minimum visual size even
 * when the user only clicks (x1 === x2 / y1 === y2) or makes a very short drag. Selection,
 * erasing, marquee bounds, and label placement must use that same visible footprint; using
 * only the raw endpoints turns a large visible object into an almost unclickable point.
 */
const MIN_RENDERED_SIZE: Record<string, { width: number; height: number }> = {
  sticky_note: { width: 70, height: 60 },
  code_box: { width: 90, height: 50 },
  db_cylinder: { width: 50, height: 60 },
  db_nosql: { width: 50, height: 65 },
  cloud: { width: 70, height: 45 },
  load_balancer: { width: 55, height: 55 },
  message_queue: { width: 80, height: 36 },
  server_box: { width: 70, height: 45 },
  cache_mem: { width: 65, height: 38 },
  firewall: { width: 50, height: 60 },
  user_client: { width: 45, height: 29 },
  mobile_client: { width: 34, height: 54 },
  array_cells: { width: 140, height: 34 },
  stack_lifo: { width: 55, height: 80 },
  queue_fifo: { width: 90, height: 34 },
  hashmap_table: { width: 100, height: 65 },
  cdn_edge: { width: 60, height: 50 },
  object_storage: { width: 50, height: 55 },
  auth_jwt: { width: 46, height: 54 },
  websocket_gw: { width: 60, height: 45 },
  elasticsearch: { width: 60, height: 45 },
  tradeoff_note: { width: 110, height: 55 },
};

export function getWhiteboardRenderedBounds(object: WhiteboardGeometryObject): WhiteboardRenderedBounds | null {
  const geometry = object.geometry;
  if (!geometry) return null;

  if (object.text) {
    return {
      minX: geometry.x1,
      minY: geometry.y1 - 20,
      maxX: geometry.x1 + 100,
      maxY: geometry.y1 + 10,
    };
  }

  if (object.tool === 'tree_node') {
    const radius = Math.max(16, (object.width || 0) * 4);
    return {
      minX: geometry.x1 - radius,
      minY: geometry.y1 - radius,
      maxX: geometry.x1 + radius,
      maxY: geometry.y1 + radius,
    };
  }

  const minX = Math.min(geometry.x1, geometry.x2);
  const minY = Math.min(geometry.y1, geometry.y2);
  const rawWidth = Math.abs(geometry.x2 - geometry.x1);
  const rawHeight = Math.abs(geometry.y2 - geometry.y1);

  if (object.tool === 'dns_router') {
    const diameter = Math.max(44, rawWidth);
    return { minX, minY, maxX: minX + diameter, maxY: minY + diameter };
  }

  if (object.tool === 'two_pointers') {
    const centerX = minX + rawWidth / 2;
    return { minX: centerX - 8, minY, maxX: centerX + 8, maxY: minY + 32 };
  }

  const minimum = MIN_RENDERED_SIZE[object.tool];
  if (minimum) {
    return {
      minX,
      minY,
      maxX: minX + Math.max(minimum.width, rawWidth),
      maxY: minY + Math.max(minimum.height, rawHeight),
    };
  }

  return {
    minX,
    minY,
    maxX: Math.max(geometry.x1, geometry.x2),
    maxY: Math.max(geometry.y1, geometry.y2),
  };
}

export function isLabelableWhiteboardTool(tool: string): boolean {
  return LABELABLE_TOOLS.has(tool as WhiteboardToolType);
}

export function getWhiteboardLabelAnchor(object: WhiteboardGeometryObject): { x: number; y: number } | null {
  const bounds = getWhiteboardRenderedBounds(object);
  if (!bounds) return null;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

/** Returns a copy so an unlabeled object remains valid while its editor is open. */
export function withWhiteboardLabel<T extends WhiteboardGeometryObject>(object: T, label: string): T {
  if (!object.geometry) return object;
  const trimmed = label.trim();
  return {
    ...object,
    geometry: {
      ...object.geometry,
      label: trimmed || undefined,
    },
  };
}
