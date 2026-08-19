import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera, Upload, Users, Receipt, Loader2, ArrowLeft, ArrowRight,
  AlertCircle, Plus, X, Check, RotateCcw, Trash2, Wallet, Download, CalendarDays, Percent
} from "lucide-react";

const PALETTE = [
  "#0F5132", "#B23A2E", "#1D5C8A", "#8A5A1D",
  "#5B3E8A", "#1D7A6E", "#8A2E5E", "#4A5C1D",
];

const uid = () => Math.random().toString(36).slice(2, 10);

function money(n) {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

function formatThaiDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
  } catch (e) {
    return iso;
  }
}

const FONT_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
  .rs-root { font-family: 'IBM Plex Sans Thai', 'IBM Plex Mono', sans-serif; }
  .rs-mono { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
  .rs-perf {
    background-image: radial-gradient(circle, #FAF7F0 3px, transparent 3.5px);
    background-size: 14px 14px;
    background-position: -2px -2px;
  }
  .rs-fade-in { animation: rsFadeIn .35s ease both; }
  @keyframes rsFadeIn { from { opacity:0; transform: translateY(6px);} to {opacity:1; transform:none;} }
  .rs-stamp { transform: rotate(-3deg); }
  .rs-dashed { background-image: linear-gradient(to right, #D8D3C8 50%, transparent 0%); background-position: bottom; background-size: 10px 1px; background-repeat: repeat-x; }
  @media (prefers-reduced-motion: reduce) {
    .rs-fade-in { animation: none; }
  }
`;

export default function App() {
  const [step, setStep] = useState("upload"); // upload | review | assign | result
  const [image, setImage] = useState(null); // {base64, mediaType, url}
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [storeName, setStoreName] = useState("");
  const [mealDate, setMealDate] = useState(todayISO());
  const [items, setItems] = useState([]); // {id, name, amount}
  const [grandTotal, setGrandTotal] = useState(0);
  const [extractedNote, setExtractedNote] = useState("");
  const [debugInfo, setDebugInfo] = useState("");
  const [recapImageUrl, setRecapImageUrl] = useState("");
  const [savingImage, setSavingImage] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");

  const [contacts, setContacts] = useState([]); // {id, name, color}
  const [billPeopleIds, setBillPeopleIds] = useState([]);
  const [newPersonName, setNewPersonName] = useState("");
  const [assignments, setAssignments] = useState({}); // itemId -> [personId]
  const [discountAmount, setDiscountAmount] = useState(0);
  const [discountSource, setDiscountSource] = useState(null); // null | 'receipt' | 'manual'
  const [discountMode, setDiscountMode] = useState("everyone"); // 'everyone' | 'person' | 'exclude'
  const [discountPersonId, setDiscountPersonId] = useState(null);
  const [showDiscountPrompt, setShowDiscountPrompt] = useState(false);
  const [sessionReceipts, setSessionReceipts] = useState([]); // finalized receipts in this outing
  const fileInputRef = useRef(null);

  const people = contacts.filter((c) => billPeopleIds.includes(c.id));

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("saved-contacts", false);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          if (Array.isArray(parsed)) setContacts(parsed);
        }
      } catch (e) {}
    })();
  }, []);

  const persistContacts = useCallback(async (list) => {
    try {
      await window.storage.set("saved-contacts", JSON.stringify(list), false);
    } catch (e) {}
  }, []);

  function handleFile(file) {
    if (!file) return;
    setError("");
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const [header, b64] = dataUrl.split(",");
      const mediaType = /data:(.*);base64/.exec(header)?.[1] || "image/jpeg";
      setImage({ base64: b64, mediaType, url: dataUrl });
    };
    reader.onerror = () => setError("อ่านไฟล์รูปไม่สำเร็จ ลองใหม่อีกครั้ง");
    reader.readAsDataURL(file);
  }

  async function analyzeReceipt() {
    if (!image) return;
    setLoading(true);
    setError("");
    setDebugInfo("");
    try {
      const prompt = `นี่คือรูปใบเสร็จร้านอาหาร/ร้านค้า ช่วยแยกรายการสั่งซื้อออกมาให้ครบทุกบรรทัด

กติกา:
- amount ของแต่ละรายการ คือยอดรวมของบรรทัดนั้นตามที่พิมพ์บนใบเสร็จ (ราคาต่อหน่วย x จำนวน) ไม่ใช่ราคาต่อหน่วย
- ห้ามรวม VAT หรือ Service Charge เข้าไปในรายการอาหาร แยกออกมาต่างหาก อย่าสร้างรายการซ้ำสำหรับ vat/service/รวม
- grand_total คือยอดสุทธิที่ต้องจ่ายจริงบนใบเสร็จ (รวม vat และ service charge แล้ว หลังหักส่วนลดถ้ามี)
- discount_amount คือส่วนลดที่ปรากฏเป็นบรรทัดแยกบนใบเสร็จ (เช่น Discount, ส่วนลด, Promotion, Redeem) ไม่ใช่ VAT/Service ถ้าไม่มีบรรทัดแบบนี้ให้ใส่ 0
- ถ้าตัวเลขบางจุดพร่ามัวอ่านไม่ออก ให้ประมาณให้สมเหตุสมผลที่สุดแล้วใส่คำอธิบายสั้นๆ ใน note
- ตอบกลับเป็น JSON ล้วนเท่านั้น ห้ามมีคำอธิบาย ห้ามมี markdown fence ห้ามมีข้อความใดๆ ก่อนหรือหลัง JSON

รูปแบบ JSON ที่ต้องการเป๊ะๆ (ห้ามเพิ่มหรือลด key):
{"store_name": string หรือ null, "items": [{"name": string, "amount": number}], "items_subtotal": number, "discount_amount": number, "grand_total": number, "note": string หรือ ""}`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
                { type: "text", text: prompt },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        console.error("Claude API error", response.status, errBody);
        const friendly = response.status === 529
          ? "เซิร์ฟเวอร์ AI กำลังโหลดสูงชั่วคราว (HTTP 529) ลองกดใหม่อีกครั้งในสักครู่"
          : response.status === 429
          ? "เรียกถี่เกินไป (HTTP 429) รอสักครู่แล้วลองใหม่"
          : `เรียก API ไม่สำเร็จ (HTTP ${response.status})`;
        setDebugInfo(`HTTP ${response.status}\n${errBody}`);
        throw new Error(friendly);
      }
      const data = await response.json();
      const textBlock = (data.content || []).find((b) => b.type === "text");
      if (!textBlock) {
        setDebugInfo(`ไม่มี text block ในคำตอบ:\n${JSON.stringify(data, null, 2)}`);
        throw new Error("no_text_block");
      }

      const raw = textBlock.text.replace(/```json|```/g, "").trim();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start === -1 || end === -1 || end < start) {
        console.error("No JSON braces found in model output:", raw);
        setDebugInfo(`AI ตอบมาแบบนี้ (หา { } ไม่เจอ):\n${raw}`);
        throw new Error("no_json_found");
      }
      let parsed;
      try {
        parsed = JSON.parse(raw.slice(start, end + 1));
      } catch (parseErr) {
        console.error("JSON.parse failed on model output:", raw);
        setDebugInfo(`แปลง JSON ไม่สำเร็จ (${parseErr.message}):\n${raw}`);
        throw new Error("json_parse_failed");
      }
      if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
        console.error("Parsed JSON had no items:", parsed);
        setDebugInfo(`AI ตอบมาแต่ไม่มีรายการเมนู:\n${JSON.stringify(parsed, null, 2)}`);
        throw new Error("no_items");
      }

      const parsedItems = (parsed.items || []).map((it) => ({
        id: uid(),
        name: it.name || "รายการไม่ระบุชื่อ",
        amount: Number(it.amount) || 0,
      }));

      setStoreName(parsed.store_name || "");
      setItems(parsedItems);
      setGrandTotal(Number(parsed.grand_total) || 0);
      setExtractedNote(parsed.note || "");
      setAssignments({});

      const receiptDiscount = Number(parsed.discount_amount) || 0;
      if (receiptDiscount > 0) {
        setDiscountAmount(receiptDiscount);
        setDiscountSource("receipt");
        setDiscountMode("everyone");
        setDiscountPersonId(null);
        setShowDiscountPrompt(true);
      } else {
        setDiscountAmount(0);
        setDiscountSource(null);
        setShowDiscountPrompt(false);
      }

      setStep("review");
    } catch (e) {
      console.error("analyzeReceipt failed:", e);
      const knownMessages = ["no_text_block", "no_json_found", "json_parse_failed", "no_items"];
      const msg = knownMessages.includes(e.message)
        ? "อ่านรูปไม่สำเร็จ ลองถ่ายให้ชัดขึ้น ไม่เอียง และเห็นยอดรวมครบ หรือกดกรอกรายการเองด้านล่าง"
        : e.message; // already a friendly message from the API error branch
      setError(msg);
      // stay on the upload screen so the error + debug panel are visible,
      // instead of silently jumping to review with a blank item
    } finally {
      setLoading(false);
    }
  }

  function updateItem(id, patch) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function removeItem(id) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }
  function addItem() {
    setItems((prev) => [...prev, { id: uid(), name: "", amount: 0 }]);
  }

  function addPerson(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = contacts.find((c) => c.name === trimmed);
    if (existing) {
      addToBill(existing.id);
      setNewPersonName("");
      return;
    }
    const color = PALETTE[contacts.length % PALETTE.length];
    const newContact = { id: uid(), name: trimmed, color };
    const nextContacts = [...contacts, newContact];
    setContacts(nextContacts);
    persistContacts(nextContacts);
    setBillPeopleIds((prev) => [...prev, newContact.id]);
    setNewPersonName("");
  }
  function addPeopleBulk(text) {
    const names = text.split(/[,，、\n]+|\s+/).map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) return;
    let nextContacts = [...contacts];
    const idsToAdd = [];
    names.forEach((n) => {
      let existing = nextContacts.find((c) => c.name === n);
      if (!existing) {
        existing = { id: uid(), name: n, color: PALETTE[nextContacts.length % PALETTE.length] };
        nextContacts.push(existing);
      }
      idsToAdd.push(existing.id);
    });
    setContacts(nextContacts);
    persistContacts(nextContacts);
    setBillPeopleIds((prev) => Array.from(new Set([...prev, ...idsToAdd])));
    setNewPersonName("");
  }
  function addToBill(id) {
    setBillPeopleIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }
  function removeFromBill(id) {
    setBillPeopleIds((prev) => prev.filter((pid) => pid !== id));
    setAssignments((prev) => {
      const out = {};
      Object.entries(prev).forEach(([itemId, ids]) => {
        out[itemId] = ids.filter((i) => i !== id);
      });
      return out;
    });
    setDiscountPersonId((prev) => (prev === id ? null : prev));
  }
  function deleteContact(id) {
    const nextContacts = contacts.filter((c) => c.id !== id);
    setContacts(nextContacts);
    persistContacts(nextContacts);
    removeFromBill(id);
  }

  function toggleAssignment(itemId, personId) {
    setAssignments((prev) => {
      const current = prev[itemId] || [];
      const next = current.includes(personId)
        ? current.filter((id) => id !== personId)
        : [...current, personId];
      return { ...prev, [itemId]: next };
    });
  }

  const itemsSubtotal = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const extra = grandTotal - itemsSubtotal;

  function computeResults() {
    if (people.length === 0) return { rows: [], unassignedTotal: 0, payableTotal: grandTotal, discountAmount: 0 };
    const shareByPerson = {};
    people.forEach((p) => (shareByPerson[p.id] = 0));
    let unassignedTotal = 0;

    items.forEach((it) => {
      const assigned = (assignments[it.id] || []).filter((pid) => billPeopleIds.includes(pid));
      const amt = Number(it.amount) || 0;
      if (assigned.length === 0) {
        unassignedTotal += amt;
        people.forEach((p) => (shareByPerson[p.id] += amt / people.length));
      } else {
        assigned.forEach((pid) => {
          shareByPerson[pid] += amt / assigned.length;
        });
      }
    });

    const disc = discountAmount > 0 ? discountAmount : 0;
    const netExtra = grandTotal - itemsSubtotal; // vat + service, net of any discount already baked into grand_total (receipt source)
    // if the discount came from the receipt itself, grand_total already reflects it — peel it back out to isolate pure vat/service
    const netServiceVat = discountSource === "receipt" ? netExtra + disc : netExtra;

    let payableTotal = grandTotal;
    let extraForSplit = netExtra;
    if (disc > 0) {
      if (discountMode === "person") {
        extraForSplit = netServiceVat; // vat/service prorated normally; discount handled per-person below
      } else if (discountMode === "exclude") {
        extraForSplit = netServiceVat;
        // it wasn't a real shared discount — bill the group as if it never happened
        payableTotal = discountSource === "receipt" ? grandTotal + disc : grandTotal;
      } else {
        // 'everyone' — split proportionally (this is the default, matches a plain merchant discount)
        extraForSplit = discountSource === "manual" ? netExtra - disc : netExtra;
        payableTotal = discountSource === "manual" ? grandTotal - disc : grandTotal;
      }
    }

    const rows = people.map((p) => {
      const subtotalShare = shareByPerson[p.id] || 0;
      const extraShare = itemsSubtotal > 0 ? extraForSplit * (subtotalShare / itemsSubtotal) : 0;
      let rawTotal = subtotalShare + extraShare;
      if (disc > 0 && discountMode === "person" && p.id === discountPersonId) {
        rawTotal -= disc; // this person alone absorbs the discount
      }
      return { person: p, subtotalShare, extraShare, rawTotal: Math.max(0, rawTotal) };
    });

    const rounded = rows.map((r) => ({ ...r, total: Math.round(r.rawTotal * 100) / 100 }));
    const sumRounded = rounded.reduce((s, r) => s + r.total, 0);
    const diff = Math.round((payableTotal - sumRounded) * 100) / 100;
    if (rounded.length > 0 && Math.abs(diff) >= 0.01) {
      const idx = rounded.reduce((maxI, r, i, arr) => (r.total > arr[maxI].total ? i : maxI), 0);
      rounded[idx] = { ...rounded[idx], total: Math.round((rounded[idx].total + diff) * 100) / 100 };
    }
    return { rows: rounded, unassignedTotal, payableTotal, discountAmount: disc, discountMode };
  }

  const results = step === "result" ? computeResults() : { rows: [], unassignedTotal: 0, payableTotal: grandTotal, discountAmount: 0 };

  function computeSessionTotals() {
    const byId = {};
    sessionReceipts.forEach((rec) => {
      rec.rows.forEach((r) => {
        if (!byId[r.personId]) byId[r.personId] = { personId: r.personId, name: r.name, color: r.color, total: 0 };
        byId[r.personId].total += r.total;
      });
    });
    const combined = Object.values(byId).sort((a, b) => b.total - a.total);
    const grand = sessionReceipts.reduce((s, r) => s + r.payableTotal, 0);
    return { combined, grand };
  }

  async function downloadRecap() {
    setSavingImage(true);
    setSaveNotice("");
    try {
      try { await document.fonts.ready; } catch (e) {}
      const width = 720;
      const padding = 44;
      const itemLineH = 30;
      const personLineH = 48;
      const titleH = 40;
      const dateH = 30;
      const gapH = 32;
      const totalH = 46;
      const footerH = 40;

      const height =
        padding + titleH + dateH + gapH +
        Math.max(items.length, 1) * itemLineH + gapH +
        Math.max(results.rows.length, 1) * personLineH + gapH +
        (results.discountAmount > 0 ? 56 : 0) +
        totalH + footerH + padding;

      const canvas = document.createElement("canvas");
      const scale = 2;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);

      ctx.fillStyle = "#FFFDF8";
      ctx.fillRect(0, 0, width, height);

      const dashedLine = (y) => {
        ctx.save();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = "#D8D3C8";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
        ctx.restore();
      };

      let y = padding;
      ctx.textBaseline = "alphabetic";

      ctx.fillStyle = "#1C1C1C";
      ctx.textAlign = "center";
      ctx.font = "700 24px 'IBM Plex Sans Thai', sans-serif";
      ctx.fillText(storeName ? storeName : "สรุปหารบิล", width / 2, y);
      y += titleH;

      ctx.fillStyle = "#8A8578";
      ctx.font = "14px 'IBM Plex Mono', monospace";
      ctx.fillText(formatThaiDate(mealDate), width / 2, y);
      y += dateH;

      dashedLine(y);
      y += gapH;

      ctx.textAlign = "left";
      items.forEach((it) => {
        ctx.fillStyle = "#1C1C1C";
        ctx.font = "15px 'IBM Plex Sans Thai', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(it.name || "-", padding, y);
        ctx.fillStyle = "#5A554A";
        ctx.font = "15px 'IBM Plex Mono', monospace";
        ctx.textAlign = "right";
        ctx.fillText(money(it.amount), width - padding, y);
        y += itemLineH;
      });
      if (items.length === 0) y += itemLineH;

      dashedLine(y);
      y += gapH;

      results.rows.forEach((r) => {
        ctx.fillStyle = r.person.color;
        ctx.font = "700 17px 'IBM Plex Sans Thai', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(r.person.name, padding, y);
        ctx.fillStyle = "#B23A2E";
        ctx.font = "700 19px 'IBM Plex Mono', monospace";
        ctx.textAlign = "right";
        ctx.fillText("฿" + money(r.total), width - padding, y);
        y += personLineH;
      });
      if (results.rows.length === 0) y += personLineH;

      dashedLine(y);
      y += gapH;

      if (results.discountAmount > 0 && results.discountMode !== "exclude") {
        ctx.fillStyle = "#5A554A";
        ctx.font = "14px 'IBM Plex Sans Thai', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("ยอดก่อนหักส่วนลด", padding, y);
        ctx.font = "14px 'IBM Plex Mono', monospace";
        ctx.textAlign = "right";
        ctx.fillText(money(grandTotal), width - padding, y);
        y += 26;

        ctx.fillStyle = "#B23A2E";
        ctx.font = "14px 'IBM Plex Sans Thai', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("ส่วนลด", padding, y);
        ctx.font = "14px 'IBM Plex Mono', monospace";
        ctx.textAlign = "right";
        ctx.fillText("-" + money(results.discountAmount), width - padding, y);
        y += 30;
      } else if (results.discountAmount > 0 && results.discountMode === "exclude") {
        ctx.fillStyle = "#8A8578";
        ctx.font = "12px 'IBM Plex Sans Thai', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`(ไม่รวมส่วนลด ฿${money(results.discountAmount)} ที่ใช้แยกต่างหาก)`, padding, y);
        y += 26;
      }

      ctx.fillStyle = "#1C1C1C";
      ctx.font = "700 18px 'IBM Plex Sans Thai', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("ยอดรวมทั้งหมด", padding, y);
      ctx.fillStyle = "#0F5132";
      ctx.font = "700 24px 'IBM Plex Mono', monospace";
      ctx.textAlign = "right";
      ctx.fillText("฿" + money(results.payableTotal), width - padding, y);
      y += totalH;

      ctx.fillStyle = "#B7B0A0";
      ctx.font = "12px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("แบ่งบิลด้วยแอปหารบิล", width / 2, y);

      const safeStore = (storeName || "split-bill").replace(/[^a-zA-Z0-9ก-๙]+/g, "-");
      const fileName = `${safeStore}-${mealDate}.png`;

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("สร้างรูปไม่สำเร็จ ลองอีกครั้ง");

      // always show the image on screen so long-press-to-save works no matter what
      const dataUrl = canvas.toDataURL("image/png");
      setRecapImageUrl(dataUrl);

      // best path on mobile: native share sheet -> Save Image
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], fileName, { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: fileName });
            setSaveNotice("แชร์/บันทึกรูปเรียบร้อย");
            return;
          } catch (shareErr) {
            if (shareErr && shareErr.name === "AbortError") {
              setSaveNotice("");
              return; // user cancelled the share sheet, not an error
            }
            // fall through to download-link fallback
          }
        }
      }

      // fallback: trigger a normal download link
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
      setSaveNotice("ถ้าไม่ดาวน์โหลดอัตโนมัติ กดค้างที่รูปด้านล่างแล้วเลือกบันทึกรูปภาพ");
    } catch (e) {
      console.error("downloadRecap failed:", e);
      setSaveNotice("สร้างรูปสรุปไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setSavingImage(false);
    }
  }

  function resetAll() {
    setStep("upload");
    setImage(null);
    setError("");
    setDebugInfo("");
    setStoreName("");
    setMealDate(todayISO());
    setItems([]);
    setGrandTotal(0);
    setAssignments({});
    setBillPeopleIds([]);
    setRecapImageUrl("");
    setSaveNotice("");
    setDiscountAmount(0);
    setDiscountSource(null);
    setDiscountMode("everyone");
    setDiscountPersonId(null);
    setShowDiscountPrompt(false);
    setSessionReceipts([]);
  }

  // keeps the same people + session history, only clears fields for the receipt just finished
  function resetForNextReceipt() {
    setStep("upload");
    setImage(null);
    setError("");
    setDebugInfo("");
    setStoreName("");
    setItems([]);
    setGrandTotal(0);
    setAssignments({});
    setRecapImageUrl("");
    setSaveNotice("");
    setDiscountAmount(0);
    setDiscountSource(null);
    setDiscountMode("everyone");
    setDiscountPersonId(null);
    setShowDiscountPrompt(false);
  }

  function saveCurrentReceiptToSession() {
    if (items.length === 0 || results.rows.length === 0) return;
    const record = {
      id: uid(),
      storeName: storeName || "ไม่ระบุชื่อร้าน",
      mealDate,
      payableTotal: results.payableTotal,
      discountAmount: results.discountAmount,
      rows: results.rows.map((r) => ({ personId: r.person.id, name: r.person.name, color: r.person.color, total: r.total })),
    };
    setSessionReceipts((prev) => [...prev, record]);
    return record;
  }

  function addAnotherReceipt() {
    saveCurrentReceiptToSession();
    resetForNextReceipt();
  }

  function finishSession() {
    saveCurrentReceiptToSession();
    setStep("session");
  }

  function removeSessionReceipt(id) {
    setSessionReceipts((prev) => prev.filter((r) => r.id !== id));
  }

  async function downloadSessionRecap() {
    setSavingImage(true);
    setSaveNotice("");
    try {
      try { await document.fonts.ready; } catch (e) {}
      const { combined, grand } = computeSessionTotals();
      const width = 720;
      const padding = 44;
      const receiptLineH = 28;
      const personLineH = 48;
      const titleH = 40;
      const subH = 28;
      const gapH = 32;
      const totalH = 46;
      const footerH = 40;

      const height =
        padding + titleH + subH + gapH +
        Math.max(sessionReceipts.length, 1) * receiptLineH + gapH +
        Math.max(combined.length, 1) * personLineH + gapH +
        totalH + footerH + padding;

      const canvas = document.createElement("canvas");
      const scale = 2;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);

      ctx.fillStyle = "#FFFDF8";
      ctx.fillRect(0, 0, width, height);

      const dashedLine = (y) => {
        ctx.save();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = "#D8D3C8";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
        ctx.restore();
      };

      let y = padding;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#1C1C1C";
      ctx.textAlign = "center";
      ctx.font = "700 24px 'IBM Plex Sans Thai', sans-serif";
      ctx.fillText("สรุปรวมทุกใบเสร็จ", width / 2, y);
      y += titleH;

      ctx.fillStyle = "#8A8578";
      ctx.font = "13px 'IBM Plex Mono', monospace";
      ctx.fillText(`${sessionReceipts.length} ใบเสร็จ`, width / 2, y);
      y += subH;

      dashedLine(y);
      y += gapH;

      ctx.textAlign = "left";
      sessionReceipts.forEach((rec) => {
        ctx.fillStyle = "#1C1C1C";
        ctx.font = "14px 'IBM Plex Sans Thai', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`${rec.storeName} · ${formatThaiDate(rec.mealDate)}`, padding, y);
        ctx.fillStyle = "#5A554A";
        ctx.font = "14px 'IBM Plex Mono', monospace";
        ctx.textAlign = "right";
        ctx.fillText(money(rec.payableTotal), width - padding, y);
        y += receiptLineH;
      });
      if (sessionReceipts.length === 0) y += receiptLineH;

      dashedLine(y);
      y += gapH;

      combined.forEach((r) => {
        ctx.fillStyle = r.color;
        ctx.font = "700 17px 'IBM Plex Sans Thai', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(r.name, padding, y);
        ctx.fillStyle = "#B23A2E";
        ctx.font = "700 19px 'IBM Plex Mono', monospace";
        ctx.textAlign = "right";
        ctx.fillText("฿" + money(r.total), width - padding, y);
        y += personLineH;
      });
      if (combined.length === 0) y += personLineH;

      dashedLine(y);
      y += gapH;

      ctx.fillStyle = "#1C1C1C";
      ctx.font = "700 18px 'IBM Plex Sans Thai', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("ยอดรวมทั้งหมด", padding, y);
      ctx.fillStyle = "#0F5132";
      ctx.font = "700 24px 'IBM Plex Mono', monospace";
      ctx.textAlign = "right";
      ctx.fillText("฿" + money(grand), width - padding, y);
      y += totalH;

      ctx.fillStyle = "#B7B0A0";
      ctx.font = "12px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("แบ่งบิลด้วยแอปหารบิล", width / 2, y);

      const fileName = `หารบิล-รวม-${mealDate}.png`;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("สร้างรูปไม่สำเร็จ");
      const dataUrl = canvas.toDataURL("image/png");
      setRecapImageUrl(dataUrl);

      if (navigator.share && navigator.canShare) {
        const file = new File([blob], fileName, { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: fileName });
            setSaveNotice("แชร์/บันทึกรูปเรียบร้อย");
            return;
          } catch (shareErr) {
            if (shareErr && shareErr.name === "AbortError") {
              setSaveNotice("");
              return;
            }
          }
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
      setSaveNotice("ถ้าไม่ดาวน์โหลดอัตโนมัติ กดค้างที่รูปด้านล่างแล้วเลือกบันทึกรูปภาพ");
    } catch (e) {
      console.error("downloadSessionRecap failed:", e);
      setSaveNotice("สร้างรูปสรุปไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setSavingImage(false);
    }
  }

  return (
    <div className="rs-root min-h-screen w-full flex justify-center" style={{ background: "#EFEAE0" }}>
      <style>{FONT_STYLE}</style>
      <div className="w-full max-w-md pb-10">
        <Header step={step} />

        {step === "upload" && (
          <UploadScreen
            image={image}
            loading={loading}
            error={error}
            debugInfo={debugInfo}
            fileInputRef={fileInputRef}
            onPick={handleFile}
            onAnalyze={analyzeReceipt}
            onManualEntry={() => {
              setItems([{ id: uid(), name: "", amount: 0 }]);
              setStep("review");
            }}
          />
        )}

        {step === "review" && (
          <ReviewScreen
            storeName={storeName}
            setStoreName={setStoreName}
            mealDate={mealDate}
            setMealDate={setMealDate}
            items={items}
            grandTotal={grandTotal}
            itemsSubtotal={itemsSubtotal}
            extra={extra}
            extractedNote={extractedNote}
            error={error}
            updateItem={updateItem}
            removeItem={removeItem}
            addItem={addItem}
            setGrandTotal={setGrandTotal}
            showDiscountPrompt={showDiscountPrompt}
            discountAmount={discountAmount}
            setDiscountMode={setDiscountMode}
            setShowDiscountPrompt={setShowDiscountPrompt}
            onBack={() => setStep("upload")}
            onNext={() => setStep("assign")}
          />
        )}

        {step === "assign" && (
          <AssignScreen
            items={items}
            contacts={contacts}
            people={people}
            billPeopleIds={billPeopleIds}
            assignments={assignments}
            newPersonName={newPersonName}
            setNewPersonName={setNewPersonName}
            addPerson={addPerson}
            addPeopleBulk={addPeopleBulk}
            addToBill={addToBill}
            removeFromBill={removeFromBill}
            deleteContact={deleteContact}
            toggleAssignment={toggleAssignment}
            discountAmount={discountAmount}
            setDiscountAmount={setDiscountAmount}
            discountSource={discountSource}
            setDiscountSource={setDiscountSource}
            discountMode={discountMode}
            setDiscountMode={setDiscountMode}
            discountPersonId={discountPersonId}
            setDiscountPersonId={setDiscountPersonId}
            onBack={() => setStep("review")}
            onNext={() => setStep("result")}
          />
        )}

        {step === "result" && (
          <ResultScreen
            storeName={storeName}
            mealDate={mealDate}
            items={items}
            grandTotal={grandTotal}
            results={results}
            onDownload={downloadRecap}
            savingImage={savingImage}
            recapImageUrl={recapImageUrl}
            saveNotice={saveNotice}
            sessionCount={sessionReceipts.length}
            onAddAnotherReceipt={addAnotherReceipt}
            onFinishSession={finishSession}
            onBack={() => setStep("assign")}
            onReset={resetAll}
          />
        )}

        {step === "session" && (
          <SessionSummaryScreen
            sessionReceipts={sessionReceipts}
            totals={computeSessionTotals()}
            onRemoveReceipt={removeSessionReceipt}
            onAddAnotherReceipt={() => { resetForNextReceipt(); }}
            onDownload={downloadSessionRecap}
            savingImage={savingImage}
            recapImageUrl={recapImageUrl}
            saveNotice={saveNotice}
            onReset={resetAll}
          />
        )}
      </div>
    </div>
  );
}

function Header({ step }) {
  const labels = { upload: "ถ่ายใบเสร็จ", review: "ตรวจรายการ", assign: "ระบุเจ้าของ", result: "สรุปยอด", session: "สรุปรวมทุกใบ" };
  const order = ["upload", "review", "assign", "result"];
  const idx = step === "session" ? order.length - 1 : order.indexOf(step);
  return (
    <div className="px-5 pt-6 pb-3">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "#0F5132" }}>
          <Receipt size={16} color="#FAF7F0" />
        </div>
        <div>
          <div className="text-[15px] font-semibold" style={{ color: "#1C1C1C" }}>หารบิล</div>
          <div className="text-[11px] rs-mono" style={{ color: "#8A8578" }}>{labels[step]}</div>
        </div>
      </div>
      <div className="flex gap-1.5">
        {order.map((s, i) => (
          <div key={s} className="h-1 flex-1 rounded-full" style={{ background: i <= idx ? "#0F5132" : "#D8D3C8" }} />
        ))}
      </div>
    </div>
  );
}

function Card({ children, className = "" }) {
  return (
    <div
      className={`rs-fade-in mx-5 rounded-2xl ${className}`}
      style={{ background: "#FFFDF8", border: "1px solid #E4DECF", boxShadow: "0 1px 3px rgba(28,28,28,0.05)" }}
    >
      {children}
    </div>
  );
}

function UploadScreen({ image, loading, error, debugInfo, fileInputRef, onPick, onAnalyze, onManualEntry }) {
  return (
    <div className="space-y-4">
      <Card className="p-5">
        {!image ? (
          <div
            className="rs-perf rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-10 px-4 text-center cursor-pointer"
            style={{ borderColor: "#C9C2B0" }}
            onClick={() => fileInputRef.current?.click()}
          >
            <Camera size={30} color="#0F5132" />
            <div className="mt-3 text-sm font-medium" style={{ color: "#1C1C1C" }}>ถ่ายรูปหรือเลือกรูปใบเสร็จ</div>
            <div className="mt-1 text-xs" style={{ color: "#8A8578" }}>ให้เห็นรายการอาหาร ยอดรวม vat และ service charge ชัดๆ</div>
            <div className="mt-4 px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5" style={{ background: "#0F5132", color: "#FAF7F0" }}>
              <Upload size={13} /> เลือกรูปภาพ
            </div>
          </div>
        ) : (
          <div>
            <img src={image.url} alt="ใบเสร็จ" className="w-full rounded-xl object-cover max-h-80" />
            <button className="mt-3 text-xs underline" style={{ color: "#8A8578" }} onClick={() => fileInputRef.current?.click()}>
              เปลี่ยนรูป
            </button>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
      </Card>

      {error && (
        <Card className="p-4 flex gap-2 items-start">
          <AlertCircle size={16} color="#B23A2E" className="mt-0.5 shrink-0" />
          <div className="text-xs" style={{ color: "#B23A2E" }}>{error}</div>
        </Card>
      )}

      {debugInfo && (
        <Card className="p-3">
          <div className="text-[11px] font-semibold mb-1.5" style={{ color: "#8A8578" }}>
            รายละเอียดทางเทคนิค (ส่งข้อความนี้ให้ช่วยดูได้)
          </div>
          <pre
            className="rs-mono text-[10px] whitespace-pre-wrap break-words p-2 rounded-lg max-h-48 overflow-y-auto"
            style={{ background: "#F4F0E6", color: "#5A554A" }}
          >
            {debugInfo}
          </pre>
        </Card>
      )}

      <div className="px-5">
        <button
          disabled={!image || loading}
          onClick={onAnalyze}
          className="w-full py-3.5 rounded-full text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
          style={{ background: "#B23A2E", color: "#FFFDF8" }}
        >
          {loading ? (<><Loader2 size={16} className="animate-spin" /> กำลังอ่านใบเสร็จ...</>) : (<>อ่านรายการจากใบเสร็จ <ArrowRight size={15} /></>)}
        </button>
        {error && (
          <button
            onClick={onManualEntry}
            className="w-full mt-2.5 py-2.5 rounded-full text-xs font-medium"
            style={{ background: "transparent", color: "#8A8578", border: "1px solid #D8D3C8" }}
          >
            ขอกรอกรายการเอง ไม่ต้องรอ AI
          </button>
        )}
      </div>
    </div>
  );
}

function ReviewScreen({
  storeName, setStoreName, mealDate, setMealDate, items, grandTotal, itemsSubtotal, extra, extractedNote, error,
  updateItem, removeItem, addItem, setGrandTotal,
  showDiscountPrompt, discountAmount, setDiscountMode, setShowDiscountPrompt,
  onBack, onNext,
}) {
  return (
    <div className="space-y-4">
      {(error || extractedNote) && (
        <Card className="p-3 flex gap-2 items-start">
          <AlertCircle size={15} color="#8A5A1D" className="mt-0.5 shrink-0" />
          <div className="text-xs" style={{ color: "#8A5A1D" }}>{extractedNote || error}{" "}ตรวจสอบและแก้ไขตัวเลขด้านล่างได้เลย</div>
        </Card>
      )}

      {showDiscountPrompt && (
        <Card className="p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Percent size={14} color="#8A5A1D" />
            <span className="text-xs font-semibold" style={{ color: "#1C1C1C" }}>เจอส่วนลด ฿{money(discountAmount)} ในใบเสร็จ</span>
          </div>
          <div className="text-[11px] mb-2.5" style={{ color: "#8A8578" }}>
            จะจัดการส่วนลดนี้ยังไงดี? ถ้าจริงๆ แล้วเป็นการใช้คูปอง/แคชแบ็กส่วนตัวของใครคนหนึ่ง ไม่ใช่ส่วนลดร้านค้า เลือกข้อ 2 หรือ 3 ได้เลย
          </div>
          <div className="space-y-1.5">
            <button
              onClick={() => { setDiscountMode("everyone"); setShowDiscountPrompt(false); }}
              className="w-full text-left px-3 py-2 rounded-lg text-xs"
              style={{ background: "#F4F0E6", color: "#1C1C1C" }}
            >
              <b>หารเท่ากันทุกคน</b> — เป็นส่วนลดร้านค้า ลดให้ทุกคนตามสัดส่วนที่สั่ง
            </button>
            <button
              onClick={() => { setDiscountMode("person"); setShowDiscountPrompt(false); }}
              className="w-full text-left px-3 py-2 rounded-lg text-xs"
              style={{ background: "#F4F0E6", color: "#1C1C1C" }}
            >
              <b>เป็นของคนใดคนหนึ่ง</b> — ไปเลือกว่าใครในหน้าถัดไป
            </button>
            <button
              onClick={() => { setDiscountMode("exclude"); setShowDiscountPrompt(false); }}
              className="w-full text-left px-3 py-2 rounded-lg text-xs"
              style={{ background: "#F4F0E6", color: "#1C1C1C" }}
            >
              <b>ไม่ต้องเอามาคำนวณ</b> — เช่นคูปอง/แคชแบ็กส่วนตัว ไม่ใช่ส่วนลดร้าน จะจ่ายแยกกันเอง
            </button>
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="flex gap-2 mb-3">
          <input
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder="ชื่อร้าน (ไม่บังคับ)"
            className="flex-1 text-sm px-2.5 py-2 rounded-lg outline-none"
            style={{ background: "#F4F0E6", color: "#1C1C1C" }}
          />
          <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg" style={{ background: "#F4F0E6" }}>
            <CalendarDays size={14} color="#8A8578" />
            <input
              type="date"
              value={mealDate}
              onChange={(e) => setMealDate(e.target.value)}
              className="rs-mono text-xs outline-none bg-transparent"
              style={{ color: "#1C1C1C" }}
            />
          </div>
        </div>

        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2">
              <input
                value={it.name}
                onChange={(e) => updateItem(it.id, { name: e.target.value })}
                placeholder="ชื่อเมนู"
                className="flex-1 text-sm px-2.5 py-2 rounded-lg outline-none"
                style={{ background: "#F4F0E6", color: "#1C1C1C" }}
              />
              <input
                type="number"
                value={it.amount}
                onChange={(e) => updateItem(it.id, { amount: parseFloat(e.target.value) || 0 })}
                className="rs-mono w-20 text-sm px-2 py-2 rounded-lg outline-none text-right"
                style={{ background: "#F4F0E6", color: "#1C1C1C" }}
              />
              <button onClick={() => removeItem(it.id)} className="p-1.5 shrink-0" style={{ color: "#B23A2E" }}>
                <X size={15} />
              </button>
            </div>
          ))}
        </div>

        <button onClick={addItem} className="mt-3 text-xs font-medium flex items-center gap-1" style={{ color: "#0F5132" }}>
          <Plus size={14} /> เพิ่มรายการ
        </button>
      </Card>

      <Card className="p-4">
        <Row label="รวมรายการอาหาร" value={itemsSubtotal} />
        <div className="flex items-center justify-between py-1.5">
          <span className="text-xs" style={{ color: "#8A8578" }}>ยอดสุทธิที่ต้องจ่าย (รวม vat/service)</span>
          <input
            type="number"
            value={grandTotal}
            onChange={(e) => setGrandTotal(parseFloat(e.target.value) || 0)}
            className="rs-mono w-24 text-sm px-2 py-1.5 rounded-lg outline-none text-right font-semibold"
            style={{ background: "#F4F0E6", color: "#1C1C1C" }}
          />
        </div>
        <div className="flex items-center justify-between py-1.5 border-t mt-1 pt-2" style={{ borderColor: "#E4DECF" }}>
          <span className="text-xs" style={{ color: "#8A8578" }}>ส่วนต่าง (vat + service − ส่วนลด)</span>
          <span className="rs-mono text-xs font-semibold" style={{ color: extra >= 0 ? "#1C1C1C" : "#B23A2E" }}>
            {extra >= 0 ? "+" : ""}{money(extra)}
          </span>
        </div>
      </Card>

      <NavButtons onBack={onBack} onNext={onNext} nextLabel="ระบุเจ้าของเมนู" nextDisabled={items.length === 0} />
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs" style={{ color: "#8A8578" }}>{label}</span>
      <span className="rs-mono text-sm font-semibold" style={{ color: "#1C1C1C" }}>{money(value)}</span>
    </div>
  );
}

function AssignScreen({
  items, contacts, people, billPeopleIds, assignments, newPersonName, setNewPersonName,
  addPerson, addPeopleBulk, addToBill, removeFromBill, deleteContact, toggleAssignment,
  discountAmount, setDiscountAmount, discountSource, setDiscountSource,
  discountMode, setDiscountMode, discountPersonId, setDiscountPersonId,
  onBack, onNext,
}) {
  const suggested = contacts.filter((c) => !billPeopleIds.includes(c.id));
  const hasDiscount = discountAmount > 0;

  function clearDiscount() {
    setDiscountAmount(0);
    setDiscountSource(null);
    setDiscountMode("everyone");
    setDiscountPersonId(null);
  }
  function enableManualDiscount() {
    setDiscountSource("manual");
    setDiscountMode("everyone");
    if (!discountAmount) setDiscountAmount(0);
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-1.5 mb-2.5">
          <Users size={14} color="#0F5132" />
          <span className="text-xs font-semibold" style={{ color: "#1C1C1C" }}>มื้อนี้กินกับใคร</span>
        </div>

        {people.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2.5">
            {people.map((p) => (
              <div key={p.id} className="rs-stamp flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full text-xs font-medium" style={{ background: p.color + "1A", color: p.color, border: `1px solid ${p.color}55` }}>
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: p.color }}>
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                {p.name}
                <button onClick={() => removeFromBill(p.id)} title="เอาออกจากบิลนี้">
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {suggested.length > 0 && (
          <div className="mb-2.5">
            <div className="text-[11px] mb-1.5" style={{ color: "#8A8578" }}>เคยหารบิลด้วย แตะเพื่อเพิ่มเข้ามื้อนี้</div>
            <div className="flex flex-wrap gap-1.5">
              {suggested.map((c) => (
                <button key={c.id} onClick={() => addToBill(c.id)} className="group flex items-center gap-1 pl-1 pr-2 py-1 rounded-full text-[11px] font-medium" style={{ background: "#F4F0E6", color: "#8A8578", border: "1px solid #E4DECF" }}>
                  <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ background: c.color }}>+</span>
                  {c.name}
                  <span onClick={(e) => { e.stopPropagation(); deleteContact(c.id); }} className="ml-0.5 opacity-50 hover:opacity-100" title="ลบออกจากรายชื่อที่บันทึกไว้">
                    <Trash2 size={10} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={newPersonName}
            onChange={(e) => setNewPersonName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addPeopleBulk(newPersonName); }}
            placeholder="ชื่อคนใหม่ เว้นวรรคหรือคั่นด้วยจุลภาคก็ได้ เช่น เอ บี ซี"
            className="flex-1 text-sm px-3 py-2 rounded-lg outline-none"
            style={{ background: "#F4F0E6", color: "#1C1C1C" }}
          />
          <button onClick={() => addPeopleBulk(newPersonName)} className="px-3 rounded-lg" style={{ background: "#0F5132", color: "#FAF7F0" }}>
            <Plus size={16} />
          </button>
        </div>
      </Card>

      {people.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Percent size={14} color="#0F5132" />
              <span className="text-xs font-semibold" style={{ color: "#1C1C1C" }}>ส่วนลด</span>
              {discountSource === "receipt" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "#F4F0E6", color: "#8A8578" }}>จากใบเสร็จ</span>
              )}
            </div>
            {!hasDiscount ? (
              <button
                onClick={enableManualDiscount}
                className="px-3 py-1 rounded-full text-[11px] font-medium"
                style={{ background: "#F4F0E6", color: "#0F5132", border: "1px solid #0F513233" }}
              >
                + เพิ่มส่วนลด
              </button>
            ) : (
              <button onClick={clearDiscount} className="text-[11px]" style={{ color: "#8A8578" }}>
                ไม่มีส่วนลดแล้ว
              </button>
            )}
          </div>

          {hasDiscount && (
            <div className="rs-fade-in">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-xs" style={{ color: "#5A554A" }}>จำนวนเงินส่วนลด</span>
                <input
                  type="number"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                  className="rs-mono w-24 text-sm px-2 py-1.5 rounded-lg outline-none text-right"
                  style={{ background: "#F4F0E6", color: "#1C1C1C" }}
                />
              </div>
              <div className="text-[11px] mb-1.5" style={{ color: "#8A8578" }}>จัดการยังไง</div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setDiscountMode("everyone")}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                  style={{
                    background: discountMode === "everyone" ? "#0F5132" : "#F4F0E6",
                    color: discountMode === "everyone" ? "#FFFDF8" : "#8A8578",
                    border: `1px solid ${discountMode === "everyone" ? "#0F5132" : "#E4DECF"}`,
                  }}
                >
                  หารเท่ากันทุกคน
                </button>
                {people.map((p) => {
                  const active = discountMode === "person" && discountPersonId === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => { setDiscountMode("person"); setDiscountPersonId(p.id); }}
                      className="flex items-center gap-1 pl-1 pr-2 py-1 rounded-full text-[11px] font-medium"
                      style={{ background: active ? p.color : "#F4F0E6", color: active ? "#FFFDF8" : "#8A8578", border: `1px solid ${active ? p.color : "#E4DECF"}` }}
                    >
                      <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: active ? "rgba(255,255,255,0.3)" : p.color, color: "#FFFDF8" }}>
                        {active ? <Check size={9} /> : p.name.slice(0, 1).toUpperCase()}
                      </span>
                      {p.name} คนเดียว
                    </button>
                  );
                })}
                {discountSource === "receipt" && (
                  <button
                    onClick={() => setDiscountMode("exclude")}
                    className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                    style={{
                      background: discountMode === "exclude" ? "#0F5132" : "#F4F0E6",
                      color: discountMode === "exclude" ? "#FFFDF8" : "#8A8578",
                      border: `1px solid ${discountMode === "exclude" ? "#0F5132" : "#E4DECF"}`,
                    }}
                  >
                    ไม่ต้องเอามาคำนวณ
                  </button>
                )}
              </div>
              {discountMode === "person" && !discountPersonId && (
                <div className="text-[10px] mt-1.5" style={{ color: "#C9A227" }}>เลือกคนที่ได้ส่วนลดนี้ด้วย</div>
              )}
              {discountMode === "exclude" && (
                <div className="text-[10px] mt-1.5" style={{ color: "#8A8578" }}>
                  จะคำนวณเหมือนไม่มีส่วนลดนี้ — คนที่ใช้คูปอง/แคชแบ็กไปเจรจาแยกกับกลุ่มเอง
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {people.length === 0 ? (
        <Card className="p-4 text-center text-xs" style={{ color: "#8A8578" }}>
          เลือกหรือเพิ่มคนที่กินมื้อนี้ด้วยก่อน แล้วค่อยแตะเลือกว่าใครสั่งเมนูไหน
        </Card>
      ) : (
        <Card className="p-4">
          <div className="text-xs font-semibold mb-2.5" style={{ color: "#1C1C1C" }}>แตะเลือกเจ้าของเมนู (เลือกได้หลายคนถ้าแชร์กัน)</div>
          <div className="space-y-3">
            {items.map((it) => {
              const assigned = assignments[it.id] || [];
              return (
                <div key={it.id} className="pb-3 border-b last:border-0" style={{ borderColor: "#EEE9DC" }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm" style={{ color: "#1C1C1C" }}>{it.name || "(ไม่มีชื่อ)"}</span>
                    <span className="rs-mono text-xs" style={{ color: "#8A8578" }}>{money(it.amount)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {people.map((p) => {
                      const active = assigned.includes(p.id);
                      return (
                        <button key={p.id} onClick={() => toggleAssignment(it.id, p.id)} className="flex items-center gap-1 pl-1 pr-2 py-1 rounded-full text-[11px] font-medium" style={{ background: active ? p.color : "#F4F0E6", color: active ? "#FFFDF8" : "#8A8578", border: `1px solid ${active ? p.color : "#E4DECF"}` }}>
                          <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: active ? "rgba(255,255,255,0.3)" : p.color, color: "#FFFDF8" }}>
                            {active ? <Check size={9} /> : p.name.slice(0, 1).toUpperCase()}
                          </span>
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                  {assigned.length === 0 && (
                    <div className="text-[10px] mt-1" style={{ color: "#C9A227" }}>ยังไม่ระบุ — จะหารเท่ากันทุกคนถ้าไม่เลือก</div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <NavButtons onBack={onBack} onNext={onNext} nextLabel="ดูสรุปยอด" nextDisabled={people.length === 0} />
    </div>
  );
}

function ResultScreen({
  storeName, mealDate, items, grandTotal, results, onDownload, savingImage, recapImageUrl, saveNotice,
  sessionCount, onAddAnotherReceipt, onFinishSession, onBack, onReset,
}) {
  const { rows, unassignedTotal } = results;
  return (
    <div className="space-y-4">
      <Card className="p-5 text-center">
        <Wallet size={22} color="#0F5132" className="mx-auto mb-1.5" />
        <div className="text-xs" style={{ color: "#8A8578" }}>{storeName || "ยอดที่ต้องจ่ายจริง"}</div>
        <div className="text-[11px] rs-mono mt-0.5" style={{ color: "#B7B0A0" }}>{formatThaiDate(mealDate)}</div>
        {results.discountAmount > 0 && results.discountMode !== "exclude" && (
          <div className="text-[11px] rs-mono mt-1" style={{ color: "#8A8578" }}>
            <span className="line-through">฿{money(grandTotal)}</span>{" "}
            <span style={{ color: "#B23A2E" }}>-฿{money(results.discountAmount)}</span>
          </div>
        )}
        {results.discountAmount > 0 && results.discountMode === "exclude" && (
          <div className="text-[11px] mt-1" style={{ color: "#8A8578" }}>
            (ไม่รวมส่วนลด ฿{money(results.discountAmount)} ที่ใช้แยกต่างหาก)
          </div>
        )}
        <div className="rs-mono text-2xl font-bold mt-1" style={{ color: "#1C1C1C" }}>฿{money(results.payableTotal)}</div>
      </Card>

      <Card className="p-4">
        <div className="text-xs font-semibold mb-2" style={{ color: "#1C1C1C" }}>กินอะไรไปบ้าง</div>
        <div className="space-y-1.5">
          {items.map((it) => (
            <div key={it.id} className="flex justify-between text-xs">
              <span style={{ color: "#5A554A" }}>{it.name || "-"}</span>
              <span className="rs-mono" style={{ color: "#8A8578" }}>{money(it.amount)}</span>
            </div>
          ))}
        </div>
        {results.discountAmount > 0 && results.discountMode !== "exclude" && (
          <div className="flex justify-between text-xs mt-2 pt-2 border-t" style={{ borderColor: "#EEE9DC" }}>
            <span style={{ color: "#B23A2E" }}>ส่วนลด</span>
            <span className="rs-mono" style={{ color: "#B23A2E" }}>-{money(results.discountAmount)}</span>
          </div>
        )}
      </Card>

      {unassignedTotal > 0 && (
        <Card className="p-3 flex gap-2 items-start">
          <AlertCircle size={14} color="#8A5A1D" className="mt-0.5 shrink-0" />
          <div className="text-[11px]" style={{ color: "#8A5A1D" }}>
            มีรายการมูลค่า ฿{money(unassignedTotal)} ที่ไม่ได้ระบุเจ้าของ ระบบหารเท่ากันให้ทุกคนแล้ว
          </div>
        </Card>
      )}

      <div className="mx-5 space-y-2.5">
        {rows.map((r) => (
          <Card key={r.person.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: r.person.color }}>
                  {r.person.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="text-sm font-medium" style={{ color: "#1C1C1C" }}>{r.person.name}</span>
              </div>
              <span className="rs-mono text-lg font-bold" style={{ color: "#B23A2E" }}>฿{money(r.total)}</span>
            </div>
            <div className="flex justify-between mt-2 pt-2 border-t text-[11px] rs-mono" style={{ borderColor: "#EEE9DC", color: "#8A8578" }}>
              <span>รายการ ฿{money(r.subtotalShare)}</span>
              <span>vat/service ฿{money(r.extraShare)}</span>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="text-xs font-semibold mb-2" style={{ color: "#1C1C1C" }}>มื้อนี้มีหลายใบเสร็จไหม</div>
        <div className="text-[11px] mb-3" style={{ color: "#8A8578" }}>
          {sessionCount > 0
            ? `บันทึกไว้แล้ว ${sessionCount} ใบ — เพิ่มอีกใบหรือดูยอดรวมทุกคนได้เลย`
            : "ถ้าไปหลายร้าน/หลายรอบกับคนกลุ่มเดิม เพิ่มใบเสร็จถัดไปแล้วรวมยอดตอนจบได้"}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onAddAnotherReceipt}
            className="flex-1 py-2.5 rounded-full text-xs font-semibold flex items-center justify-center gap-1.5"
            style={{ background: "#F4F0E6", color: "#0F5132", border: "1px solid #0F513233" }}
          >
            <Plus size={13} /> เพิ่มใบเสร็จอีกใบ
          </button>
          {sessionCount > 0 && (
            <button
              onClick={onFinishSession}
              className="flex-1 py-2.5 rounded-full text-xs font-semibold flex items-center justify-center gap-1.5"
              style={{ background: "#0F5132", color: "#FAF7F0" }}
            >
              ดูยอดรวม {sessionCount + 1} ใบ
            </button>
          )}
        </div>
      </Card>

      <div className="px-5">
        <button
          onClick={onDownload}
          disabled={savingImage}
          className="w-full py-3 rounded-full text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
          style={{ background: "#1C1C1C", color: "#FFFDF8" }}
        >
          {savingImage ? (<><Loader2 size={15} className="animate-spin" /> กำลังสร้างรูป...</>) : (<><Download size={15} /> บันทึกเป็นรูปภาพ</>)}
        </button>
      </div>

      {saveNotice && (
        <Card className="p-3">
          <div className="text-[11px]" style={{ color: "#8A5A1D" }}>{saveNotice}</div>
        </Card>
      )}

      {recapImageUrl && (
        <Card className="p-3">
          <div className="text-[11px] mb-2" style={{ color: "#8A8578" }}>กดค้างที่รูปด้านล่างเพื่อบันทึกลงเครื่อง</div>
          <img src={recapImageUrl} alt="สรุปหารบิล" className="w-full rounded-xl" style={{ border: "1px solid #E4DECF" }} />
        </Card>
      )}

      <div className="px-5 flex gap-2.5">
        <button onClick={onBack} className="py-3 px-4 rounded-full text-sm font-medium flex items-center gap-1.5" style={{ background: "#F4F0E6", color: "#1C1C1C" }}>
          <ArrowLeft size={15} /> แก้ไข
        </button>
        <button onClick={onReset} className="flex-1 py-3 rounded-full text-sm font-semibold flex items-center justify-center gap-1.5" style={{ background: "#0F5132", color: "#FAF7F0" }}>
          <RotateCcw size={15} /> เริ่มบิลใหม่
        </button>
      </div>
    </div>
  );
}

function SessionSummaryScreen({
  sessionReceipts, totals, onRemoveReceipt, onAddAnotherReceipt, onDownload, savingImage, recapImageUrl, saveNotice, onReset,
}) {
  const { combined, grand } = totals;
  return (
    <div className="space-y-4">
      <Card className="p-5 text-center">
        <Wallet size={22} color="#0F5132" className="mx-auto mb-1.5" />
        <div className="text-xs" style={{ color: "#8A8578" }}>ยอดรวมทุกใบเสร็จ ({sessionReceipts.length} ใบ)</div>
        <div className="rs-mono text-2xl font-bold mt-1" style={{ color: "#1C1C1C" }}>฿{money(grand)}</div>
      </Card>

      <Card className="p-4">
        <div className="text-xs font-semibold mb-2" style={{ color: "#1C1C1C" }}>รายการใบเสร็จ</div>
        <div className="space-y-2">
          {sessionReceipts.map((rec) => (
            <div key={rec.id} className="flex items-center justify-between text-xs">
              <div>
                <div style={{ color: "#1C1C1C" }}>{rec.storeName}</div>
                <div className="rs-mono text-[10px]" style={{ color: "#B7B0A0" }}>{formatThaiDate(rec.mealDate)}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rs-mono" style={{ color: "#8A8578" }}>{money(rec.payableTotal)}</span>
                <button onClick={() => onRemoveReceipt(rec.id)} style={{ color: "#B23A2E" }}>
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="mx-5 space-y-2.5">
        {combined.map((r) => (
          <Card key={r.personId} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: r.color }}>
                  {r.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="text-sm font-medium" style={{ color: "#1C1C1C" }}>{r.name}</span>
              </div>
              <span className="rs-mono text-lg font-bold" style={{ color: "#B23A2E" }}>฿{money(r.total)}</span>
            </div>
          </Card>
        ))}
      </div>

      <div className="px-5">
        <button
          onClick={onDownload}
          disabled={savingImage}
          className="w-full py-3 rounded-full text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
          style={{ background: "#1C1C1C", color: "#FFFDF8" }}
        >
          {savingImage ? (<><Loader2 size={15} className="animate-spin" /> กำลังสร้างรูป...</>) : (<><Download size={15} /> บันทึกเป็นรูปภาพ</>)}
        </button>
      </div>

      {saveNotice && (
        <Card className="p-3">
          <div className="text-[11px]" style={{ color: "#8A5A1D" }}>{saveNotice}</div>
        </Card>
      )}

      {recapImageUrl && (
        <Card className="p-3">
          <div className="text-[11px] mb-2" style={{ color: "#8A8578" }}>กดค้างที่รูปด้านล่างเพื่อบันทึกลงเครื่อง</div>
          <img src={recapImageUrl} alt="สรุปรวมทุกใบเสร็จ" className="w-full rounded-xl" style={{ border: "1px solid #E4DECF" }} />
        </Card>
      )}

      <div className="px-5 flex gap-2.5">
        <button onClick={onAddAnotherReceipt} className="py-3 px-4 rounded-full text-sm font-medium flex items-center gap-1.5" style={{ background: "#F4F0E6", color: "#1C1C1C" }}>
          <Plus size={15} /> เพิ่มใบเสร็จ
        </button>
        <button onClick={onReset} className="flex-1 py-3 rounded-full text-sm font-semibold flex items-center justify-center gap-1.5" style={{ background: "#0F5132", color: "#FAF7F0" }}>
          <RotateCcw size={15} /> เริ่มรอบใหม่ทั้งหมด
        </button>
      </div>
    </div>
  );
}

function NavButtons({ onBack, onNext, nextLabel, nextDisabled }) {
  return (
    <div className="px-5 flex gap-2.5">
      <button onClick={onBack} className="py-3 px-4 rounded-full text-sm font-medium flex items-center gap-1.5" style={{ background: "#F4F0E6", color: "#1C1C1C" }}>
        <ArrowLeft size={15} />
      </button>
      <button disabled={nextDisabled} onClick={onNext} className="flex-1 py-3 rounded-full text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40" style={{ background: "#B23A2E", color: "#FFFDF8" }}>
        {nextLabel} <ArrowRight size={15} />
      </button>
    </div>
  );
}
