import React, { useState, useRef, useEffect, useMemo } from "react";

/* ───────────────────────── 상수 및 유틸 ───────────────────────── */

// EL 와이어는 밝기·색상을 아날로그로 조절할 수 없는 On/Off 전용 광원이에요.
// (참조: EL 인버터는 NE555 고정 발진 회로라 PWM 디밍 입력이 없고, 릴레이/2-MOS
//  스위칭소자는 전원을 완전히 켜고 끄는 것만 가능함 — EL 와이어 프로젝트 참조 문서 4장)
// 그래서 pulse/fadein/fadeout도 실제로는 "얼마나 빨리, 얼마나 촘촘하게 점멸하는가"로
// 숨쉬는 느낌·서서히 켜지는 느낌을 흉내내는 것이지, 진짜 밝기 변화가 아니에요.
// RELAY_SAFE_HZ: 릴레이 기준 실측 안정 스위칭 한계 (약 초당 6~7회 = 150ms 간격)
const RELAY_SAFE_HZ = 6;

const EFFECTS = {
  solid:   { name: "켜짐",         icon: "💡", desc: "계속 켜져 있어요",                                              color: "#FF3B6B", speed: 0 },
  strobe:  { name: "점멸(싸이키)", icon: "⚡", desc: "지정한 속도로 완전히 켜짐/꺼짐을 반복해요",                     color: "#FFD32C", speed: 5 },
  pulse:   { name: "숨쉬는 점멸",  icon: "💗", desc: "점멸 간격이 빨라졌다 느려졌다 하며 숨쉬는 느낌을 내요 (밝기 조절 아님)", color: "#33E1FF", speed: 0.7 },
  fadein:  { name: "점점 켜짐",    icon: "🌅", desc: "점멸이 점점 촘촘해지다가 완전히 켜져요 (밝기 조절 아님)",       color: "#7CFF6B", speed: 0 },
  fadeout: { name: "점점 꺼짐",    icon: "🌇", desc: "점멸이 점점 뜸해지다가 완전히 꺼져요 (밝기 조절 아님)",         color: "#FF8A3D", speed: 0 },
};
const EFFECT_CODE = { solid: 0, strobe: 1, pulse: 2, fadein: 3, fadeout: 4 };
const EFFECT_TYPES = Object.keys(EFFECTS);
const GEMINI_MODEL = "gemini-3.6-flash";
const CUSTOM_PRESETS_STORAGE = "led-stage-custom-presets";

const loadStoredCustomPresets = () => {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_STORAGE);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

const persistCustomPresets = (list) => {
  localStorage.setItem(CUSTOM_PRESETS_STORAGE, JSON.stringify(list));
};

const effectMeta = (type) => EFFECTS[type] || EFFECTS.solid;

const normalizeCustomPreset = (raw) => {
  const type = EFFECT_TYPES.includes(raw?.type) ? raw.type : "solid";
  const base = effectMeta(type);
  const color = /^#[0-9A-Fa-f]{6}$/.test(raw?.color || "") ? raw.color : base.color;
  let speed = Number(raw?.speed);
  if (!isFinite(speed)) speed = base.speed;
  if (type === "strobe") speed = Math.max(1, Math.min(20, speed || 5));
  else if (type === "pulse") speed = Math.max(0.2, Math.min(3, speed || 0.7));
  else speed = 0;
  const dur = Math.max(0.2, Math.min(30, Number(raw?.dur) || 2));
  const name = String(raw?.name || `${base.name} 커스텀`).trim().slice(0, 24) || base.name;
  const icon = String(raw?.icon || base.icon).trim().slice(0, 4) || base.icon;
  const desc = String(raw?.desc || `${name} · ${type}`).trim().slice(0, 80);
  const start = Number(raw?.start);
  return {
    id: raw?.id || uid(),
    name,
    icon,
    desc,
    type,
    color,
    speed,
    dur: Math.round(dur * 20) / 20,
    ...(isFinite(start) && start >= 0 ? { start: Math.round(start * 20) / 20 } : {}),
  };
};

/** presets(효과 블록 배열)를 실제 EL 와이어가 낼 수 있는 On/Off 시퀀스로 베이크해서 코드 생성 */
const buildArduinoCodeFromPresets = (presets, title = "AI 생성 효과") => {
  let t = 0;
  const withStart = presets.map((p) => {
    const start = Number.isFinite(p.start) ? p.start : t;
    if (!Number.isFinite(p.start)) t += p.dur;
    return { ...p, start };
  });
  const { frames } = bakeOnOffFrames(withStart, 20);
  const rows = frames.map((f) => `  {${f.t}L, ${f.on ? "HIGH" : "LOW"}}`);
  return `// ============================================================
// EL 와이어 On/Off 시퀀스 — ${title}
// 생성일: ${new Date().toLocaleString("ko-KR")}
// 형식: {시작ms, HIGH(켜짐)/LOW(꺼짐)}
// ⚠️ EL 와이어는 밝기·색상 조절이 불가능한 On/Off 전용 광원입니다.
//    아래 시퀀스를 스위칭 핀(릴레이 또는 2-MOS 드라이브 모듈의 SIG)에 그대로 적용하세요.
//    참고: 릴레이 기준 실측 안정 스위칭 한계는 초당 약 6~7회(150ms 간격)입니다.
// ============================================================
#define SWITCH_PIN 8
#define SEQ_LEN ${rows.length}

const long EL_SEQUENCE[SEQ_LEN][2] = {
${rows.length ? rows.join(",\n") : "  // (이벤트 없음)"}
};
`;
};

const buildGeminiSystemPrompt = () => `당신은 EL 와이어 무대 의상 에디터의 효과 블록 디자이너입니다.
사용자는 줄 단위 소스코드가 아니라, 드래그 가능한 효과 블록을 받습니다.
내부적으로는 아두이노에 적용 가능한 On/Off 시퀀스도 함께 만듭니다.

⚠️ 중요: EL 와이어는 밝기·색상을 아날로그로 조절할 수 없는 On/Off 전용 광원입니다.
색상(color)은 실제로 배선된 EL 와이어의 고정된 색을 미리보기에 표시하는 용도일 뿐,
밝기(brightness) 같은 값은 존재하지 않습니다. 절대 brightness 필드를 넣지 마세요.

사용 가능한 효과 타입(type): ${EFFECT_TYPES.join(", ")}
- solid: 계속 켜짐 (speed=0, 코드=0)
- strobe: 완전 켜짐/꺼짐 반복 (speed=Hz 1~20, 코드=1)
- pulse: 점멸 간격이 빨라졌다 느려졌다 하는 숨쉬는 느낌 (speed=0.2~3, 코드=2)
- fadein: 점멸이 점점 촘촘해지다 완전히 켜짐 (speed=0, 코드=3)
- fadeout: 점멸이 점점 뜸해지다 완전히 꺼짐 (speed=0, 코드=4)

반드시 JSON만 출력하세요. 마크다운/설명 문장 금지.
JSON 형식:
{
  "message": "한국어로 짧게 설명",
  "presets": [
    {
      "name": "짧은 한글 이름",
      "icon": "이모지",
      "desc": "설명",
      "type": "solid|strobe|pulse|fadein|fadeout",
      "color": "#FF3B6B",
      "speed": 0,
      "dur": 2,
      "start": 0
    }
  ],
  "arduinoCode": "선택. EL_SEQUENCE를 포함한 .h 코드"
}

규칙:
1. presets가 핵심입니다. 반드시 1~6개의 효과 블록을 만드세요.
2. color는 #RRGGBB, dur는 초(0.2~30). brightness 필드는 절대 넣지 마세요.
3. 요청이 모호해도 점멸 패턴으로 구분되는 블록들을 만드세요.
4. 줄글로 된 설명만 쓰지 말고 presets 배열을 채우세요.`;

const extractJsonObject = (text) => {
  const cleaned = String(text || "")
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("JSON 파싱 실패");
  }
};

const callGeminiForEffects = async ({ apiKey, prompt }) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: buildGeminiSystemPrompt() }],
      },
      contents: [{
        role: "user",
        parts: [{
          text: `다음 요청을 타임라인에 올릴 수 있는 효과 블록(presets)으로 만들어 주세요. 줄 코드가 아니라 블록이 핵심입니다.\n요청: ${prompt}`,
        }],
      }],
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Gemini API 오류 (${res.status})`;
    throw new Error(msg);
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!text) throw new Error("Gemini 응답이 비어 있어요.");
  return extractJsonObject(text);
};

const COSTUME_COLORS = ["#FF5C8A", "#FFB13D", "#FFE14D", "#6BFF8F", "#3DDDFF", "#7C8CFF", "#C77CFF", "#FF7CF0", "#8AFFDC"];

let _uid = 1;
const uid = () => `id${Date.now().toString(36)}${(_uid++).toString(36)}`;

const fmtTime = (t) => {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
};

const hexToRgb = (hex) => {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
};

const zoneForPart = (name) => {
  if (/안경|글라스|고글/.test(name)) return "glasses";
  if (/장갑|손/.test(name)) return "gloves";
  if (/상의|자켓|재킷|조끼|티|셔츠|드레스|원피스/.test(name)) return "top";
  if (/하의|바지|치마|팬츠/.test(name)) return "bottom";
  if (/신발|슈즈|부츠/.test(name)) return "shoes";
  if (/모자|캡|헬멧/.test(name)) return "hat";
  if (/액세서리|장식|벨트|acc/i.test(name)) return "acc";
  return "all"; // 특정 부위 이름이 아니면(예: "EL 와이어") 하나로 통합된 EL로 보고 몸 전체가 함께 빛나요
};

const partExportSuffix = (name) => {
  if (/안경|글라스|고글/.test(name)) return "Glasses";
  if (/장갑|손/.test(name)) return "Gloves";
  if (/상의|자켓|재킷|조끼|티|셔츠|드레스|원피스/.test(name)) return "Dress";
  if (/하의|바지|치마|팬츠/.test(name)) return "Pants";
  if (/신발|슈즈|부츠/.test(name)) return "Shoes";
  if (/모자|캡|헬멧/.test(name)) return "Hat";
  return "Acc";
};

const computeZoneColors = (costume, allBlocks, time) => {
  const zc = {};
  if (!costume) return zc;
  costume.parts.forEach((p) => {
    const zone = zoneForPart(p.name);
    const blk = allBlocks.find(
      (b) =>
        b.costumeId === costume.id && b.partId === p.id &&
        time >= b.start && time < b.start + b.dur
    );
    if (blk) {
      const c = effectAt(blk, time);
      if (!zc[zone] || c.a > zc[zone].a) zc[zone] = c;
    }
  });
  return zc;
};

const zoneFillProps = (zoneColors, zone) => {
  const c = zoneColors[zone] || zoneColors.all;
  if (!c || c.a <= 0.02) return { fill: "#252B3A", filter: "none", opacity: 1 };
  return {
    fill: `rgb(${c.r},${c.g},${c.b})`,
    filter: "url(#glow)",
    opacity: 0.25 + 0.75 * c.a,
  };
};

const makeParts = () => [
  { id: uid(), name: "EL 와이어", pin: 2 },
];

const makeDefaultCostumes = (n = 1) =>
  Array.from({ length: n }, (_, i) => ({
    id: uid(),
    name: `의상 ${i + 1}`,
    color: COSTUME_COLORS[i % COSTUME_COLORS.length],
    parts: makeParts(),
  }));

/**
 * 특정 시각 t에 이 블록이 On인지 Off인지 계산해요.
 * EL 와이어는 밝기를 조절할 수 없으므로(참조 문서 4장), pulse/fadein/fadeout도
 * 전부 "완전 On" 또는 "완전 Off" 둘 중 하나이고, 그 On/Off가 바뀌는 밀도(간격)만
 * 시간에 따라 달라져서 숨쉬는/서서히 켜지는 느낌을 흉내낼 뿐이에요.
 * RELAY_SAFE_HZ를 캐리어 삼아 실제 릴레이가 낼 수 있는 속도 안에서 점멸시켜요.
 */
const effectAt = (block, t) => {
  const local = t - block.start;
  const p = Math.max(0, Math.min(1, block.dur > 0 ? local / block.dur : 1));
  let on = true;
  switch (block.type) {
    case "strobe":
      on = Math.floor(local * block.speed * 2) % 2 === 0;
      break;
    case "pulse": {
      const envelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * block.speed * local - Math.PI / 2);
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
  const { r, g, b: bl } = hexToRgb(block.color);
  return { r, g, b: bl, a: on ? 1 : 0 };
};

const download = (filename, text, type = "application/json") => {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

/** 타임라인 블록을 0초~마지막 효과 끝까지 On/Off 프레임으로 베이크 (EL은 RGB·밝기 없음) */
const bakeOnOffFrames = (partBlocks, stepMs = 20) => {
  if (!partBlocks.length) {
    return { frames: [{ t: 0, on: false }], endMs: 0 };
  }
  const endMs = Math.max(
    ...partBlocks.map((b) => Math.round((b.start + b.dur) * 1000))
  );
  const frames = [];
  let prevOn = null;
  for (let t = 0; t <= endMs; t += stepMs) {
    const timeSec = t / 1000;
    let active = null;
    for (let i = partBlocks.length - 1; i >= 0; i--) {
      const b = partBlocks[i];
      if (timeSec >= b.start && timeSec < b.start + b.dur) {
        active = b;
        break;
      }
    }
    const on = active ? effectAt(active, timeSec).a > 0.5 : false;
    const changed = prevOn === null || prevOn !== on;
    if (t === 0 || changed || t + stepMs > endMs) {
      frames.push({ t, on });
      prevOn = on;
    }
  }
  const last = frames[frames.length - 1];
  if (!last || last.t !== endMs || last.on) {
    frames.push({ t: endMs, on: false });
  }
  return { frames, endMs };
};

/** 아두이노 IDE에 바로 열어 업로드 가능한 .ino 스케치 생성 (릴레이/2-MOS 스위칭 핀 On/Off, 런타임 1회 재생) */
const buildArduinoInoSketch = ({ costumeName, partName, filename, arduinoIndex, pin, partBlocks }) => {
  const sorted = [...partBlocks].sort((a, b) => a.start - b.start);
  const { frames, endMs } = bakeOnOffFrames(sorted, 20);
  const rows = frames.map((f) => `  {${f.t}L, ${f.on ? "HIGH" : "LOW"}}`);

  return `/*
 * ${filename}
 * ${costumeName} / ${partName}
 * 아두이노 보드 #${arduinoIndex} · 스위칭 핀 ${pin} (릴레이 모듈 또는 2-MOS 드라이브 모듈의 SIG/IN에 연결)
 * 생성일: ${new Date().toLocaleString("ko-KR")}
 *
 * [하드웨어 안내]
 * - EL 와이어는 밝기·색상 조절이 불가능한 On/Off 전용 광원입니다.
 * - 이 스케치는 NeoPixel처럼 낱개 LED를 켜는 게 아니라, 스위칭 핀 1개를 HIGH/LOW로
 *   토글해서 EL 배터리 라인을 물리적으로 켜고 끕니다 (릴레이 COM/NO 또는 2-MOS 모듈 SIG).
 * - 너무 빠른 On/Off는 기계식 릴레이 수명과 EL 인버터(NE555) 재기동 지연 문제가 있어서,
 *   실측 안정 한계(약 초당 6~7회, 150ms 간격) 안에서 시퀀스를 생성했습니다.
 *
 * [재생 방식]
 * - 0ms(전원 ON)부터 타임라인 런타임에 맞춰 1회 재생
 * - 마지막 효과 종료 시각(${endMs}ms)에 EL을 끄고 종료
 *
 * [사용법]
 * 1) 이 .ino 파일을 아두이노 IDE에서 열기 (별도 라이브러리 불필요)
 * 2) 보드·포트 선택 후 업로드
 */

#define SWITCH_PIN ${pin}
#define FRAME_COUNT ${rows.length}
#define END_MS ${endMs}L

// {시간ms, HIGH(켜짐)/LOW(꺼짐)} — 0초 기준 런타임 프레임
const long FRAMES[FRAME_COUNT][2] = {
${rows.length ? rows.join(",\n") : "  {0L, LOW}"}
};

bool finished = false;

void setSwitch(bool on) {
  digitalWrite(SWITCH_PIN, on ? HIGH : LOW);
}

void showFrameAt(unsigned long nowMs) {
  int idx = 0;
  for (int i = 0; i < FRAME_COUNT; i++) {
    if ((unsigned long)FRAMES[i][0] <= nowMs) idx = i;
    else break;
  }
  setSwitch(FRAMES[idx][1] == HIGH);
}

void setup() {
  pinMode(SWITCH_PIN, OUTPUT);
  setSwitch(false);
  finished = false;
}

void loop() {
  if (finished) {
    delay(100);
    return;
  }

  unsigned long now = millis(); // 0ms부터 런타임 진행

  if (now >= (unsigned long)END_MS) {
    setSwitch(false);
    finished = true; // 마지막 효과 종료 후 정지
    return;
  }

  showFrameAt(now);
  delay(10);
}
`;
};

/* ───────────────────────── 아바타 미리보기 ───────────────────────── */

function AvatarPreview({ zoneColors, glowId = "glow", compact = false }) {
  const zf = (zone) => zoneFillProps(zoneColors, zone);
  return (
    <svg viewBox="0 0 200 300" className={compact ? "avatarCompact" : "avatar"}>
      <defs>
        <filter id={glowId} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id={`${glowId}-spot`} cx="50%" cy="15%" r="80%">
          <stop offset="0%" stopColor="#232B44" />
          <stop offset="100%" stopColor="#0C0F18" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="200" height="300" fill={`url(#${glowId}-spot)`} rx="10" />
      <ellipse cx="100" cy="278" rx="70" ry="10" fill="#161B28" />
      <circle cx="100" cy="52" r="20" fill="#2B3245" />
      <path d="M80 44 Q100 24 120 44 L120 40 Q100 20 80 40 Z" {...zf("hat")} />
      <g {...zf("glasses")}>
        <rect x="84" y="48" width="13" height="8" rx="3" />
        <rect x="103" y="48" width="13" height="8" rx="3" />
        <rect x="97" y="51" width="6" height="2" />
      </g>
      <g {...zf("top")}>
        <path d="M78 80 Q100 72 122 80 L126 150 L74 150 Z" />
        <path d="M78 82 L52 120 L60 128 L82 96 Z" />
        <path d="M122 82 L148 120 L140 128 L118 96 Z" />
      </g>
      <g {...zf("gloves")}>
        <circle cx="54" cy="126" r="8" />
        <circle cx="146" cy="126" r="8" />
      </g>
      <rect x="76" y="148" width="48" height="8" rx="3" {...zf("acc")} />
      <g {...zf("bottom")}>
        <path d="M76 156 L124 156 L120 230 L106 230 L100 180 L94 230 L80 230 Z" />
      </g>
      <g {...zf("shoes")}>
        <path d="M78 232 L106 232 L106 244 L70 244 Q70 234 78 232 Z" transform="translate(-14 8) scale(0.9)" />
        <path d="M104 232 L132 232 L132 244 L96 244 Q96 234 104 232 Z" transform="translate(14 8) scale(0.9)" />
      </g>
    </svg>
  );
}

/* ───────────────────────── 튜토리얼 ───────────────────────── */

const TUTORIAL_STEPS = [
  {
    icon: "👗",
    title: "1. 의상과 파츠 준비하기",
    body: "왼쪽 패널에서 의상을 추가하고, 의상 이름을 눌러 펼치면 안경·장갑·상의 같은 파츠를 자유롭게 추가/수정할 수 있어요. 파츠마다 EL 와이어를 On/Off 할 아두이노 스위칭 핀 번호를 정할 수 있습니다.",
  },
  {
    icon: "🎵",
    title: "2. 음악 올리고 타임라인 보기",
    body: "위쪽 도구막대의 [🎵 음악 업로드] 버튼으로 MP3/WAV 파일을 올리면 가운데에 소리 파형이 나타나요. 파형이나 눈금자를 클릭하면 그 위치로 바로 이동합니다.",
  },
  {
    icon: "🖱️",
    title: "3. 효과 블록 올리기",
    body: "왼쪽 아래의 효과 카드(단색·싸이키·펄스 등)를 마우스로 끌어서 타임라인 트랙 위에 놓으세요. 블록을 잡고 옮기거나, 양쪽 끝을 잡아 길이를 늘이고 줄일 수 있어요.",
  },
  {
    icon: "🎛️",
    title: "4. 색·점멸 속도 바꾸고 미리보기",
    body: "블록을 클릭하면 오른쪽 아래에 설정창이 열려요. 미리보기 색상과 깜빡임 속도를 바꿔보세요(EL은 On/Off만 가능해서 밝기 조절은 없어요). 재생(▶)을 누르면 오른쪽 위 댄서 그림에서 EL 와이어가 실제처럼 켜지고 꺼집니다.",
  },
  {
    icon: "💾",
    title: "5. 저장하고 아두이노로 보내기",
    body: "[💾 저장]으로 작업 전체를 JSON 파일로 보관하고, [🤖 아두이노 내보내기]에서 필요한 의상·파츠만 체크해 시퀀스 파일을 만들 수 있어요. 이제 시작해 볼까요?",
  },
];

/* ───────────────────────── 메인 앱 ───────────────────────── */

export default function App() {
  const [costumes, setCostumes] = useState(() => makeDefaultCostumes(1));
  const [blocks, setBlocks] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const [previewCostumeId, setPreviewCostumeId] = useState(null);

  const [audioInfo, setAudioInfo] = useState(null);
  const [manualDuration, setManualDuration] = useState(60);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pps, setPps] = useState(40);
  const [leftW, setLeftW] = useState(260);
  const [rightW, setRightW] = useState(280);
  const [showTutorial, setShowTutorial] = useState(true);
  const [tutStep, setTutStep] = useState(0);
  const [toast, setToast] = useState(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportSelected, setExportSelected] = useState({});
  const [geminiPrompt, setGeminiPrompt] = useState("");
  const [geminiBusy, setGeminiBusy] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState("");
  const [customPresets, setCustomPresets] = useState(() => loadStoredCustomPresets());

  const audioElRef = useRef(null);
  const audioUrlRef = useRef(null);
  const fileInputRef = useRef(null);
  const projectInputRef = useRef(null);
  const waveCanvasRef = useRef(null);
  const timelineBodyRef = useRef(null);
  const timelineScrollRef = useRef(null);
  const contentRef = useRef(null);
  const dragRef = useRef(null);

  const duration = audioInfo ? audioInfo.duration : manualDuration;
  const timelineW = Math.max(600, duration * pps);

  useEffect(() => {
    if (costumes.length && previewCostumeId == null) {
      setPreviewCostumeId(costumes[0].id);
      setExpanded((e) => ({ ...e, [costumes[0].id]: true }));
    }
  }, [costumes, previewCostumeId]);

  useEffect(() => {
    const el = audioElRef.current;
    if (!el) return;
    const onEnded = () => setPlaying(false);
    el.addEventListener("ended", onEnded);
    return () => el.removeEventListener("ended", onEnded);
  }, [audioInfo]);

  useEffect(() => () => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  /* ── 재생 루프 ── */
  useEffect(() => {
    if (!playing) return;
    let raf;
    let last = performance.now();
    const tick = (now) => {
      const el = audioElRef.current;
      if (audioInfo && el) {
        setCurrentTime(el.currentTime);
        if (el.ended) { setPlaying(false); return; }
      } else {
        setCurrentTime((t) => {
          const nt = t + (now - last) / 1000;
          if (nt >= duration) { setPlaying(false); return duration; }
          return nt;
        });
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, audioInfo, duration]);

  const play = async () => {
    if (audioInfo && audioElRef.current) {
      try {
        await audioElRef.current.play();
      } catch {
        showToast("⚠️ 브라우저에서 재생이 차단됐어요. 재생(▶) 버튼을 한 번 눌러 주세요.");
        return;
      }
    }
    setPlaying(true);
  };
  const pause = () => {
    if (audioElRef.current) audioElRef.current.pause();
    setPlaying(false);
  };
  const stop = () => {
    pause();
    seek(0);
  };
  const seek = (t) => {
    const nt = Math.max(0, Math.min(duration, t));
    setCurrentTime(nt);
    if (audioElRef.current) audioElRef.current.currentTime = nt;
  };

  /* ── 음악 업로드 ── */
  const onAudioFile = async (file) => {
    if (!file) return;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    const url = URL.createObjectURL(file);
    audioUrlRef.current = url;
    try {
      const buf = await file.arrayBuffer();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await ctx.decodeAudioData(buf.slice(0));
      const data = decoded.getChannelData(0);
      const N = 1600;
      const step = Math.floor(data.length / N);
      const peaks = new Array(N);
      for (let i = 0; i < N; i++) {
        let max = 0;
        for (let j = 0; j < step; j += 8) {
          const v = Math.abs(data[i * step + j] || 0);
          if (v > max) max = v;
        }
        peaks[i] = max;
      }
      await ctx.close();
      setAudioInfo({ name: file.name, duration: decoded.duration, peaks });
      const el = audioElRef.current;
      if (el) {
        el.src = url;
        el.load();
      }
      seek(0);
      showToast(`🎵 "${file.name}" 불러오기 완료! ▶ 재생 또는 스페이스바로 들을 수 있어요`);
    } catch (e) {
      URL.revokeObjectURL(url);
      audioUrlRef.current = null;
      showToast("⚠️ 음악 파일을 읽을 수 없어요. MP3 또는 WAV 파일인지 확인해 주세요.");
    }
  };

  /* ── 파형 그리기 ── */
  useEffect(() => {
    const cv = waveCanvasRef.current;
    if (!cv) return;
    const W = timelineW, H = 56;
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, W, H);
    if (!audioInfo) {
      g.fillStyle = "#3A4258";
      g.font = "12px sans-serif";
      g.fillText("🎵 음악을 업로드하면 여기에 소리 파형이 표시돼요", 12, H / 2 + 4);
      return;
    }
    const { peaks } = audioInfo;
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#5EE0FF");
    grad.addColorStop(1, "#7C5CFF");
    g.fillStyle = grad;
    const bw = W / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const h = Math.max(1, peaks[i] * (H - 6));
      g.fillRect(i * bw, (H - h) / 2, Math.max(1, bw - 0.5), h);
    }
  }, [audioInfo, timelineW]);

  /* ── 트랙 목록 ── */
  const tracks = useMemo(() => {
    const arr = [];
    costumes.forEach((c) => {
      arr.push({ kind: "costume", costume: c });
      if (expanded[c.id]) {
        c.parts.forEach((p) => arr.push({ kind: "part", costume: c, part: p }));
      }
    });
    return arr;
  }, [costumes, expanded]);

  const timeFromEvent = (e) => {
    const rect = contentRef.current.getBoundingClientRect();
    return Math.max(0, (e.clientX - rect.left) / pps);
  };

  const onDropPreset = (e, costumeId, partId) => {
    e.preventDefault();
    const customRaw = e.dataTransfer.getData("customPreset");
    let preset = null;
    if (customRaw) {
      try { preset = JSON.parse(customRaw); } catch { preset = null; }
    }
    const type = preset?.type || e.dataTransfer.getData("effect");
    if (!EFFECTS[type] && !preset) return;
    const resolvedType = EFFECTS[type] ? type : "solid";
    const meta = effectMeta(resolvedType);
    const t = Math.min(timeFromEvent(e), duration - 0.5);
    const dur = Math.max(0.2, Math.min(duration - t, Number(preset?.dur) || 2));
    const nb = {
      id: uid(),
      costumeId,
      partId,
      type: resolvedType,
      start: Math.round(t * 20) / 20,
      dur: Math.round(dur * 20) / 20,
      color: preset?.color || meta.color,
      speed: preset?.speed ?? meta.speed,
      label: preset?.name || meta.name,
      icon: preset?.icon || meta.icon,
    };
    setBlocks((bs) => [...bs, nb]);
    setSelectedBlockId(nb.id);
    setPreviewCostumeId(costumeId);
  };

  const startBlockDrag = (e, block, mode) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedBlockId(block.id);
    setPreviewCostumeId(block.costumeId);
    dragRef.current = { mode, id: block.id, startX: e.clientX, s0: block.start, d0: block.dur };
    const move = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const dt = (ev.clientX - d.startX) / pps;
      setBlocks((bs) =>
        bs.map((b) => {
          if (b.id !== d.id) return b;
          if (d.mode === "move") {
            return { ...b, start: Math.max(0, Math.min(duration - b.dur, d.s0 + dt)) };
          }
          if (d.mode === "l") {
            const ns = Math.max(0, Math.min(d.s0 + d.d0 - 0.2, d.s0 + dt));
            return { ...b, start: ns, dur: d.s0 + d.d0 - ns };
          }
          return { ...b, dur: Math.max(0.2, Math.min(duration - d.s0, d.d0 + dt)) };
        })
      );
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const masterAllOn = () => {
    const t = Math.min(currentTime, duration - 2);
    const nbs = [];
    costumes.forEach((c) =>
      c.parts.forEach((p) =>
        nbs.push({
          id: uid(), costumeId: c.id, partId: p.id, type: "solid",
          start: Math.round(t * 20) / 20, dur: 2, color: "#FFFFFF", speed: 0,
        })
      )
    );
    setBlocks((bs) => [...bs, ...nbs]);
    showToast("✨ 현재 위치에 모든 의상·파츠 전체 점등 블록을 추가했어요! (흰색 2초)");
  };

  const addCostume = () => {
    const c = {
      id: uid(),
      name: `의상 ${costumes.length + 1}`,
      color: COSTUME_COLORS[costumes.length % COSTUME_COLORS.length],
      parts: makeParts(),
    };
    setCostumes((cs) => [...cs, c]);
    setExpanded((e) => ({ ...e, [c.id]: true }));
  };
  const removeCostume = (cid) => {
    if (!window.confirm("이 의상과 관련된 모든 효과 블록이 함께 삭제돼요. 정말 삭제할까요?")) return;
    setCostumes((cs) => cs.filter((c) => c.id !== cid));
    setBlocks((bs) => bs.filter((b) => b.costumeId !== cid));
    if (previewCostumeId === cid) setPreviewCostumeId(null);
  };
  const renameCostume = (cid, name) =>
    setCostumes((cs) => cs.map((c) => (c.id === cid ? { ...c, name } : c)));
  const addPart = (cid) =>
    setCostumes((cs) =>
      cs.map((c) =>
        c.id === cid
          ? { ...c, parts: [...c.parts, { id: uid(), name: "새 파츠", pin: 7 }] }
          : c
      )
    );
  const updatePart = (cid, pid, patch) =>
    setCostumes((cs) =>
      cs.map((c) =>
        c.id === cid
          ? { ...c, parts: c.parts.map((p) => (p.id === pid ? { ...p, ...patch } : p)) }
          : c
      )
    );
  const removePart = (cid, pid) => {
    setCostumes((cs) =>
      cs.map((c) => (c.id === cid ? { ...c, parts: c.parts.filter((p) => p.id !== pid) } : c))
    );
    setBlocks((bs) => bs.filter((b) => !(b.costumeId === cid && b.partId === pid)));
  };

  const updateCustomPresets = (updater) => {
    setCustomPresets((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      persistCustomPresets(next);
      return next;
    });
  };

  const removeCustomPreset = (id) => {
    if (!window.confirm("이 AI 효과 블록을 보관함에서 삭제할까요?")) return;
    updateCustomPresets((list) => list.filter((p) => p.id !== id));
    showToast("🗑 AI 효과 블록을 삭제했어요.");
  };

  const applyGeminiPresets = (payload) => {
    const rawList = Array.isArray(payload?.presets)
      ? payload.presets
      : Array.isArray(payload?.blocks)
        ? payload.blocks
        : [];
    if (!rawList.length) {
      throw new Error("효과 블록을 만들지 못했어요. 원하는 색·효과·길이를 조금 더 구체적으로 적어 보세요.");
    }
    const created = rawList.map((raw) => {
      const preset = normalizeCustomPreset(raw);
      return {
        ...preset,
        arduinoCode: buildArduinoCodeFromPresets([preset], preset.name),
      };
    });
    updateCustomPresets((list) => [...created, ...list]);
    return { count: created.length, message: payload?.message || "", created };
  };

  const runGeminiPrompt = async () => {
    if (geminiBusy) return;
    const key = (import.meta.env.VITE_GEMINI_API_KEY || "").trim();
    const prompt = geminiPrompt.trim();
    if (!key) {
      showToast("⚠️ .env의 VITE_GEMINI_API_KEY를 설정한 뒤 개발 서버를 다시 시작해 주세요.");
      return;
    }
    if (!prompt) {
      showToast("⚠️ 만들고 싶은 효과를 프롬프트로 적어 주세요.");
      return;
    }

    setGeminiBusy(true);
    setGeminiStatus("효과 블록을 생성하는 중…");
    try {
      const payload = await callGeminiForEffects({ apiKey: key, prompt });
      const { count, message } = applyGeminiPresets(payload);
      setGeminiStatus(message || `효과 블록 ${count}개를 보관함에 추가했어요.`);
      showToast(`✨ 효과 블록 ${count}개를 보관함에 만들었어요. 타임라인으로 끌어다 놓으세요!`);
    } catch (err) {
      const msg = err?.message || "요청에 실패했어요.";
      setGeminiStatus(`오류: ${msg}`);
      showToast(`⚠️ ${msg}`);
    } finally {
      setGeminiBusy(false);
    }
  };

  const saveProject = () => {
    const data = {
      version: 2,
      savedAt: new Date().toISOString(),
      duration,
      costumes,
      blocks,
      customPresets,
    };
    download("led_무대의상_프로젝트.json", JSON.stringify(data, null, 2));
    showToast("💾 프로젝트를 JSON 파일로 저장했어요!");
  };
  const loadProject = async (file) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      setCostumes(data.costumes || []);
      setBlocks(data.blocks || []);
      if (Array.isArray(data.customPresets)) {
        const merged = data.customPresets.map((p) => normalizeCustomPreset(p));
        updateCustomPresets(merged);
      }
      if (!audioInfo && data.duration) setManualDuration(data.duration);
      setSelectedBlockId(null);
      setPreviewCostumeId(data.costumes?.[0]?.id ?? null);
      showToast("📂 프로젝트를 불러왔어요!");
    } catch {
      showToast("⚠️ 프로젝트 파일을 읽을 수 없어요. 저장했던 JSON 파일이 맞는지 확인해 주세요.");
    }
  };
  const arduinoExportTargets = useMemo(() => {
    const list = [];
    let arduinoIndex = 1;
    costumes.forEach((costume) => {
      costume.parts.forEach((part) => {
        const eventCount = blocks.filter(
          (b) => b.costumeId === costume.id && b.partId === part.id
        ).length;
        list.push({
          key: `${costume.id}::${part.id}`,
          costumeId: costume.id,
          partId: part.id,
          costumeName: costume.name,
          costumeColor: costume.color,
          partName: part.name,
          pin: part.pin,
          arduinoIndex,
          filename: `Arduino_${arduinoIndex}_${partExportSuffix(part.name)}.ino`,
          eventCount,
        });
        arduinoIndex++;
      });
    });
    return list;
  }, [costumes, blocks]);

  const openExportModal = () => {
    if (!arduinoExportTargets.length) {
      showToast("⚠️ 내보낼 의상·파츠가 없어요. 의상과 파츠를 먼저 추가해 주세요.");
      return;
    }
    const initial = {};
    arduinoExportTargets.forEach((t) => { initial[t.key] = false; });
    setExportSelected(initial);
    setShowExportModal(true);
  };

  const toggleExportItem = (key) =>
    setExportSelected((s) => ({ ...s, [key]: !s[key] }));

  const setAllExportSelected = (value) => {
    const next = {};
    arduinoExportTargets.forEach((t) => { next[t.key] = value; });
    setExportSelected(next);
  };

  const exportArduino = () => {
    const selected = arduinoExportTargets.filter((t) => exportSelected[t.key]);
    if (!selected.length) {
      showToast("⚠️ 내보낼 항목을 하나 이상 체크해 주세요.");
      return;
    }

    let totalEvents = 0;
    selected.forEach((target) => {
      const partBlocks = blocks
        .filter((b) => b.costumeId === target.costumeId && b.partId === target.partId)
        .sort((a, b) => a.start - b.start);
      const code = buildArduinoInoSketch({
        costumeName: target.costumeName,
        partName: target.partName,
        filename: target.filename,
        arduinoIndex: target.arduinoIndex,
        pin: target.pin,
        partBlocks,
      });
      download(target.filename, code, "text/x-arduino");
      totalEvents += partBlocks.length;
    });

    setShowExportModal(false);
    showToast(`🤖 아두이노 스케치 ${selected.length}개(.ino) 내보내기 완료! (총 ${totalEvents}개 이벤트)`);
  };

  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) || null;
  const patchBlock = (patch) =>
    setBlocks((bs) => bs.map((b) => (b.id === selectedBlockId ? { ...b, ...patch } : b)));
  const deleteBlock = () => {
    setBlocks((bs) => bs.filter((b) => b.id !== selectedBlockId));
    setSelectedBlockId(null);
  };

  useEffect(() => {
    const h = (e) => {
      const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
      if (e.code === "Space" && !typing) {
        e.preventDefault();
        if (playing) pause();
        else play();
        return;
      }
      if (!typing && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        zoomIn();
        return;
      }
      if (!typing && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        zoomOut();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedBlockId && !typing) {
        deleteBlock();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selectedBlockId, playing]);

  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;
    const onWheel = (e) => {
      // 세로 스크롤/트랙패드를 타임라인 좌우 이동으로 사용
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (dx === 0) return;
      e.preventDefault();
      el.scrollLeft += dx;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const startTimelinePan = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".block, .handle, input, button")) return;
    const scrollEl = timelineScrollRef.current;
    if (!scrollEl) return;
    const startX = e.clientX;
    const startScroll = scrollEl.scrollLeft;
    let panning = false;
    const move = (ev) => {
      const dx = ev.clientX - startX;
      if (!panning && Math.abs(dx) < 4) return;
      if (!panning) {
        panning = true;
        scrollEl.classList.add("panning");
      }
      ev.preventDefault();
      scrollEl.scrollLeft = startScroll - dx;
    };
    const up = () => {
      scrollEl.classList.remove("panning");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const previewCostume = costumes.find((c) => c.id === previewCostumeId) || costumes[0];
  const zoneColors = useMemo(
    () => computeZoneColors(previewCostume, blocks, currentTime),
    [blocks, previewCostume, currentTime]
  );

  const allCostumePreviews = useMemo(
    () =>
      costumes.map((c) => ({
        costume: c,
        zoneColors: computeZoneColors(c, blocks, currentTime),
      })),
    [costumes, blocks, currentTime]
  );

  const rulerMarks = useMemo(() => {
    const stepSec = pps >= 60 ? 1 : pps >= 25 ? 2 : 5;
    const marks = [];
    for (let t = 0; t <= duration; t += stepSec) marks.push(t);
    return marks;
  }, [duration, pps]);

  const startPanelResize = (side) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === "left" ? leftW : rightW;
    document.body.classList.add("resizingPanels");
    const move = (ev) => {
      const dx = ev.clientX - startX;
      if (side === "left") {
        setLeftW(Math.max(180, Math.min(460, startW + dx)));
      } else {
        setRightW(Math.max(180, Math.min(460, startW - dx)));
      }
    };
    const up = () => {
      document.body.classList.remove("resizingPanels");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const zoomOut = () => setPps((p) => Math.max(8, Math.round(p / 1.25)));
  const zoomIn = () => setPps((p) => Math.min(240, Math.round(p * 1.25)));
  const zoomPercent = Math.round((pps / 40) * 100);
  const TRACK_H = 34;

  return (
    <div className="app">
      <style>{CSS}</style>
      <audio ref={audioElRef} preload="auto" />

      {/* ── 상단 도구막대 ── */}
      <header className="toolbar">
        <div className="logo">
          <span className="logoIcon">💡</span>
          <div className="logoTitle">LED 타임라인</div>
        </div>

        <div className="transport">
          <button className="tbtn tip" data-tip="처음으로" onClick={stop}>⏹</button>
          {playing ? (
            <button className="tbtn playing tip" data-tip="일시정지" onClick={pause}>⏸</button>
          ) : (
            <button className="tbtn play tip" data-tip="재생 (스페이스)" onClick={play}>▶</button>
          )}
          <div className="timecode">{fmtTime(currentTime)} <span className="dim">/ {fmtTime(duration)}</span></div>
        </div>

        <div className="toolGroup">
          <button className="tbtn master tip" data-tip="현재 위치에 전체 점등 블록 추가" onClick={masterAllOn}>✨ 전체 점등</button>
        </div>

        <div className="toolGroup right">
          <button className="tbtn compact tip" data-tip="MP3 / WAV 업로드" onClick={() => fileInputRef.current.click()}>🎵 음악</button>
          <button className="tbtn compact tip" data-tip="JSON으로 저장" onClick={saveProject}>💾 저장</button>
          <button className="tbtn compact tip" data-tip="JSON 불러오기" onClick={() => projectInputRef.current.click()}>📂 열기</button>
          <button className="tbtn compact export tip" data-tip="아두이노 업로드용 .ino 스케치 내보내기 (예: Arduino_1_Dress.ino)" onClick={openExportModal}>🤖 내보내기</button>
          <button className="tbtn compact tip" data-tip="사용법" onClick={() => { setTutStep(0); setShowTutorial(true); }}>❓</button>
        </div>

        <input ref={fileInputRef} type="file" accept="audio/*" hidden onChange={(e) => onAudioFile(e.target.files[0])} />
        <input ref={projectInputRef} type="file" accept=".json" hidden onChange={(e) => loadProject(e.target.files[0])} />
      </header>

      <div className="main">
        {/* ── 좌측 ── */}
        <aside className="left" style={{ width: leftW, minWidth: leftW, maxWidth: leftW }}>
          <section className="panel">
            <div className="panelHead">
              <h2>👗 의상 목록</h2>
              <button className="miniBtn tip" data-tip="새 의상을 추가해요" onClick={addCostume}>＋ 추가</button>
            </div>
            <div className="costumeList">
              {costumes.map((c) => (
                <div key={c.id} className={`costumeItem ${previewCostumeId === c.id ? "active" : ""}`}>
                  <div className="costumeRow" onClick={() => { setExpanded((e) => ({ ...e, [c.id]: !e[c.id] })); setPreviewCostumeId(c.id); }}>
                    <span className="chev">{expanded[c.id] ? "▾" : "▸"}</span>
                    <span className="swatch" style={{ background: c.color }} />
                    <input
                      className="nameInput"
                      value={c.name}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => renameCostume(c.id, e.target.value)}
                    />
                    <button className="iconBtn tip" data-tip="의상 삭제" onClick={(e) => { e.stopPropagation(); removeCostume(c.id); }}>🗑</button>
                  </div>
                  {expanded[c.id] && (
                    <div className="partList">
                      <div className="partHeadRow">
                        <span>파츠 이름</span><span>스위칭 핀</span><span></span>
                      </div>
                      {c.parts.map((p) => (
                        <div key={p.id} className="partRow">
                          <input value={p.name} onChange={(e) => updatePart(c.id, p.id, { name: e.target.value })} />
                          <input type="number" value={p.pin} min={0} max={53}
                            className="tip" data-tip="이 EL 와이어를 On/Off 하는 아두이노 스위칭 핀 번호 (릴레이·2-MOS 모듈 SIG로 연결)"
                            onChange={(e) => updatePart(c.id, p.id, { pin: +e.target.value })} />
                          <button className="iconBtn tip" data-tip="파츠 삭제" onClick={() => removePart(c.id, p.id)}>✕</button>
                        </div>
                      ))}
                      <button className="miniBtn wide" onClick={() => addPart(c.id)}>＋ 파츠 추가</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panelHead"><h2>🎇 효과 보관함</h2></div>
            <p className="hint">카드를 <b>마우스로 끌어서</b> 오른쪽 타임라인 트랙 위에 놓아 보세요!</p>
            <div className="presetGrid">
              {Object.entries(EFFECTS).map(([key, ef]) => (
                <div
                  key={key}
                  className="presetCard tip"
                  data-tip={ef.desc}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("effect", key)}
                  style={{ "--ec": ef.color }}
                >
                  <span className="pIcon">{ef.icon}</span>
                  <span className="pName">{ef.name}</span>
                </div>
              ))}
            </div>

            {customPresets.length > 0 && (
              <>
                <div className="customPresetHead">✨ AI 효과 블록 · 타임라인에 끌어다 놓으세요</div>
                <div className="presetGrid">
                  {customPresets.map((preset) => (
                    <div
                      key={preset.id}
                      className="presetCard customPreset tip"
                      data-tip={`${preset.desc} · ${preset.dur}초`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("customPreset", JSON.stringify(preset));
                        e.dataTransfer.setData("effect", preset.type);
                      }}
                      style={{ "--ec": preset.color }}
                    >
                      <button
                        type="button"
                        className="presetDelete tip"
                        data-tip="이 AI 효과 블록 삭제"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          removeCustomPreset(preset.id);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        ✕
                      </button>
                      <div className="presetColorBar" style={{ background: preset.color }} />
                      <span className="pIcon">{preset.icon}</span>
                      <span className="pName">{preset.name}</span>
                      <span className="presetMeta">
                        {effectMeta(preset.type).name} · {preset.dur}s
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="panel geminiPanel">
            <div className="panelHead">
              <h2>✨ AI 효과 만들기</h2>
            </div>
            <p className="hint">프롬프트를 적으면 <b>드래그 가능한 효과 블록</b>이 보관함에 추가됩니다. (줄 코드는 표시하지 않아요)</p>

            <textarea
              className="geminiPrompt"
              rows={4}
              value={geminiPrompt}
              placeholder={'예: 빨간 빠른 싸이키, 파란 느린 펄스, 화이트 페이드인 블록 만들어줘'}
              onChange={(e) => setGeminiPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  runGeminiPrompt();
                }
              }}
              disabled={geminiBusy}
            />

            <div className="geminiActions">
              <button
                type="button"
                className="miniBtn"
                onClick={() => setGeminiPrompt("빨간 싸이키, 시안 펄스, 골드 단색 점등 블록을 만들어줘")}
                disabled={geminiBusy}
              >
                예시 넣기
              </button>
              <button
                type="button"
                className="geminiRunBtn"
                onClick={runGeminiPrompt}
                disabled={geminiBusy}
              >
                {geminiBusy ? "생성 중…" : "✨ 블록 생성"}
              </button>
            </div>
            {geminiStatus && <p className="geminiStatus">{geminiStatus}</p>}
            <p className="geminiHint">Ctrl/Cmd + Enter · 생성된 블록은 보관함에 저장되며 타임라인으로 드래그할 수 있어요</p>
          </section>
        </aside>

        <div
          className="resizeHandle tip"
          data-tip="드래그해서 왼쪽 패널 너비 조절"
          onMouseDown={startPanelResize("left")}
        />

        {/* ── 중앙 ── */}
        <main className="center" ref={timelineBodyRef}>
          <div
            className="timelineScroll"
            ref={timelineScrollRef}
            onMouseDown={startTimelinePan}
            title="드래그 또는 마우스 휠로 좌우 이동 · +/− 키로 확대/축소"
          >
            <div className="timelineContent" ref={contentRef} style={{ width: timelineW }}>
              <div className="ruler" onClick={(e) => seek(timeFromEvent(e))} title="클릭하면 그 위치로 이동해요">
                {rulerMarks.map((t) => (
                  <div key={t} className="mark" style={{ left: t * pps }}>
                    <span>{fmtTime(t).slice(0, 5)}</span>
                  </div>
                ))}
              </div>
              <div className="waveRow" onClick={(e) => seek(timeFromEvent(e))}>
                <canvas ref={waveCanvasRef} />
              </div>

              {tracks.map((tr) =>
                tr.kind === "costume" ? (
                  <div
                    key={tr.costume.id}
                    className="groupRow"
                    onClick={() => { setExpanded((e) => ({ ...e, [tr.costume.id]: !e[tr.costume.id] })); setPreviewCostumeId(tr.costume.id); }}
                  >
                    <span className="swatch" style={{ background: tr.costume.color }} />
                    {tr.costume.name}
                    <span className="dim"> — {tr.costume.parts.length}개 파츠 {expanded[tr.costume.id] ? "" : "(클릭해서 펼치기)"}</span>
                  </div>
                ) : (
                  <div
                    key={tr.part.id}
                    className="trackRow"
                    style={{ height: TRACK_H }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => onDropPreset(e, tr.costume.id, tr.part.id)}
                  >
                    <div className="trackLabel" style={{ borderColor: tr.costume.color }}>
                      {tr.part.name}
                    </div>
                    {blocks
                      .filter((b) => b.costumeId === tr.costume.id && b.partId === tr.part.id)
                      .map((b) => (
                        <div
                          key={b.id}
                          className={`block ${selectedBlockId === b.id ? "sel" : ""}`}
                          style={{
                            left: b.start * pps,
                            width: Math.max(10, b.dur * pps),
                            "--bc": b.color,
                          }}
                          onMouseDown={(e) => startBlockDrag(e, b, "move")}
                          title={`${b.label || EFFECTS[b.type].name} · ${fmtTime(b.start)}부터 ${b.dur.toFixed(1)}초`}
                        >
                          <span className="bLabel">{b.icon || EFFECTS[b.type].icon} {b.label || EFFECTS[b.type].name}</span>
                          <span className="handle l" onMouseDown={(e) => startBlockDrag(e, b, "l")} />
                          <span className="handle r" onMouseDown={(e) => startBlockDrag(e, b, "r")} />
                        </div>
                      ))}
                  </div>
                )
              )}

              <div className="playhead" style={{ left: currentTime * pps }}>
                <div className="phTop" />
              </div>
            </div>
          </div>

          <div className="timelineFooter">
            {!audioInfo ? (
              <label className="tip footerLen" data-tip="음악이 없을 때 사용할 타임라인 길이예요">
                ⏱ 길이(초)
                <input
                  type="number" min={10} max={600} value={manualDuration}
                  onChange={(e) => setManualDuration(Math.max(10, +e.target.value || 60))}
                />
              </label>
            ) : (
              <span className="footerHint dim">{audioInfo.name}</span>
            )}
            <div className="zoomControl tip" data-tip="타임라인 확대/축소 · 키보드 + / - 도 가능">
              <button type="button" className="zoomBtn" onClick={zoomOut} aria-label="축소">−</button>
              <input
                type="range"
                className="zoomSlider"
                min={8}
                max={200}
                step={1}
                value={Math.min(200, Math.max(8, pps))}
                onChange={(e) => setPps(+e.target.value)}
              />
              <button type="button" className="zoomBtn" onClick={zoomIn} aria-label="확대">+</button>
              <span className="zoomLabel">{zoomPercent}%</span>
            </div>
          </div>
        </main>

        <div
          className="resizeHandle tip"
          data-tip="드래그해서 오른쪽 패널 너비 조절"
          onMouseDown={startPanelResize("right")}
        />

        {/* ── 우측 ── */}
        <aside className="right" style={{ width: rightW, minWidth: rightW, maxWidth: rightW }}>
          <section className="panel grow">
            <div className="panelHead">
              <h2>🕺 무대 미리보기</h2>
            </div>
            <div className="costumeTabs">
              {costumes.map((c) => (
                <button
                  key={c.id}
                  className={`ctab ${previewCostumeId === c.id ? "on" : ""}`}
                  style={{ "--cc": c.color }}
                  onClick={() => setPreviewCostumeId(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <div className="stage">
              <AvatarPreview zoneColors={zoneColors} glowId="glow-main" />
              <p className="stageHint">▶ 재생하면 지금 색으로 빛나요 · 스페이스바로 재생/정지 · 파츠 이름을 "상의·하의" 등으로 지으면 그 부위만, 그냥 "EL 와이어"처럼 두면 몸 전체가 같이 빛나요</p>
            </div>
          </section>

          <section className="panel">
            <div className="panelHead"><h2>🎛 효과 설정</h2></div>
            {!selectedBlock ? (
              <p className="hint">타임라인의 효과 블록을 클릭하면<br />여기서 색상·점멸 속도를 바꿀 수 있어요.<br /><span className="dim">(EL 와이어는 On/Off만 가능해서 밝기 조절은 없어요)</span></p>
            ) : (
              <div className="props">
                <div className="propTitle" style={{ "--bc": selectedBlock.color }}>
                  {selectedBlock.icon || EFFECTS[selectedBlock.type].icon}{" "}
                  {selectedBlock.label || EFFECTS[selectedBlock.type].name}
                </div>

                <label className="propRow">
                  <span className="tip" data-tip="실제 배선된 EL 와이어 색을 미리보기에 표시해요 (하드웨어 색을 바꾸는 건 아니에요)">🎨 미리보기 색상</span>
                  <input type="color" value={selectedBlock.color} onChange={(e) => patchBlock({ color: e.target.value })} />
                  <code>{selectedBlock.color.toUpperCase()}</code>
                </label>

                {(selectedBlock.type === "strobe" || selectedBlock.type === "pulse") && (
                  <label className="propRow">
                    <span className="tip" data-tip={selectedBlock.type === "strobe" ? "1초에 몇 번 깜빡일지 정해요" : "숨쉬는 주기의 빠르기예요"}>
                      {selectedBlock.type === "strobe" ? "⚡ 깜빡임 속도" : "💗 숨쉬기 속도"}
                    </span>
                    <input type="range" min={selectedBlock.type === "strobe" ? 1 : 0.2} max={selectedBlock.type === "strobe" ? 20 : 3}
                      step={0.1} value={selectedBlock.speed}
                      onChange={(e) => patchBlock({ speed: +e.target.value })} />
                    <code>{selectedBlock.speed.toFixed(1)}{selectedBlock.type === "strobe" ? "Hz" : "x"}</code>
                  </label>
                )}

                <div className="propGrid2">
                  <label>
                    시작 시각(초)
                    <input type="number" step={0.1} min={0} value={selectedBlock.start.toFixed(1)}
                      onChange={(e) => patchBlock({ start: Math.max(0, +e.target.value) })} />
                  </label>
                  <label>
                    길이(초)
                    <input type="number" step={0.1} min={0.2} value={selectedBlock.dur.toFixed(1)}
                      onChange={(e) => patchBlock({ dur: Math.max(0.2, +e.target.value) })} />
                  </label>
                </div>

                <button className="dangerBtn" onClick={deleteBlock}>🗑 이 효과 블록 삭제 (Delete 키)</button>
              </div>
            )}
          </section>
        </aside>
      </div>

      {/* ── 하단: 전체 의상 무대 미리보기 ── */}
      <footer className="bottomStrip">
        <div className="bottomStripHead">
          <h2>🎭 전체 의상 무대 보기</h2>
          <span className="dim">재생 시 모든 의상이 동시에 빛나요 · 클릭하면 우측 미리보기로 전환</span>
        </div>
        <div className="bottomStripScroll">
          {allCostumePreviews.map(({ costume, zoneColors: zc }, i) => (
            <button
              key={costume.id}
              type="button"
              className={`bottomCostumeCard ${previewCostumeId === costume.id ? "active" : ""}`}
              style={{ "--cc": costume.color }}
              onClick={() => setPreviewCostumeId(costume.id)}
            >
              <div className="bottomCostumeLabel">
                <span className="swatch" style={{ background: costume.color }} />
                {costume.name}
              </div>
              <AvatarPreview zoneColors={zc} glowId={`glow-strip-${i}`} compact />
            </button>
          ))}
          <button type="button" className="bottomAddCard" onClick={addCostume}>
            <span className="addIcon">＋</span>
            <span>의상 추가</span>
          </button>
        </div>
      </footer>

      {toast && <div className="toast">{toast}</div>}

      {showExportModal && (
        <div className="modalBack" onClick={() => setShowExportModal(false)}>
          <div className="modal exportModal" onClick={(e) => e.stopPropagation()}>
            <div className="modalIcon">🤖</div>
            <h3>아두이노 내보내기</h3>
            <p className="exportLead">
              저장할 의상·파츠를 체크한 뒤 내보내 주세요.
              <b>0초부터 마지막 효과 종료까지 1회 재생</b>되는 .ino 스케치로 저장됩니다.
              (효과코드 없이 타임라인 RGB 프레임으로 변환)
            </p>

            <div className="exportToolbar">
              <button type="button" className="ghostBtn" onClick={() => setAllExportSelected(true)}>전체 선택</button>
              <button type="button" className="ghostBtn" onClick={() => setAllExportSelected(false)}>전체 해제</button>
              <span className="exportCount">
                {Object.values(exportSelected).filter(Boolean).length} / {arduinoExportTargets.length} 선택
              </span>
            </div>

            <div className="exportList">
              {arduinoExportTargets.map((t) => (
                <label key={t.key} className={`exportItem ${exportSelected[t.key] ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={!!exportSelected[t.key]}
                    onChange={() => toggleExportItem(t.key)}
                  />
                  <span className="swatch" style={{ background: t.costumeColor }} />
                  <div className="exportMeta">
                    <div className="exportTitle">{t.costumeName} · {t.partName}</div>
                    <div className="exportSub">
                      {t.filename} · 스위칭 핀 {t.pin} · 이벤트 {t.eventCount}개
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="modalBtns">
              <button className="ghostBtn" onClick={() => setShowExportModal(false)}>취소</button>
              <button className="primaryBtn" onClick={exportArduino}>선택한 항목 내보내기</button>
            </div>
          </div>
        </div>
      )}

      {showTutorial && (
        <div className="modalBack">
          <div className="modal">
            <div className="modalIcon">{TUTORIAL_STEPS[tutStep].icon}</div>
            <h3>{TUTORIAL_STEPS[tutStep].title}</h3>
            <p>{TUTORIAL_STEPS[tutStep].body}</p>
            <div className="dots">
              {TUTORIAL_STEPS.map((_, i) => (
                <span key={i} className={i === tutStep ? "on" : ""} onClick={() => setTutStep(i)} />
              ))}
            </div>
            <div className="modalBtns">
              <button className="ghostBtn" onClick={() => setShowTutorial(false)}>건너뛰기</button>
              {tutStep > 0 && <button className="ghostBtn" onClick={() => setTutStep((s) => s - 1)}>← 이전</button>}
              {tutStep < TUTORIAL_STEPS.length - 1 ? (
                <button className="primaryBtn" onClick={() => setTutStep((s) => s + 1)}>다음 →</button>
              ) : (
                <button className="primaryBtn" onClick={() => setShowTutorial(false)}>🎉 시작하기!</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── CSS 스타일 ───────────────────────── */

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0B0D13; --panel: #131722; --panel2: #1A2030; --line: #262E42;
  --text: #F2F4FA; --dim: #B8C0D4; --muted: #9AA6BE; --accent: #7C5CFF; --cyan: #5EE0FF;
}
.app {
  height: 100vh; display: flex; flex-direction: column;
  background: var(--bg); color: var(--text);
  font-family: "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  font-size: 13px; overflow: hidden; user-select: none;
}
.main { flex: 1; display: flex; min-height: 0; overflow: hidden; }
.dim { color: var(--dim); }
.tip:hover::after {
  content: attr(data-tip);
  position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
  background: #232A3E; color: #DDE3F2; border: 1px solid var(--line);
  padding: 6px 10px; border-radius: 8px; font-size: 12px; font-weight: 400;
  white-space: nowrap; z-index: 999; pointer-events: none;
  box-shadow: 0 6px 18px rgba(0,0,0,.5);
}

.toolbar {
  display: flex; align-items: center; gap: 8px; flex-wrap: nowrap;
  padding: 4px 10px; min-height: 40px;
  background: linear-gradient(180deg, #151A28, #10141F);
  border-bottom: 1px solid var(--line);
}
.logo { display: flex; align-items: center; gap: 6px; margin-right: 4px; flex: none; }
.logoIcon { font-size: 16px; filter: drop-shadow(0 0 6px rgba(124,92,255,.7)); }
.logoTitle { font-weight: 800; font-size: 12.5px; letter-spacing: -0.3px; white-space: nowrap; }
.transport { display: flex; align-items: center; gap: 4px; flex: none; }
.timecode {
  font-family: "SF Mono", Consolas, monospace; font-size: 12px; font-weight: 700;
  background: #0D1019; border: 1px solid var(--line); border-radius: 6px;
  padding: 3px 8px; color: var(--cyan); min-width: 140px; text-align: center;
}
.toolGroup { display: flex; gap: 4px; align-items: center; }
.toolGroup.right { margin-left: auto; }
.tbtn {
  background: var(--panel2); color: var(--text); border: 1px solid var(--line);
  border-radius: 6px; padding: 4px 9px; font-size: 12px; transition: .15s; white-space: nowrap;
}
.tbtn.compact { padding: 3px 8px; font-size: 11.5px; }
.tbtn:hover { background: #232B41; border-color: #3A4666; }
.tbtn.play { background: var(--accent); border-color: var(--accent); font-size: 12px; padding: 4px 12px;
  box-shadow: 0 0 10px rgba(124,92,255,.5); }
.tbtn.playing { background: #2A3350; font-size: 12px; padding: 4px 12px; }
.tbtn.master { background: linear-gradient(90deg,#7C5CFF,#5EE0FF); border: none; color: #0B0D13; font-weight: 700; padding: 4px 10px; font-size: 11.5px; }
.tbtn.export { background: #1E3A2F; border-color: #2E5C48; }

.left, .right {
  display: flex; flex-direction: column; gap: 8px;
  padding: 8px; overflow-y: auto; overflow-x: hidden; flex: none;
}
.left { border-right: none; }
.right { border-left: none; }
.center { flex: 1; display: flex; flex-direction: column; min-width: 0; background: #0D101A; }
.resizeHandle {
  flex: none; width: 5px; cursor: col-resize; background: #151A28;
  border-left: 1px solid var(--line); border-right: 1px solid var(--line);
  position: relative; z-index: 6;
}
.resizeHandle:hover, .resizeHandle:active {
  background: color-mix(in srgb, var(--accent) 45%, #151A28);
}
body.resizingPanels, body.resizingPanels * { cursor: col-resize !important; user-select: none !important; }

.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px; color: #F4F6FC; }
.panel.grow { flex: 0 0 auto; }
.panelHead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.panelHead h2 { font-size: 14px; font-weight: 800; color: #FFFFFF; letter-spacing: -0.2px; }
.hint { color: #D5DCEC; font-size: 12.5px; line-height: 1.6; }
.miniBtn {
  background: var(--panel2); border: 1px solid var(--line); color: var(--text);
  border-radius: 7px; padding: 4px 9px; font-size: 12px;
}
.miniBtn:hover { border-color: var(--accent); }
.miniBtn.wide { width: 100%; margin-top: 6px; }

.costumeList { display: flex; flex-direction: column; gap: 6px; }
.costumeItem { border: 1px solid var(--line); border-radius: 9px; overflow: hidden; background: #10141F; }
.costumeItem.active { border-color: var(--accent); box-shadow: 0 0 0 1px rgba(124,92,255,.4); }
.costumeRow { display: flex; align-items: center; gap: 7px; padding: 7px 8px; cursor: pointer; }
.chev { color: #C8D0E4; width: 12px; }
.swatch { width: 11px; height: 11px; border-radius: 4px; flex: none; box-shadow: 0 0 6px currentColor; }
.nameInput {
  flex: 1; background: transparent; border: none; color: #FFFFFF;
  font-size: 13px; font-weight: 600; min-width: 0; border-radius: 4px; padding: 2px 4px;
}
.nameInput:focus { background: #1B2233; outline: 1px solid var(--accent); }
.iconBtn { background: none; border: none; color: var(--muted); font-size: 12px; padding: 2px 4px; }
.iconBtn:hover { color: #FF6B6B; }
.partList { padding: 6px 8px 9px; border-top: 1px dashed var(--line); }
.partHeadRow, .partRow { display: grid; grid-template-columns: 1fr 60px 22px; gap: 5px; align-items: center; }
.partHeadRow { font-size: 11px; color: #D0D8EC; margin-bottom: 4px; padding: 0 2px; font-weight: 600; }
.partRow { margin-bottom: 4px; }
.partRow input {
  background: #171D2C; border: 1px solid var(--line); color: #FFFFFF;
  border-radius: 6px; padding: 4px 6px; font-size: 12.5px; width: 100%;
}
.partRow input:focus { outline: 1px solid var(--accent); }

.presetGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.presetCard {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  background: #10141F; border: 1px solid var(--line); border-left: 3px solid var(--ec);
  border-radius: 10px; padding: 11px 6px; cursor: grab; transition: .15s;
}
.presetCard:hover { transform: translateY(-2px); border-color: var(--ec);
  box-shadow: 0 4px 16px rgba(0,0,0,.4), 0 0 10px color-mix(in srgb, var(--ec) 35%, transparent); }
.presetCard:active { cursor: grabbing; }
.customPresetHead {
  margin: 12px 0 6px; font-size: 11.5px; font-weight: 700; color: #D8E0F0;
}
.presetDelete {
  position: absolute; top: 4px; right: 4px; width: 18px; height: 18px;
  border: none; border-radius: 5px; background: #2A1520; color: #FF8FA5;
  font-size: 10px; line-height: 1; padding: 0; z-index: 2;
}
.presetDelete:hover { background: #3A1B2A; color: #FFB3C1; }
.presetColorBar {
  position: absolute; left: 0; top: 0; bottom: 0; width: 4px; border-radius: 10px 0 0 10px;
}
.presetMeta { font-size: 10px; color: #C8D0E4; font-weight: 600; }
.pIcon { font-size: 20px; }
.pName { font-size: 12.5px; font-weight: 700; color: #FFFFFF; text-align: center; }

.geminiPanel { display: flex; flex-direction: column; gap: 8px; }
.geminiPrompt {
  width: 100%; resize: vertical; min-height: 84px;
  background: #0F1420; border: 1px solid var(--line); color: #FFFFFF;
  border-radius: 9px; padding: 9px 10px; font-size: 12.5px; line-height: 1.5;
  font-family: inherit;
}
.geminiPrompt:focus { outline: 1px solid var(--accent); border-color: var(--accent); }
.geminiPrompt::placeholder { color: #8B95AD; }
.geminiActions { display: flex; gap: 6px; align-items: center; }
.geminiRunBtn {
  flex: 1; background: linear-gradient(90deg,#7C5CFF,#5EE0FF); color: #0B0D13;
  border: none; border-radius: 8px; padding: 8px 10px; font-size: 12.5px; font-weight: 800;
}
.geminiRunBtn:disabled, .geminiActions .miniBtn:disabled { opacity: .55; cursor: not-allowed; }
.geminiStatus {
  font-size: 12px; line-height: 1.5; color: #E4EAF8;
  background: #161C2F; border: 1px solid #2A3550; border-radius: 8px; padding: 8px 10px;
}
.geminiHint { font-size: 10.5px; color: #AAB4CC; line-height: 1.4; }

.timelineScroll { flex: 1; overflow-x: auto; overflow-y: hidden; cursor: grab; }
.timelineScroll.panning { cursor: grabbing; user-select: none; }
.timelineScroll.panning * { cursor: grabbing; }
.timelineContent { position: relative; min-height: 100%; }
.ruler {
  position: sticky; top: 0; z-index: 5; height: 26px; background: #11151F;
  border-bottom: 1px solid var(--line); cursor: pointer;
}
.mark { position: absolute; top: 0; height: 100%; border-left: 1px solid #2A3350; padding-left: 4px; }
.mark span { font-size: 10.5px; color: var(--dim); font-family: monospace; }
.waveRow { height: 56px; background: #0E1119; border-bottom: 1px solid var(--line); cursor: pointer; }
.waveRow canvas { display: block; height: 56px; }
.groupRow {
  display: flex; align-items: center; gap: 7px;
  height: 26px; padding: 0 10px; background: #151A28; border-bottom: 1px solid var(--line);
  font-weight: 700; font-size: 12.5px; color: var(--text); cursor: pointer; position: sticky; left: 0;
}
.groupRow .dim { color: var(--muted); }
.trackRow {
  position: relative; border-bottom: 1px solid #1B2233;
  background: repeating-linear-gradient(90deg, transparent 0 39px, #161C2B 39px 40px);
}
.trackRow:hover { background-color: rgba(124,92,255,.05); }
.trackLabel {
  position: sticky; left: 0; z-index: 4; display: inline-flex; align-items: center;
  height: 100%; padding: 0 10px 0 8px; font-size: 12px; color: #DDE4F5; font-weight: 600;
  background: linear-gradient(90deg, #131722 75%, transparent);
  border-left: 3px solid; pointer-events: none;
}
.block {
  position: absolute; top: 4px; bottom: 4px; border-radius: 7px;
  background: color-mix(in srgb, var(--bc) 30%, #10141F);
  border: 1.5px solid var(--bc); cursor: grab; overflow: hidden;
  display: flex; align-items: center; padding: 0 8px;
  box-shadow: inset 0 0 12px color-mix(in srgb, var(--bc) 25%, transparent);
}
.block.sel { box-shadow: 0 0 0 2px #fff, 0 0 14px var(--bc); z-index: 3; }
.block:active { cursor: grabbing; }
.bLabel { font-size: 11px; font-weight: 700; white-space: nowrap; pointer-events: none;
  text-shadow: 0 1px 3px rgba(0,0,0,.7); }
.handle { position: absolute; top: 0; bottom: 0; width: 8px; cursor: ew-resize; }
.handle.l { left: 0; } .handle.r { right: 0; }
.handle:hover { background: rgba(255,255,255,.25); }
.playhead {
  position: absolute; top: 0; bottom: 0; width: 2px; z-index: 8;
  background: #FF3B6B; box-shadow: 0 0 10px #FF3B6B; pointer-events: none;
}
.phTop {
  position: sticky; top: 0; width: 0; height: 0; margin-left: -6px;
  border: 7px solid transparent; border-top: 10px solid #FF3B6B;
}
.lenBar { padding: 8px 14px; border-top: 1px solid var(--line); color: var(--dim); font-size: 12px; }
.lenBar input { width: 70px; background: #171D2C; border: 1px solid var(--line);
  color: var(--text); border-radius: 6px; padding: 4px 6px; }

.timelineFooter {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 4px 10px; border-top: 1px solid var(--line); background: #11151F; flex: none;
}
.footerLen { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--dim); }
.footerLen input {
  width: 58px; background: #171D2C; border: 1px solid var(--line);
  color: var(--text); border-radius: 5px; padding: 2px 5px; font-size: 12px;
}
.footerHint { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
.zoomControl {
  display: flex; align-items: center; gap: 6px; margin-left: auto;
  background: #0D1019; border: 1px solid var(--line); border-radius: 8px; padding: 2px 6px 2px 4px;
}
.zoomBtn {
  width: 22px; height: 22px; border: none; border-radius: 5px;
  background: #1A2030; color: #E9ECF5; font-size: 16px; line-height: 1; font-weight: 700;
}
.zoomBtn:hover { background: #2A3350; }
.zoomSlider {
  width: 110px; accent-color: var(--accent); cursor: pointer;
}
.zoomLabel {
  min-width: 42px; text-align: right; font-size: 11px; font-weight: 700;
  font-family: "SF Mono", Consolas, monospace; color: var(--cyan);
}

.costumeTabs { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
.ctab {
  background: #10141F; border: 1px solid var(--line); color: #E4EAF8;
  border-radius: 999px; padding: 4px 11px; font-size: 12px; font-weight: 600;
}
.ctab.on { color: #FFFFFF; border-color: var(--cc); box-shadow: 0 0 8px color-mix(in srgb, var(--cc) 50%, transparent); }
.stage { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.avatar { width: 100%; max-width: 230px; }
.avatarCompact { width: 100%; height: 120px; display: block; }
.stageHint { font-size: 11.5px; color: #D5DCEC; line-height: 1.5; text-align: center; }

.bottomStrip {
  flex: none; border-top: 1px solid var(--line);
  background: linear-gradient(180deg, #10141F, #0B0D13);
  padding: 8px 12px 10px;
}
.bottomStripHead {
  display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; padding: 0 4px;
}
.bottomStripHead h2 { font-size: 12px; font-weight: 700; }
.bottomStripScroll {
  display: flex; gap: 10px; overflow-x: auto; overflow-y: hidden;
  padding-bottom: 4px; scroll-behavior: smooth;
}
.bottomCostumeCard {
  flex: none; width: 110px; display: flex; flex-direction: column; align-items: center; gap: 4px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 6px 6px 8px; transition: .15s; color: var(--text);
}
.bottomCostumeCard:hover { border-color: var(--cc); transform: translateY(-2px); }
.bottomCostumeCard.active {
  border-color: var(--cc); box-shadow: 0 0 12px color-mix(in srgb, var(--cc) 45%, transparent);
}
.bottomCostumeLabel {
  display: flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 700;
  width: 100%; justify-content: center; color: var(--text);
}
.bottomAddCard {
  flex: none; width: 90px; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 4px; background: #10141F; border: 1px dashed var(--line);
  border-radius: 10px; color: var(--dim); font-size: 12px; min-height: 150px;
}
.bottomAddCard:hover { border-color: var(--accent); color: var(--text); }
.addIcon { font-size: 22px; line-height: 1; }

.props { display: flex; flex-direction: column; gap: 10px; color: #F4F6FC; }
.propTitle {
  font-weight: 800; font-size: 14px; padding: 7px 10px; border-radius: 8px; color: #FFFFFF;
  background: color-mix(in srgb, var(--bc) 20%, #10141F); border-left: 3px solid var(--bc);
}
.propRow { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #F0F3FA; }
.propRow span { min-width: 78px; color: #E8EDF8; font-weight: 600; }
.propRow input[type=range] { flex: 1; accent-color: var(--accent); }
.propRow input[type=color] { width: 42px; height: 30px; border: none; background: none; cursor: pointer; }
.propRow code { color: var(--cyan); font-size: 11.5px; min-width: 52px; text-align: right; }
.propGrid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.propGrid2 label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #D8E0F0; font-weight: 600; }
.propGrid2 input {
  background: #171D2C; border: 1px solid var(--line); color: #FFFFFF;
  border-radius: 7px; padding: 6px 8px; font-size: 13px;
}
.dangerBtn {
  background: #2A1520; color: #FF8FA5; border: 1px solid #55283A;
  border-radius: 8px; padding: 8px; font-size: 12.5px;
}
.dangerBtn:hover { background: #3A1B2A; }

.toast {
  position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%);
  background: #1D2438; border: 1px solid var(--accent); border-radius: 10px;
  padding: 11px 18px; font-size: 13px; z-index: 1000;
  box-shadow: 0 8px 30px rgba(0,0,0,.6); animation: pop .25s ease;
}
@keyframes pop { from { opacity: 0; transform: translate(-50%, 10px); } }
.modalBack {
  position: fixed; inset: 0; background: rgba(5,7,12,.75); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; z-index: 2000;
}
.modal {
  width: 420px; max-width: 92vw; background: linear-gradient(180deg,#1A2033,#12161F);
  border: 1px solid #313B58; border-radius: 18px; padding: 28px 26px;
  text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,.7);
}
.modalIcon { font-size: 44px; margin-bottom: 10px; filter: drop-shadow(0 0 14px rgba(124,92,255,.6)); }
.modal h3 { font-size: 17px; margin-bottom: 10px; }
.modal p { font-size: 13.5px; line-height: 1.75; color: #D8DFF0; min-height: 92px; }
.dots { display: flex; justify-content: center; gap: 7px; margin: 14px 0 18px; }
.dots span { width: 8px; height: 8px; border-radius: 50%; background: #333D5C; cursor: pointer; }
.dots span.on { background: var(--accent); box-shadow: 0 0 8px var(--accent); }
.modalBtns { display: flex; justify-content: center; gap: 8px; }
.primaryBtn {
  background: linear-gradient(90deg,#7C5CFF,#5EE0FF); color: #0B0D13; font-weight: 800;
  border: none; border-radius: 9px; padding: 9px 20px; font-size: 13.5px;
}
.ghostBtn { background: transparent; color: var(--dim); border: 1px solid var(--line);
  border-radius: 9px; padding: 9px 14px; font-size: 13px; }
.ghostBtn:hover { color: var(--text); }

.exportModal { width: 520px; text-align: left; }
.exportModal .modalIcon { text-align: center; }
.exportModal h3 { text-align: center; color: #FFFFFF; }
.exportLead {
  font-size: 13px; line-height: 1.6; color: #D5DCEC; text-align: center;
  margin-bottom: 14px; min-height: 0 !important;
}
.exportToolbar {
  display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap;
}
.exportCount { margin-left: auto; font-size: 12px; color: #D5DCEC; font-weight: 600; }
.exportList {
  max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;
  margin-bottom: 16px; padding-right: 2px;
}
.exportItem {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  background: #10141F; border: 1px solid var(--line); border-radius: 10px;
  cursor: pointer; color: #F2F4FA;
}
.exportItem.on { border-color: var(--accent); background: #161C2F; }
.exportItem input[type=checkbox] {
  width: 16px; height: 16px; accent-color: var(--accent); flex: none; cursor: pointer;
}
.exportMeta { flex: 1; min-width: 0; }
.exportTitle { font-size: 13px; font-weight: 700; color: #FFFFFF; }
.exportSub { font-size: 11.5px; color: #C8D0E4; margin-top: 2px; word-break: break-all; }

@media (max-width: 1100px) {
  .zoomSlider { width: 80px; }
  .toolbar { gap: 6px; }
}
`;