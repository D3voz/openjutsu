import { NODES, isLink, type ApiGraph } from "./simple.ts";

export type NodeInfo = { title: string; classType: string; clip: number | null };

// Each clip after the first is a GraphBuilder expansion of the clip loop, which prefixes the
// node ids with "<parent>.<call>.<graph>." and renames Loop End to "Recurse":
// "64" (clip 1), "70.0.0.64" (clip 2), "70.0.0.Recurse.0.0.64" (clip 3).
export function nodeDescriber(graph: ApiGraph) {
  const children = new Map<string, string[]>();
  for (const [id, node] of Object.entries(graph)) {
    for (const value of Object.values(node.inputs)) {
      if (isLink(value)) children.set(value[0], [...(children.get(value[0]) ?? []), id]);
    }
  }
  const downstream = (root: string) => {
    const seen = new Set([root]);
    const stack = [root];
    while (stack.length) for (const child of children.get(stack.pop()!) ?? []) if (!seen.has(child)) seen.add(child), stack.push(child);
    return seen;
  };
  const afterLoop = downstream(NODES.loopEnd);
  afterLoop.delete(NODES.loopEnd);
  const inLoop = new Set([...downstream(NODES.loopStart)].filter((id) => !afterLoop.has(id)));

  return (nodeId: string | null): NodeInfo | null => {
    if (!nodeId) return null;
    const parts = nodeId.split(".");
    const base = parts.at(-1) === "Recurse" ? NODES.loopEnd : parts.at(-1)!;
    const node = graph[base];
    if (!node) return null;
    return {
      title: node._meta?.title ?? node.class_type,
      classType: node.class_type,
      clip: inLoop.has(base) ? 1 + Math.floor((parts.length - 1) / 3) : null,
    };
  };
}
