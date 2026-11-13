import { isDeepStrictEqual } from "node:util";
import { type Document, isCollection, isMap, isScalar, isSeq, type Node, type YAMLMap } from "yaml";

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrimitive(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

function containsMap(node: Node): boolean {
  if (!isCollection(node)) return false;
  return node.items.some((item) => {
    const child = isMap(node) ? (item as { value: unknown }).value : item;
    return isMap(child) || containsMap(child as Node);
  });
}

// New leaf collections are written inline: `api: { port: 3000, path: /health }`.
function createNode(doc: Document, value: unknown): Node {
  const node = doc.createNode(value) as Node;
  if (isCollection(node) && !containsMap(node)) node.flow = true;
  return node;
}

function keyOf(key: unknown): string {
  return String(isScalar(key) ? key.value : key);
}

function reconcileMap(doc: Document, map: YAMLMap, value: PlainObject): void {
  for (const pair of [...map.items]) {
    if (!(keyOf(pair.key) in value)) map.delete(pair.key);
  }
  // An inline `{}` that gains entries would otherwise stay on one line forever.
  if (map.items.length === 0) map.flow = false;

  for (const [key, next] of Object.entries(value)) {
    const current = map.get(key, true);
    if (isMap(current) && isPlainObject(next)) {
      reconcileMap(doc, current, next);
    } else if (isScalar(current) && isPrimitive(next)) {
      if (current.value !== next) current.value = next;
    } else if (isSeq(current) && isDeepStrictEqual(current.toJSON(), next)) {
      // unchanged list: keep the node and its comments
    } else {
      map.set(key, createNode(doc, next));
    }
  }
}

/**
 * Makes `doc` represent `value` while touching only the nodes that differ,
 * so comments and formatting of everything else survive.
 */
export function reconcileDocument(doc: Document, value: unknown): void {
  if (isMap(doc.contents) && isPlainObject(value)) {
    reconcileMap(doc, doc.contents, value);
  } else {
    doc.contents = createNode(doc, value);
  }
}
