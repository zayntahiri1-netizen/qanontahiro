// =========================================================================
// قانون تاهيرو — دالة «qt-ads»: التحقق من مكافآت AdMob من جهة الخادم (Server-Side Verification)
//
// يستدعيها AdMob نفسه (GET) بعد أن يشاهد المستخدم إعلان المكافأة حتى آخره:
//   ?ad_network=…&ad_unit=…&custom_data=ai&reward_amount=…&reward_item=…&timestamp=…&transaction_id=…&user_id=<uid>&signature=…&key_id=…
// 1) المحتوى الموقَّع = سلسلة الاستعلام كما وصلت حتى «&signature=» (دون أي تعديل)
// 2) التوقيع ECDSA P-256 / SHA-256 بترميز DER في base64 الآمن للروابط، ومفاتيح Google العامة من gstatic
//    (تُحفظ في الذاكرة 12 ساعة، وتُجلب من جديد عند ظهور مفتاح لا نعرفه)
// 3) وحدة الإعلان يجب أن تكون وحدة المكافأة في تطبيقنا (QT_ADS_REWARDED_UNITS)، فلا يمنح تطبيقُ غيرنا رصيداً
// 4) qt_ad_grant: مرة واحدة لكل transaction_id، و3 مكافآت في اليوم على الأكثر لكل مستخدم
// يجيب بـ 200 على كل استدعاء صحيح التوقيع (ولو لم يُمنح شيء)، كي لا يعيد AdMob المحاولة بلا فائدة؛
// وبـ 403 على التوقيع الباطل، و400 على الطلب الناقص.
// =========================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const KEYS_URLS = ["https://www.gstatic.com/admob/reward/verifier-keys.json", "https://gstatic.com/admob/reward/verifier-keys.json"];
const UNITS = (Deno.env.get("QT_ADS_REWARDED_UNITS") ?? "ca-app-pub-1725525147318224/8197582346")
  .split(",").map((s) => s.trim()).filter(Boolean);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serverKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    return keys.default ?? Object.values(keys)[0] ?? "";
  } catch {
    return "";
  }
}
const sb = createClient(Deno.env.get("SUPABASE_URL")!, serverKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

// ---------- المفاتيح العامة ----------
let KEYS = new Map<string, CryptoKey>();
let keysAt = 0;
function b64ToBytes(s: string): Uint8Array {
  let t = s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  while (t.length % 4) t += "=";
  const bin = atob(t), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// نسخة ArrayBuffer خالصة لـ WebCrypto (تقبلها كل إصدارات TypeScript وDeno)
const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
async function loadKeys(): Promise<void> {
  let lastErr = "";
  for (const u of KEYS_URLS) {
    try {
      const r = await fetch(u);
      if (!r.ok) { lastErr = `${u} ${r.status}`; continue; }
      const j = await r.json() as { keys?: { keyId: number | string; base64?: string; pem?: string }[] };
      const next = new Map<string, CryptoKey>();
      for (const k of j.keys ?? []) {
        const der = k.base64 ? b64ToBytes(k.base64)
          : b64ToBytes(String(k.pem ?? "").replace(/-----[A-Z ]+-----/g, ""));
        const key = await crypto.subtle.importKey("spki", ab(der), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
        next.set(String(k.keyId), key);
      }
      if (next.size) { KEYS = next; keysAt = Date.now(); return; }
      lastErr = `${u} empty`;
    } catch (e) {
      lastErr = `${u} ${(e as Error).message}`;
    }
  }
  throw new Error("verifier keys: " + lastErr);
}
async function keyFor(id: string): Promise<CryptoKey | undefined> {
  if (!KEYS.size || Date.now() - keysAt > 12 * 3600_000) await loadKeys();
  if (!KEYS.has(id) && Date.now() - keysAt > 60_000) await loadKeys();   // مفتاح جديد بعد تدوير
  return KEYS.get(id);
}

// توقيع DER (SEQUENCE{INTEGER r, INTEGER s}) ← r||s بطول 64 بايتاً كما يطلب WebCrypto
export function derToRaw(der: Uint8Array): Uint8Array | null {
  let i = 0;
  const len = (): number => {
    let n = der[i++];
    if (n & 0x80) { const k = n & 0x7f; if (k < 1 || k > 2) return -1; n = 0; for (let j = 0; j < k; j++) n = (n << 8) | der[i++]; }
    return n;
  };
  if (der[i++] !== 0x30) return null;
  const total = len(); if (total < 0 || i + total !== der.length) return null;
  const out = new Uint8Array(64);
  for (let part = 0; part < 2; part++) {
    if (der[i++] !== 0x02) return null;
    let n = len(); if (n < 1 || n > 33 || i + n > der.length) return null;
    let v = der.subarray(i, i + n); i += n;
    while (v.length > 32 && v[0] === 0) v = v.subarray(1);
    if (v.length > 32) return null;
    out.set(v, part * 32 + (32 - v.length));
  }
  return i === der.length ? out : null;
}

export async function verifyQuery(rawQuery: string): Promise<{ ok: boolean; why?: string; params?: URLSearchParams }> {
  const cut = rawQuery.indexOf("&signature=");
  if (cut < 0) return { ok: false, why: "nosig" };
  const message = rawQuery.slice(0, cut);
  const params = new URLSearchParams(rawQuery);
  const sig = params.get("signature") ?? "", keyId = params.get("key_id") ?? "";
  if (!sig || !keyId) return { ok: false, why: "nosig" };
  const key = await keyFor(keyId);
  if (!key) return { ok: false, why: "key" };
  const raw = derToRaw(b64ToBytes(sig));
  if (!raw) return { ok: false, why: "der" };
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, ab(raw), ab(new TextEncoder().encode(message)));
  return ok ? { ok: true, params } : { ok: false, why: "sig" };
}

const unitOk = (u: string) => !!u && UNITS.some((x) => x === u || x.endsWith("/" + u) || u.endsWith("/" + x.split("/").pop()));

Deno.serve(async (req) => {
  if (req.method !== "GET") return reply({ ok: false, error: "method" }, 405);
  const url = new URL(req.url);
  const raw = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  if (!raw) return reply({ ok: true, service: "qt-ads", ready: true });              // فحص الوصول من أداة النشر
  let v;
  try { v = await verifyQuery(raw); } catch (e) { return reply({ ok: false, error: "keys", why: (e as Error).message.slice(0, 160) }, 503); }
  if (!v.ok || !v.params) return reply({ ok: false, error: v.why }, v.why === "nosig" ? 400 : 403);
  const p = v.params;
  const tx = p.get("transaction_id") ?? "", uid = p.get("user_id") ?? "", kind = p.get("custom_data") || "ai";
  if (!unitOk(p.get("ad_unit") ?? "")) return reply({ ok: true, ignored: "unit" });   // موقَّع لكن لغير تطبيقنا
  if (!tx || !UUID.test(uid)) return reply({ ok: true, ignored: "user" });           // مثل استدعاء الاختبار من لوحة AdMob
  const { data, error } = await sb.rpc("qt_ad_grant", { p_tx: tx, p_uid: uid, p_kind: kind, p_via: "ssv" });
  if (error) return reply({ ok: false, error: "db" }, 500);                            // يعيد AdMob المحاولة
  return reply({ ok: true, grant: data });
});
