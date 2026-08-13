import {
  buildNrf24ManagementMasterSketch,
  buildNrf24ManagementReceiverSketch,
} from "./nrf24ManagementCodegen.js";

const RELAY_SAFE_HZ = 6;
const STEP_MS = 10;

const effectOnAt = (block, t) => {
  const local = t - Number(block.start || 0);
  const dur = Math.max(0, Number(block.dur) || 0);
  const p = Math.max(0, Math.min(1, dur > 0 ? local / dur : 1));
  let on = true;
  switch (block.type) {
    case "strobe":
      on = Math.floor(local * Math.max(0.01, Number(block.speed) || 5) * 2) % 2 === 0;
      break;
    case "pulse": {
      const envelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * Math.max(0.01, Number(block.speed) || 0.7) * local - Math.PI / 2);
      const phase = (local * RELAY_SAFE_HZ) % 1;
      on = phase < Math.max(0.04, envelope);
      break;
    }
    case "fadein": {
      const phase = (local * RELAY_SAFE_HZ) % 1;
      on = phase < Math.max(0.04, p);
      break;
    }
    case "fadeout": {
      const phase = (local * RELAY_SAFE_HZ) % 1;
      on = phase < Math.max(0.04, 1 - p);
      break;
    }
    default:
      on = true;
  }
  return on;
};

const bakeOnOffFrames = (partBlocks, stepMs = STEP_MS) => {
  if (!partBlocks.length) return { frames: [{ t: 0, on: false }], endMs: 0 };
  const sorted = [...partBlocks].sort((a, b) => Number(a.start || 0) - Number(b.start || 0));
  const endMs = Math.max(...sorted.map((b) => Math.round((Number(b.start || 0) + Number(b.dur || 0)) * 1000)));
  const frames = [];
  let prevOn = null;

  for (let t = 0; t <= endMs; t += stepMs) {
    const timeSec = t / 1000;
    let active = null;
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const b = sorted[i];
      const start = Number(b.start || 0);
      const dur = Number(b.dur || 0);
      if (timeSec >= start && timeSec < start + dur) {
        active = b;
        break;
      }
    }
    const on = active ? effectOnAt(active, timeSec) : false;
    if (t === 0 || prevOn === null || on !== prevOn || t + stepMs > endMs) {
      frames.push({ t, on });
      prevOn = on;
    }
  }
  const last = frames[frames.length - 1];
  if (!last || last.t !== endMs || last.on) frames.push({ t: endMs, on: false });
  return { frames, endMs };
};

const hashTarget = (target) => {
  let hash = 0x811c9dc5;
  const feed = (value) => {
    const s = String(value);
    for (let i = 0; i < s.length; i += 1) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  feed(target?.receiverId || 0);
  (target?.parts || []).forEach((part) => {
    feed(part.pin);
    feed(part.endMs);
    (part.frames || []).forEach((frame) => {
      feed(Math.round(Number(frame.t) || 0));
      feed(frame.on ? 1 : 0);
    });
  });
  return hash >>> 0;
};

const firstOnMs = (parts) => {
  let first = Number.POSITIVE_INFINITY;
  parts.forEach((part) => {
    (part.frames || []).forEach((frame) => {
      if (frame.on) first = Math.min(first, Math.max(0, Math.round(Number(frame.t) || 0)));
    });
  });
  return Number.isFinite(first) ? first : null;
};

export function buildManagementFirmwareBundle({ costumes = [], blocks = [] } = {}) {
  const receivers = costumes.slice(0, 8).map((costume, index) => {
    const rawParts = Array.isArray(costume.parts) && costume.parts.length
      ? costume.parts
      : [{ id: `fallback-${index}`, name: "EL 와이어", pin: 4 }];
    const parts = rawParts.map((part) => {
      const partBlocks = blocks
        .filter((b) => b.costumeId === costume.id && b.partId === part.id)
        .sort((a, b) => Number(a.start || 0) - Number(b.start || 0));
      const { frames, endMs } = bakeOnOffFrames(partBlocks, STEP_MS);
      return {
        name: part.name || "EL 와이어",
        pin: Number.isFinite(Number(part.pin)) ? Number(part.pin) : 4,
        frames,
        endMs,
      };
    });
    return {
      key: costume.id || `rx-${index + 1}`,
      receiverId: index + 1,
      costumeName: costume.name || `의상 ${index + 1}`,
      parts,
      filename: `Receiver_${index + 1}_AB.ino`,
    };
  });

  const receiverHashes = receivers.map(hashTarget);
  const showDurationMs = Math.max(0, ...receivers.flatMap((rx) => rx.parts.map((part) => part.endMs || 0)));
  const firstOns = receivers.map((rx) => firstOnMs(rx.parts)).filter((v) => Number.isFinite(v));
  const previewSafeLimitMs = firstOns.length ? Math.min(...firstOns) : Math.max(1, showDurationMs);
  const receiverCount = Math.max(1, receivers.length || 1);

  const masterCode = buildNrf24ManagementMasterSketch({
    receiverCount,
    showDurationMs,
    receiverHashes,
    previewSafeLimitMs,
  });

  const receiverItems = receivers.map((rx, index) => ({
    ...rx,
    showHash: receiverHashes[index] || 0,
    code: buildNrf24ManagementReceiverSketch({ ...rx, showHash: receiverHashes[index] || 0 }),
  }));

  return {
    master: {
      filename: "EL_Master_Controller_AB.ino",
      code: masterCode,
    },
    receivers: receiverItems,
    receiverHashes,
    showDurationMs,
    previewSafeLimitMs,
    receiverCount,
  };
}
