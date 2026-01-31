import fs from "node:fs";
import path from "node:path";
import { Liquid, Tag, type TagToken, type TopLevelToken, type Template } from "liquidjs";
import type { Context } from "liquidjs";
import type { Emitter } from "liquidjs";
import type { UserContent } from "ai";

const IMAGE_MARKER_START = "\x00IMG:";
const IMAGE_MARKER_END = "\x00";

export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string | UserContent;
}

/**
 * Custom {% chat role: "system"|"user"|"assistant" %} ... {% endchat %} tag.
 * Emits delimiters that renderPrompt splits on to produce PromptMessage[].
 */
class ChatTag extends Tag {
  private role: string;

  constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
    super(token, remainTokens, liquid);
    const match = token.args.match(/role:\s*"(\w+)"/);
    if (!match) {
      throw new Error(`{% chat %} requires role: "system"|"user"|"assistant"`);
    }
    this.role = match[1];
    this.templates = [];
    const stream = liquid.parser
      .parseStream(remainTokens)
      .on("tag:endchat", () => stream.stop())
      .on("template", (tpl: Template) =>
        this.templates.push(tpl)
      )
      .on("end", () => {
        throw new Error("{% chat %} missing {% endchat %}");
      });
    stream.start();
  }

  *render(ctx: Context, emitter: Emitter): Generator<unknown, void, unknown> {
    emitter.write(`\x01CHAT:${this.role}\x01`);
    yield this.liquid.renderer.renderTemplates(
      this.templates,
      ctx,
      emitter
    );
    emitter.write(`\x01ENDCHAT\x01`);
  }

  private templates: Template[];
}

/**
 * Custom {% image expr %} tag.
 * Evaluates the expression and emits a marker that renderPrompt
 * converts into an AI SDK image content part.
 */
class ImageTag extends Tag {
  private value: string;

  constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid) {
    super(token, remainTokens, liquid);
    this.value = token.args.trim();
  }

  *render(ctx: Context, emitter: Emitter): Generator<unknown, void, unknown> {
    const val = yield this.liquid.evalValue(this.value, ctx);
    emitter.write(`${IMAGE_MARKER_START}${val}${IMAGE_MARKER_END}`);
  }
}

const PROMPTS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../prompts"
);

const engine = new Liquid({
  root: [PROMPTS_DIR],
  extname: ".liquid",
  strictVariables: false,
});

engine.registerTag("chat", ChatTag);
engine.registerTag("image", ImageTag);

/**
 * Render a .liquid prompt template and return structured PromptMessage[].
 * The template must use {% chat role: "..." %} blocks.
 */
export async function renderPrompt(
  templateName: string,
  context: Record<string, unknown>
): Promise<PromptMessage[]> {
  const raw = await engine.renderFile(templateName, context);
  return parseMessages(raw);
}

function parseMessages(raw: string): PromptMessage[] {
  const messages: PromptMessage[] = [];
  const chatRegex = /\x01CHAT:(\w+)\x01([\s\S]*?)\x01ENDCHAT\x01/g;
  let match;

  while ((match = chatRegex.exec(raw)) !== null) {
    const role = match[1] as PromptMessage["role"];
    const body = match[2];

    if (role === "system") {
      messages.push({ role, content: body.trim() });
    } else {
      messages.push({ role, content: parseContentParts(body) });
    }
  }

  return messages;
}

function parseContentParts(body: string): UserContent {
  const parts: UserContent = [];
  const imageRegex = new RegExp(
    `${escapeRegex(IMAGE_MARKER_START)}(.*?)${escapeRegex(IMAGE_MARKER_END)}`,
    "g"
  );

  let lastIndex = 0;
  let match;

  while ((match = imageRegex.exec(body)) !== null) {
    const textBefore = body.slice(lastIndex, match.index);
    if (textBefore.trim()) {
      parts.push({ type: "text", text: textBefore.trim() });
    }
    parts.push({
      type: "image",
      image: match[1],
      mediaType: "image/png",
    });
    lastIndex = match.index + match[0].length;
  }

  const remaining = body.slice(lastIndex).trim();
  if (remaining) {
    parts.push({ type: "text", text: remaining });
  }

  return parts;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
