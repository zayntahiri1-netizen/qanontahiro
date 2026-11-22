// =========================================================================
// قانون تاهيرو — دالة «النبض» على خوادم Supabase (Deno)
// تنشر على قناة Ably «qt:pulse» بمفتاح الجذر المحفوظ سراً هنا فقط؛ لا يصل هذا المفتاح إلى أي عميل.
//
//   {type:"daily", day:"YYYY-MM-DD"}          يستدعيها التطبيق بعد جواب سؤال اليوم ← تنشر الإحصاء الحي للجميع
//   {type:"announce", ar, fr?, en?, url?}      إعلان من المؤلف (ترويسة x-qt-admin) ← يُحفظ ويُبث فوراً
//   {type:"reports"} / {type:"stats"}          للمؤلف فقط (ترويسة x-qt-admin): البلاغات الأخيرة وأرقام عامة وأرقام المساعد (ومعها حجم مكتبة القوانين) والإعلانات المكافئة
//   {type:"hide", alias, hidden?}               للمؤلف فقط: إخفاء اسم مستعار مخالف من اللوحات العامة
// =========================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const ABLY_KEY = Deno.env.get("ABLY_ROOT_KEY") ?? "";
const ADMIN = Deno.env.get("QT_ADMIN_SECRET") ?? "";
const CHANNEL = "qt:pulse";

// مفتاح الخادم: القديم (service_role) إن بقي مفعلاً، وإلا المفتاح السري الجديد (sb_secret_…)
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

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-qt-admin",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const lastDaily = new Map<string, number>();
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

// مقارنة ثابتة الزمن للسر
function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function publish(name: string, data: unknown) {
  const r = await fetch(`https://rest.ably.io/channels/${encodeURIComponent(CHANNEL)}/messages`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(ABLY_KEY), "Content-Type": "application/json" },
    body: JSON.stringify({ name, data }),
  });
  if (!r.ok) throw new Error(`ably ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

Deno.serve(async (req) => {
  // الفحص المسبق: تُقبل الترويسات التي يطلبها العميل كما هي (supabase-js يضيف ترويسات تتغير بين إصداراته)
  if (req.method === "OPTIONS") {
    const asked = req.headers.get("access-control-request-headers");
    return new Response("ok", { headers: { ...CORS, ...(asked ? { "Access-Control-Allow-Headers": asked } : {}) } });
  }
  if (req.method !== "POST") return reply({ error: "method" }, 405);

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return reply({ error: "json" }, 400);
  }
  const isAdmin = sameSecret(req.headers.get("x-qt-admin") ?? "", ADMIN);

  try {
    if (b.type === "daily") {
      if (!ABLY_KEY) return reply({ error: "ABLY_ROOT_KEY is not set" }, 500);
      const day = typeof b.day === "string" && DAY.test(b.day) ? b.day : new Date().toISOString().slice(0, 10);
      const now = Date.now();
      if (now - (lastDaily.get(day) ?? 0) < 8000) return reply({ ok: true, throttled: true });
      lastDaily.set(day, now);
      const { data, error } = await sb.rpc("qt_daily_stats", { p_day: day });
      if (error) throw error;
      const stats = { day, n: Number(data?.n ?? 0), ok: Number(data?.ok ?? 0) };
      await publish("daily", stats);
      return reply({ ok: true, stats });
    }

    if (!isAdmin) return reply({ error: "forbidden" }, 403);

    if (b.type === "announce") {
      if (!ABLY_KEY) return reply({ error: "ABLY_ROOT_KEY is not set" }, 500);
      const msg = { ar: clip(b.ar, 400), fr: clip(b.fr, 400), en: clip(b.en, 400), url: clip(b.url, 300) };
      if (!msg.ar) return reply({ error: "ar required" }, 400);
      if (msg.url && !/^https:\/\/\S+$/.test(msg.url)) msg.url = "";
      const { data, error } = await sb.from("qt_announcements").insert(msg).select("id, created_at").single();
      if (error) throw error;
      await publish("announce", { id: data.id, at: data.created_at, ...msg });
      return reply({ ok: true, id: data.id });
    }

    if (b.type === "reports") {
      const { data, error } = await sb.from("qt_reports")
        .select("id, qid, why, note, alias, bank, created_at")
        .order("id", { ascending: false }).limit(200);
      if (error) throw error;
      return reply({ ok: true, reports: data });
    }

    if (b.type === "stats") {
      const today = new Date().toISOString().slice(0, 10);
      const count = async (t: string) => {
        const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
        if (error) throw error;
        return count ?? 0;
      };
      const [profiles, synced, reports, daily, ai, ads] = await Promise.all([
        count("qt_profiles"), count("qt_progress"), count("qt_reports"),
        sb.rpc("qt_daily_stats", { p_day: today }).then((r: { data: unknown }) => r.data),
        sb.rpc("qt_ai_stats", { p_day: today }).then((r: { data: unknown }) => r.data).catch(() => null),
        sb.rpc("qt_ad_stats", { p_day: today }).then((r: { data: unknown }) => r.data).catch(() => null),
      ]);
      return reply({ ok: true, profiles, synced, reports, daily, ai, ads, ably: !!ABLY_KEY });
    }

    // إخفاء اسم مستعار مخالف من اللوحات العامة (أو إظهاره)
    if (b.type === "hide") {
      const alias = clip(b.alias, 18);
      if (!alias) return reply({ error: "alias required" }, 400);
      const { error } = await sb.from("qt_profiles").update({ hidden: b.hidden !== false }).eq("alias", alias);
      if (error) throw error;
      return reply({ ok: true, alias, hidden: b.hidden !== false });
    }

    return reply({ error: "type" }, 400);
  } catch (e) {
    return reply({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
