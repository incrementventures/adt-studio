import { parseDocument } from "htmlparser2";

export interface HtmlValidationResult {
  valid: boolean;
  errors: string[];
}

const EXEMPT_TAGS = new Set(["style", "script"]);

export function validateSectionHtml(
  html: string,
  allowedTextIds: string[],
  allowedImageIds: string[],
): HtmlValidationResult {
  const allowedIds = new Set([...allowedTextIds, ...allowedImageIds]);
  const errors: string[] = [];
  const doc = parseDocument(html);

  walkNode(doc, allowedIds, errors);

  return { valid: errors.length === 0, errors };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walkNode(node: any, allowedIds: Set<string>, errors: string[]): void {
  if (node.type === "text") {
    if (node.data.trim().length > 0) {
      if (isInsideExemptTag(node)) return;
      if (!hasAncestorWithDataId(node)) {
        const snippet = node.data.trim().slice(0, 50);
        errors.push(`Text node outside any data-id element: "${snippet}"`);
      }
    }
    return;
  }

  if (node.type === "tag") {
    const dataId = node.attribs?.["data-id"];
    if (dataId !== undefined && !allowedIds.has(dataId)) {
      errors.push(`Unknown data-id: "${dataId}"`);
    }
  }

  if (node.children) {
    for (const child of node.children) {
      walkNode(child, allowedIds, errors);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isInsideExemptTag(node: any): boolean {
  let current = node.parent;
  while (current) {
    if ((current.type === "tag" || current.type === "style" || current.type === "script") && EXEMPT_TAGS.has(current.name)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasAncestorWithDataId(node: any): boolean {
  let current = node.parent;
  while (current) {
    if (current.type === "tag" && current.attribs?.["data-id"] !== undefined) {
      return true;
    }
    current = current.parent;
  }
  return false;
}
