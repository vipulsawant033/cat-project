// Figma plugin sandbox. Receives build plans from the bridge (via ui.html) and
// creates real nodes with the Plugin API — the only supported write path into
// Figma. Sends an apply-result ack back with the created root node id.

figma.showUI(__html__, { width: 240, height: 120 });

figma.ui.onmessage = async (msg) => {
  if (msg.type !== "apply-plan") return;
  try {
    const varMap = await ensureVariables(msg.plan.tokens || {});
    const root = await buildNode(msg.plan.root, varMap);
    figma.currentPage.appendChild(root);
    figma.viewport.scrollAndZoomIntoView([root]);
    figma.ui.postMessage({ type: "apply-result", requestId: msg.requestId, result: { ok: true, createdRootId: root.id } });
  } catch (e) {
    figma.ui.postMessage({ type: "apply-result", requestId: msg.requestId, result: { ok: false, error: String(e) } });
  }
};

// Create/lookup Figma Variables for the token map so bindings round-trip.
async function ensureVariables(tokens) {
  const map = {};
  if (!Object.keys(tokens).length) return map;
  let collection = figma.variables.getLocalVariableCollections()[0];
  if (!collection) collection = figma.variables.createVariableCollection("tokens");
  const modeId = collection.modes[0].modeId;
  const existing = {};
  for (const v of figma.variables.getLocalVariables()) existing[v.name] = v;
  for (const [cssName, value] of Object.entries(tokens)) {
    const name = cssName.replace(/^--/, "").replace(/-/g, "/");
    let v = existing[name];
    if (!v) {
      v = figma.variables.createVariable(name, collection, "COLOR");
      const c = hexToRgb(value);
      if (c) v.setValueForMode(modeId, c);
    }
    map[cssName] = v;
  }
  return map;
}

async function buildNode(plan, varMap) {
  let node;
  switch (plan.type) {
    case "TEXT": {
      node = figma.createText();
      await figma.loadFontAsync(plan.fontName || { family: "Inter", style: "Regular" });
      node.fontName = plan.fontName || { family: "Inter", style: "Regular" };
      node.characters = plan.characters || "";
      if (plan.fontSize) node.fontSize = plan.fontSize;
      applyFills(node, plan, varMap);
      break;
    }
    case "INSTANCE": {
      const comp = await figma.importComponentByKeyAsync(plan.componentKey).catch(() => null);
      node = comp ? comp.createInstance() : figma.createFrame();
      break;
    }
    case "RECTANGLE": {
      node = figma.createRectangle();
      applyFills(node, plan, varMap);
      break;
    }
    default: {
      node = figma.createFrame();
      applyFrameLayout(node, plan);
      applyFills(node, plan, varMap);
    }
  }

  node.name = plan.name || node.type;
  if (typeof plan.width === "number" && typeof plan.height === "number" && node.resize) {
    node.resize(plan.width, plan.height);
  }
  if (typeof plan.cornerRadius === "number" && "cornerRadius" in node) node.cornerRadius = plan.cornerRadius;
  applyStrokes(node, plan);
  applyEffects(node, plan);

  if (plan.children && node.appendChild) {
    for (const child of plan.children) node.appendChild(await buildNode(child, varMap));
  }
  return node;
}

function applyFrameLayout(node, plan) {
  if (plan.layoutMode && plan.layoutMode !== "NONE") {
    node.layoutMode = plan.layoutMode;
    if (plan.itemSpacing != null) node.itemSpacing = plan.itemSpacing;
    if (plan.paddingTop != null) node.paddingTop = plan.paddingTop;
    if (plan.paddingRight != null) node.paddingRight = plan.paddingRight;
    if (plan.paddingBottom != null) node.paddingBottom = plan.paddingBottom;
    if (plan.paddingLeft != null) node.paddingLeft = plan.paddingLeft;
    if (plan.primaryAxisAlignItems) node.primaryAxisAlignItems = plan.primaryAxisAlignItems;
    if (plan.counterAxisAlignItems) node.counterAxisAlignItems = plan.counterAxisAlignItems;
  }
}

function applyFills(node, plan, varMap) {
  if (plan.boundVariables && plan.boundVariables.fills && varMap[plan.boundVariables.fills]) {
    const paint = { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
    const bound = figma.variables.setBoundVariableForPaint(paint, "color", varMap[plan.boundVariables.fills]);
    node.fills = [bound];
    return;
  }
  if (plan.fills && plan.fills.length) {
    node.fills = plan.fills.map((c) => ({ type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }));
  }
}

function applyStrokes(node, plan) {
  if (plan.strokes && plan.strokes.length && "strokes" in node) {
    node.strokes = plan.strokes.map((c) => ({ type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }));
    if (plan.strokeWeight) node.strokeWeight = plan.strokeWeight;
  }
}

function applyEffects(node, plan) {
  if (plan.effects && plan.effects.length && "effects" in node) {
    node.effects = plan.effects.map((e) => ({
      type: e.type,
      offset: e.offset,
      radius: e.radius,
      spread: e.spread,
      color: e.color,
      visible: true,
      blendMode: "NORMAL",
    }));
  }
}

function hexToRgb(css) {
  const m = /^#([0-9a-f]{6})$/i.exec(css);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
