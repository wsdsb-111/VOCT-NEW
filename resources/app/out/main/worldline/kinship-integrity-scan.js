"use strict";

const RECIPROCAL_TYPES = Object.freeze({
  PARENT_OF: "CHILD_OF",
  CHILD_OF: "PARENT_OF",
  SIBLING_OF: "SIBLING_OF",
  SPOUSE_OF: "SPOUSE_OF",
  FORMER_SPOUSE_OF: "FORMER_SPOUSE_OF",
  DECEASED_SPOUSE_OF: "DECEASED_SPOUSE_OF"
});

function scanKinshipIntegrity(graph, { maxIssues = 100 } = {}) {
  if (!graph || !(graph.nodes instanceof Map) || !Array.isArray(graph.edges)) {
    return { available: false, status: "UNAVAILABLE", reason: "KINSHIP_GRAPH_UNAVAILABLE", scope: "UNKNOWN", scannedNodes: 0, scannedEdges: 0, issues: [] };
  }
  const issues = [];
  const record = issue => {
    if (issues.length < maxIssues) issues.push(issue);
  };
  const edgeKeys = new Set();
  const edgeIndex = new Map(graph.edges.map(edge => [`${edge.from}:${edge.to}:${edge.type}`, edge]));
  for (const edge of graph.edges) {
    const key = `${edge.from}:${edge.to}:${edge.type}`;
    if (edgeKeys.has(key)) record({ code: "DUPLICATE_EDGE", from: edge.from, to: edge.to, type: edge.type });
    edgeKeys.add(key);
    if (String(edge.from) === String(edge.to)) record({ code: "SELF_RELATION", from: edge.from, type: edge.type });
    if (!graph.nodes.has(String(edge.from)) || !graph.nodes.has(String(edge.to))) record({ code: "EDGE_NODE_MISSING", from: edge.from, to: edge.to, type: edge.type });
    if (Array.isArray(edge.relationshipKindConflict) && edge.relationshipKindConflict.length > 1) {
      record({ code: "RELATIONSHIP_KIND_CONFLICT", from: edge.from, to: edge.to, type: edge.type, relationshipKinds: edge.relationshipKindConflict });
    }
    const reciprocalType = RECIPROCAL_TYPES[edge.type];
    if (!reciprocalType) continue;
    const reciprocal = edgeIndex.get(`${edge.to}:${edge.from}:${reciprocalType}`);
    if (!reciprocal) {
      record({ code: "RECIPROCAL_EDGE_MISSING", from: edge.from, to: edge.to, type: edge.type, expectedType: reciprocalType });
      continue;
    }
    if (edge.relationshipKind && reciprocal.relationshipKind && edge.relationshipKind !== reciprocal.relationshipKind) {
      record({ code: "RELATIONSHIP_KIND_CONFLICT", from: edge.from, to: edge.to, type: edge.type, relationshipKind: edge.relationshipKind, reciprocalRelationshipKind: reciprocal.relationshipKind });
    }
  }
  return {
    available: true,
    status: issues.length ? "CONFLICT" : "PASS",
    scope: graph.scopeTruncated ? "TARGETED_INCOMPLETE" : "COMPLETE_GRAPH_SCOPE",
    sourceComplete: graph.scopeTruncated !== true,
    scannedNodes: graph.nodes.size,
    scannedEdges: graph.edges.length,
    issues
  };
}

module.exports = { scanKinshipIntegrity };
